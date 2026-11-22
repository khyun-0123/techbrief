// 내 자료 옮기기 (11/08 조장: 자리 · 부서 이동 대비)
// 선별 · 폴더 · 보고서 체크 · 찾기로 담은 기사 · 최근 검색어 · 보고서 작성 입력은 이 브라우저(무작위 번호)에 묶여 있다
// → 파일로 내보내고, 새 PC · 새 브라우저에서 불러와 이어서 쓴다
// - 복원용은 JSON (폴더처럼 겹친 구조를 그대로 담음). 11/09: 엑셀 목록(CSV)은 빼고 「설정 → 정리본 받기」로 대신
// - 11/09: 즐겨찾기 ☆ · 최근 검색어는 서버(IP별)에 있으므로 파일에 같이 담고, 불러올 때 새 자리 IP로 올린다
// - 「이 파일의 사용자로 이어 쓰기」: 브라우저 번호도 옮긴다 → 「내가 만든 보고서」 · 내 보고서 · 내 자료 지우기 권한이 따라옴
// 보고서함 · 직접 추가 자료 · AI 요약은 서버에 있어 어느 브라우저에서나 보이므로 파일에 넣지 않는다
import { useEffect, useState } from 'react'
import { saveFavoritesApi } from './api.js'
import { clientId } from './usage.js'
import { load } from './utils.js'

const CLIENT_KEY = 'techbrief.clientId' // usage.js와 같음
// 옮길 브라우저 저장 항목 (키 → 설명)
const KEYS = {
  'techbrief-selected': '선별한 자료',
  'techbrief-included': '보고서에 넣으려고 체크한 자료',
  'techbrief-tags-of': '자료별 키워드 태그', // 11/22: 폴더 → 키워드 태그
  'techbrief-extra-articles': '찾기로 담은 자료',
  'techbrief-recent-searches': '최근 검색어',
  'techbrief-report-input': '보고서 제목 · 방향 · 조사 수준',
  'techbrief-cleanup-asked': '선별 정리를 물어본 보고서',
  'techbrief-last-report': '마지막 보고서',
}

function download(name, text, type) {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const stamp = () => new Date().toLocaleDateString('sv-SE') // 이 컴퓨터 날짜 (YYYY-MM-DD)

// favorites · recent: 지금 IP의 즐겨찾기 · 최근 검색어 (서버 값)
function DataMove({ favorites = [], recent = [], onClose }) {
  const [file, setFile] = useState(null) // { data, name }
  const [error, setError] = useState('')
  const [mode, setMode] = useState('merge')

  // Esc로 닫기 (다른 확인 창과 같게)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [adopt, setAdopt] = useState(true)
  const myId = clientId()

  function exportJson() {
    const data = { app: 'techbrief', version: 1, exportedAt: new Date().toISOString(), clientId: localStorage.getItem(CLIENT_KEY), items: {} }
    for (const key of Object.keys(KEYS)) data.items[key] = load(key, null)
    data.server = { favorites, recent }
    download(`techbrief-내자료-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json')
  }

  async function readFile(f) {
    setError('')
    setFile(null)
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (data?.app !== 'techbrief' || !data.items) throw new Error('테크브리프에서 내보낸 파일이 아니에요.')
      setFile({ data, name: f.name })
    } catch (err) {
      setError(err.message.startsWith('테크브리프') ? err.message : '파일을 읽지 못했어요. 「내보내기」로 받은 .json 파일을 골라 주세요.')
    }
  }

  async function apply() {
    const { items, clientId, server } = file.data
    const arr = (v) => (Array.isArray(v) ? v : [])
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
    const next = {}
    for (const key of Object.keys(KEYS)) {
      const mine = load(key, null)
      const theirs = items[key]
      if (theirs === null || theirs === undefined) continue
      if (mode === 'replace' || mine === null) {
        next[key] = theirs
      } else if (key === 'techbrief-extra-articles') {
        const ids = new Set(arr(mine).map((a) => a.id))
        next[key] = [...arr(mine), ...arr(theirs).filter((a) => !ids.has(a.id))]
      } else if (key === 'techbrief-tags-of' || key === 'techbrief-report-input') {
        next[key] = { ...obj(theirs), ...obj(mine) }
      } else if (Array.isArray(mine)) {
        next[key] = [...new Set([...mine, ...arr(theirs)])]
      } else {
        next[key] = mine
      }
    }
    try {
      for (const [k, v] of Object.entries(next)) localStorage.setItem(k, JSON.stringify(v))
      if (adopt && clientId) localStorage.setItem(CLIENT_KEY, clientId)
    } catch {
      setError('브라우저 저장 공간에 쓰지 못했어요.')
      return
    }
    // 즐겨찾기 · 최근 검색어 → 이 자리(IP)의 서버 값으로
    if (server) {
      const pick = (theirs, mine) => (mode === 'replace' ? theirs ?? [] : [...new Set([...(mine ?? []), ...(theirs ?? [])])])
      await saveFavoritesApi({ favorites: pick(server.favorites, favorites), recent: pick(server.recent, recent).slice(0, 10) }).catch(() => {})
    }
    window.location.reload()
  }

  const count = (key) => (Array.isArray(file?.data.items[key]) ? file.data.items[key].length : 0)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel modal data-move" role="dialog" aria-modal="true" aria-label="새 자리로 옮기기">
        <div className="modal-head">
          <h2>새 자리로 옮기기</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기" autoFocus>
            ×
          </button>
        </div>
        <p className="hint">
          선별 · 폴더 · 보고서 체크 · 찾기로 담은 기사는 <strong>이 브라우저</strong>에, 즐겨찾기 · 최근 검색어는 <strong>지금 자리(IP)</strong>에 저장돼요. 자리를 옮기거나 다른 PC · 브라우저에서 쓰려면 파일로 내보내고 새 자리에서 불러오세요. 내 보고서 · 직접 추가한 자료 · AI 요약은 서버에 있어 어디서나 보여요.
        </p>

        <h3>내보내기</h3>
        <div className="data-move-row">
          <button type="button" className="btn primary" onClick={exportJson}>
            내 자료 파일 받기 (.json)
          </button>
        </div>
        <p className="hint">새 자리에서 그대로 되살리는 파일이에요. 읽기용 정리본(보고서 · 선별 목록)은 「설정 → 내 보고서 · 선별 정리본 받기」로 받아요. 이 브라우저 번호: {myId ? `${String(myId).slice(0, 8)}…` : '없음'}</p>

        <h3>불러오기</h3>
        <input type="file" accept=".json,application/json" onChange={(e) => readFile(e.target.files?.[0])} aria-label="내 자료 파일 고르기" />
        {error && <p className="ai-error" role="alert">{error}</p>}
        {file && (
          <div className="data-move-preview">
            <p>
              <strong>{file.name}</strong> · {new Date(file.data.exportedAt).toLocaleString('ko-KR')} 내보냄 · 선별 {count('techbrief-selected')}건 · 보고서 체크 {count('techbrief-included')}건
            </p>
            <div className="composer-tabs" role="radiogroup" aria-label="불러오는 방법">
              <button type="button" role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'active' : ''} onClick={() => setMode('merge')}>
                지금 것과 합치기
              </button>
              <button type="button" role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>
                파일 것으로 바꾸기
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} />
              이 파일의 사용자로 이어 쓰기 <small>(「내가 만든 보고서」 · 내 보고서 · 내 자료 지우기 권한이 따라와요)</small>
            </label>
            <button type="button" className="btn primary" onClick={apply}>
              불러오고 새로고침
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

export default DataMove
