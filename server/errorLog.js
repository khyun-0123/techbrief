// 오류 기록 (11/26 조장: 「오류나는거 다 로그로 남겨둬」)
// - 서버: API가 5xx로 끝난 요청 (server/index.js 마지막 catch)
// - 화면: 사용자 화면에서 난 오류(요약 · 보고서 · 서버 연결 끊김 등). 서버가 꺼져 있던 동안의 오류는 브라우저가 모아 뒀다가
//   다시 연결되면 보낸다 (src/errorReport.js). 관리 페이지 「운영 › 오류 기록」에서 본다
// - 개인 정보 없음: IP · User-Agent는 저장하지 않고 client_id(브라우저가 만든 무작위 값)만. 30일 지나면 지움
import { dbEnabled, query } from './db/index.js'

const KEEP_DAYS = 30
const MEMORY_MAX = 300
const memory = [] // DB가 없을 때 (서버 메모리)
let ready = null

async function ensureTable() {
  if (!dbEnabled()) return false
  ready ??= query(
    `CREATE TABLE IF NOT EXISTS error_log (
       id         bigserial PRIMARY KEY,
       side       text NOT NULL,
       kind       text,
       path       text,
       status     integer,
       message    text,
       client_id  text,
       created_at timestamptz NOT NULL DEFAULT now()
     );
     CREATE INDEX IF NOT EXISTS error_log_created_idx ON error_log (created_at);`,
  )
    .then(() => query(`DELETE FROM error_log WHERE created_at < now() - interval '${KEEP_DAYS} days'`))
    .then(() => true)
    .catch((err) => {
      console.warn(`[error-log] 표를 만들지 못함: ${err.message}`)
      ready = null
      return false
    })
  return ready
}

const cut = (v, n) => (v == null ? null : String(v).slice(0, n))

export async function logError({ side = 'server', kind = null, path = null, status = null, message = '', clientId = null, at = null }) {
  const row = { side: cut(side, 10), kind: cut(kind, 40), path: cut(path, 200), status: Number.isFinite(Number(status)) ? Number(status) : null, message: cut(message, 500) ?? '', client_id: cut(clientId, 64), created_at: at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString() }
  if (!(await ensureTable())) {
    memory.unshift(row)
    memory.length = Math.min(memory.length, MEMORY_MAX)
    return
  }
  await query('INSERT INTO error_log (side, kind, path, status, message, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [row.side, row.kind, row.path, row.status, row.message, row.client_id, row.created_at]).catch((err) => console.warn(`[error-log] 기록 실패: ${err.message}`))
}

export async function listErrors(limit = 200) {
  if (!(await ensureTable())) return memory.slice(0, limit)
  const { rows } = await query('SELECT side, kind, path, status, message, client_id, created_at FROM error_log ORDER BY created_at DESC LIMIT $1', [limit])
  return rows
}
