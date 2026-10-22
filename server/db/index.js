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
