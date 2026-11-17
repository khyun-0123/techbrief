// PostgreSQL 연결과 테이블 준비 (08 개발 계획안 4절, 13절 보관 정책)
// DATABASE_URL이 없으면 DB 없이 동작한다 (서버 메모리 + 브라우저 저장소). 팀원 PC에 DB가 없어도 앱은 돌아간다
import pg from 'pg'

// 연결 묶음(pool)은 프로세스에 하나만 (11/17): Vite가 서버 코드를 고칠 때마다 같은 프로세스에서 이 파일을 새로 읽어
// 묶음(최대 5개)을 또 만들었음 → 1초 안에 몇 번 다시 켜지면 DB 계정 한도(20개)를 넘어 「too many connections」(serve.log 515번)
// → globalThis에 두고 다시 읽혀도 같은 묶음을 쓴다. 테이블 준비(SCHEMA)는 글이 바뀌었을 때만 다시 돈다
const shared = (globalThis.__techbriefDb ??= { pool: null, schema: null, ready: null })

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL)
}

const SCHEMA = `
-- 수집 기사. 원문 주소(url)로 한 번만 저장한다. 본문은 저장하지 않는다 (08 9절)
CREATE TABLE IF NOT EXISTS articles (
  id           text PRIMARY KEY,
  url          text UNIQUE NOT NULL,
  title        text NOT NULL,
  description  text,
  source       text,
  keyword      text NOT NULL,
  published_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
-- 네이버 뉴스 섹션 (정치·경제·사회·IT/과학 등). 네이버 제휴 언론사 기사만 있음 → 관련도 판단 (13 F4)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS section text;
-- 같은 이슈 묶음 (대표 기사 id). 수집이 끝날 때 다시 묶어 저장하고, 목록은 이 값을 그대로 쓴다
ALTER TABLE articles ADD COLUMN IF NOT EXISTS group_id text;
-- 네이버가 「...」로 자른 제목을 원문 페이지 제목(og:title)으로 채운 것 (collector/titles.js). 없으면 title을 쓴다
ALTER TABLE articles ADD COLUMN IF NOT EXISTS full_title text;
-- 「찾기」로 받은 네이버 기사 (11/17 · 37 문서 P2-3): 자료 현황 · 요즘 뜨는 기술 · 추이 · 맵 DB 쪽에는 넣지 않고, 다시 찾을 때 같은 점수를 쓰려고 남긴다. 수집 키워드로 다시 모이면 false
ALTER TABLE articles ADD COLUMN IF NOT EXISTS from_search boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS articles_keyword_idx ON articles (keyword, published_at DESC);

-- 기사별 AI 요약. 같은 이슈로 묶인 기사는 alias_of로 대표 기사의 요약을 가리킨다 (한 번만 요약)
CREATE TABLE IF NOT EXISTS summaries (
  article_id  text PRIMARY KEY,
  alias_of    text,
  content     jsonb,
  model       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 보고서 (보고서함)
CREATE TABLE IF NOT EXISTS reports (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  period_label text,
  article_key  text,
  report       jsonb NOT NULL,
  articles     jsonb NOT NULL,
  inputs       jsonb,
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);
-- 보고서를 만든 사람의 IP (11/08): 일반 화면에서는 같은 IP만 지울 수 있다. 화면(다른 사용자)에는 보내지 않는다
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_ip text;
-- 휴지통 (11/13 조장): 지우면 바로 없애지 않고 휴지통으로. 만든 사람은 휴지통에서 되살리거나 영구 삭제,
-- 관리자가 정한 보관 기간(기본 30일)이 지나면 자동으로 영구 삭제 (report_trash_days)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- 중요 보고서 표시 (11/13 조장): 사람마다(지금은 IP별 — 나중에 사람 구분으로 나눔)
CREATE TABLE IF NOT EXISTS report_stars (
  owner      text NOT NULL,
  report_id  text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, report_id)
);

-- 정기 수집 키워드 (팀이 같이 쓰도록 브라우저가 아니라 DB에 둔다). position은 화면 순서
CREATE TABLE IF NOT EXISTS keywords (
  word       text PRIMARY KEY,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 키워드별 일자별 집계. 원본 기사를 지워도 장기 추이는 남긴다 (08 13-2, 계속 보관)
CREATE TABLE IF NOT EXISTS keyword_daily (
  keyword   text NOT NULL,
  day       date NOT NULL,
  issues    integer NOT NULL,
  articles  integer NOT NULL,
  PRIMARY KEY (keyword, day)
);

-- 사용 현황 (17 문서 4장). 개인 정보 없음: client_id는 브라우저가 만든 무작위 값, IP·User-Agent 저장 안 함
-- 원본은 90일 보관 (server/usage.js)
CREATE TABLE IF NOT EXISTS usage_events (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  detail     text,
  client_id  text,
  value      integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at);

-- 앱 설정·상태 (자동 최신화 주기, 마지막 실행 시각 등). 팀원 앱이 같이 본다
-- 선별한 기사의 원문 본문 (11/06·11/07 결정: 선별한 기사만, 논문 포함). 90일 지나면 지움 (23 문서)
CREATE TABLE IF NOT EXISTS article_texts (
  article_id  text PRIMARY KEY,
  url         text,
  body        text NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

-- 기사(이슈) 중요도 저장 (11/17 조장: 키워드 점수(요즘 뜨는 기술)와 자료 점수는 별개로 저장, 한 번 매긴 점수는 다시 쓴다 · 37 문서 P2)
-- issue_id = 이슈 대표 기사 id. parts = 칸별 원점수 · 관련도 배수 · 잡음 배수 등 (score.js). 최신성은 시간에 따라 줄어서
-- 볼 때 다시 계산한다 (score.js rescore). sig = 최신성을 뺀 점수 재료 + 기준 버전 — 바뀐 것만 다시 쓴다
CREATE TABLE IF NOT EXISTS article_scores (
  issue_id      text PRIMARY KEY,
  sig           text NOT NULL,
  score         integer NOT NULL,
  level         text NOT NULL,
  parts         jsonb NOT NULL,
  relevance     text,
  published_at  timestamptz,
  computed_at   timestamptz NOT NULL DEFAULT now()
);

-- 논문 출처 결과 캐시 (server/papers). 검색 6시간 · 논문 수 24시간~30일 뒤 다시 받는다. 지난 것은 가끔 지움
CREATE TABLE IF NOT EXISTS paper_cache (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- 직접 추가한 자료 (11/07 결정, 27 문서 3장): 링크 · DOI · 텍스트 · 파일. 21일 정리 대상 아님 (지울 때까지 남음)
-- added_by는 브라우저가 만든 무작위 값(이름 없음). 올린 브라우저와 관리자만 지울 수 있다
CREATE TABLE IF NOT EXISTS materials (
  id           text PRIMARY KEY,
  kind         text NOT NULL,
  title        text NOT NULL,
  url          text,
  source       text,
  description  text,
  body         text,
  tier         integer NOT NULL DEFAULT 2,
  ai_allowed   boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  added_at     timestamptz NOT NULL DEFAULT now(),
  added_by     text,
  file_name    text,
  doi          text
);
CREATE INDEX IF NOT EXISTS materials_added_idx ON materials (added_at DESC);

-- 브라우저별 선별 폴더 (11/07 결정: 선별 정보 서버 기록, 이름 없음). data = { folders, folderOf, selectedIds }
CREATE TABLE IF NOT EXISTS selections (
  client_id   text PRIMARY KEY,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 요즘 뜨는 기술 · 추적 키워드 추이 값 기록 (11/08 조장): 받은 값을 출처 · 용어 · 종류 · 구간별로 쌓아 둔다
-- API가 실패하거나 한도에 막히면 여기서 가장 최근 값을 꺼내 「지난 값 · 언제 받음」으로 보여 준다. 400일 지나면 정리
-- kind: 'series'(일별 · 월별 값 묶음, win 없음) · 'recent'(논문 최근 4주, win = 구간 끝 날짜)
CREATE TABLE IF NOT EXISTS tech_trend_values (
  source      text NOT NULL,
  term        text NOT NULL,
  kind        text NOT NULL,
  win         text NOT NULL DEFAULT '',
  value       jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, term, kind, win)
);
CREATE INDEX IF NOT EXISTS tech_trend_values_recent_idx ON tech_trend_values (source, term, kind, fetched_at DESC);

-- 검색어의 영문 표기 (11/10, server/queryTerms.js): 한글 검색어로 논문 · 영문 출처를 찾을 때 쓴다
-- source: 'llm'(AI가 만든 것) · 'admin'(관리자가 고친 것). 관리 페이지 「검색어 영문 표기」에서 고치거나 지운다
CREATE TABLE IF NOT EXISTS query_terms (
  query       text PRIMARY KEY,
  terms       jsonb NOT NULL,
  source      text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 「뉴스·논문에서 찾기」 검색어별 하루 횟수 (11/10): 관리 페이지 「자주 찾은 새 키워드」 → 회의에서 자동 수집 키워드로 정할 때 참고
-- 사람 수는 IP를 그대로 두지 않고 하루 단위 해시 앞 12자리만 둔다. 90일 지나면 지움
CREATE TABLE IF NOT EXISTS search_counts (
  query     text NOT NULL,
  day       date NOT NULL,
  searches  integer NOT NULL DEFAULT 0,
  people    text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (query, day)
);
-- 키워드 분석을 연 횟수 (11/17, 37 문서 P12 · 36 문서 3-5): 미리 분석 대상이 「찾기」만이 아니라 실제로 연 말도 따라가게
ALTER TABLE search_counts ADD COLUMN IF NOT EXISTS opens integer NOT NULL DEFAULT 0;

-- 디스플레이 논문 DB (11/10, server/papers/corpus.js): OpenAlex 디스플레이 주제 6개 논문을 미리 받아 두고 찾기는 여기서 한다
-- 목록 받기는 100편에 $0.0001이라 (검색 1번 $0.001의 1/10) 2018년부터 다 받아도 약 $0.1. 찾기마다 API를 부르지 않는다
-- 초록은 OpenAlex CC0. 원문은 저장하지 않는다
CREATE TABLE IF NOT EXISTS papers (
  id            text PRIMARY KEY,            -- OpenAlex W 번호
  doi           text,
  title         text NOT NULL,
  abstract      text,
  journal       text,
  source_id     text,
  is_core       boolean NOT NULL DEFAULT false,
  type          text,
  published     date,
  year          integer,
  cited         integer NOT NULL DEFAULT 0,
  fwci          real,
  pct           real,                        -- 분야 · 연도 보정 인용 백분위 (0~1)
  top10         boolean NOT NULL DEFAULT false,
  topic_id      text,
  topics        jsonb,                       -- [{ id, name, score }]
  keywords      jsonb,                       -- [{ name, score }] OpenAlex 핵심어
  keyword_text  text,                        -- 핵심어를 이은 글 (찾기에 씀)
  companies     jsonb,                       -- 저자 소속 중 기업 [{ name, country }]
  oa_url        text,
  oa_license    text,
  retracted     boolean NOT NULL DEFAULT false,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  doc           tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(keyword_text, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(abstract, '')), 'B')) STORED
);
CREATE INDEX IF NOT EXISTS papers_doc_idx ON papers USING gin (doc);
CREATE INDEX IF NOT EXISTS papers_published_idx ON papers (published DESC);
CREATE INDEX IF NOT EXISTS papers_doi_idx ON papers (doi);

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`

export async function db() {
  if (!dbEnabled()) return null
  if (!shared.pool) {
    shared.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    shared.pool.on('error', (err) => console.error('[db] 연결 오류:', err.message))
  }
  if (shared.schema !== SCHEMA) {
    shared.schema = SCHEMA
    shared.ready = shared.pool
      .query(SCHEMA)
      .then(() => console.log('[db] 테이블 준비 완료'))
      .catch((err) => {
        shared.schema = null // 다음 호출 때 다시
        throw err
      })
  }
  await shared.ready
  return shared.pool
}

export async function query(text, params) {
  const p = await db()
  if (!p) throw new Error('DB가 설정되지 않았어요 (DATABASE_URL)')
  return p.query(text, params)
}

// 상단 상태 표시·점검용
export async function dbStatus() {
  if (!dbEnabled()) return { enabled: false }
  try {
    const { rows } = await query(
      `SELECT (SELECT count(*) FROM articles)::int AS articles,
              (SELECT count(*) FROM summaries WHERE alias_of IS NULL)::int AS summaries,
              (SELECT count(*) FROM reports)::int AS reports`,
    )
    return { enabled: true, ok: true, ...rows[0] }
  } catch (err) {
    return { enabled: true, ok: false, error: err.message }
  }
}
