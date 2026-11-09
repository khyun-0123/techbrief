// PostgreSQL 연결과 테이블 준비 (08 개발 계획안 4절, 13절 보관 정책)
// DATABASE_URL이 없으면 DB 없이 동작한다 (서버 메모리 + 브라우저 저장소). 팀원 PC에 DB가 없어도 앱은 돌아간다
import pg from 'pg'

let pool = null
let ready = null // 테이블 준비 Promise

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

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`

export async function db() {
  if (!dbEnabled()) return null
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    pool.on('error', (err) => console.error('[db] 연결 오류:', err.message))
    ready = pool.query(SCHEMA).then(() => console.log('[db] 테이블 준비 완료'))
  }
  await ready
  return pool
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
