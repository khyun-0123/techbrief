// 자료 직접 추가 (11/07 결정, 27 문서 3장): 링크 · DOI · 텍스트 · 파일
// 이메일로 받은 자료, 전문매체 정기 보고서 등을 올려 두고 자료 현황에서 다시 찾아 쓴다
// 11/17 조장: 「AI 요약 허용」 질문을 뺐다 — 여기 올리는 자료는 요약 · 보고서에 쓰려는 것 (서버의 aiAllowed 칸은 늘 true, 예전 자료는 그대로)
import { useState } from 'react'
import { addMaterialApi } from './api.js'
import { clientId } from './usage.js'
import Dropdown from './Dropdown.jsx'

const KINDS = [
  ['link', '링크'],
  ['doi', '논문 DOI'],
  ['text', '텍스트 붙여넣기'],
  ['file', '파일 올리기'],
]
const MAX_FILE = 10 * 1024 * 1024

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('파일을 읽지 못했어요.'))
    r.readAsDataURL(file)
  })
}

// tag: 선별에 담을 때 붙는 키워드 태그(보고 있던 검색어 · 선별 칩, 없으면 「직접 추가」) · selectByDefault: 추가하면서 선별에도 담을지 기본값
function AddMaterial({ tag = null, selectByDefault = false, onAdded, onClose }) {
  const [kind, setKind] = useState('link')
  const [url, setUrl] = useState('')
  const [doi, setDoi] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [file, setFile] = useState(null)
  const [tier, setTier] = useState('')
  const [confirming, setConfirming] = useState(false) // 11/17: 추가 전 한 번 확인
  const [select, setSelect] = useState(selectByDefault)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const ready =
    (kind === 'link' && url.trim()) ||
    (kind === 'doi' && doi.trim()) ||
    (kind === 'text' && title.trim() && text.trim().length >= 30) ||
    (kind === 'file' && file && file.size <= MAX_FILE)

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy || !confirming) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      // 11/17 조장: 「AI 요약 · 보고서에 써도 돼요」를 묻지 않음 — 여기 올리는 목적이 그것이라 늘 허용
      const input = { kind, title: title.trim(), source: source.trim(), aiAllowed: true, ...(tier && { tier: Number(tier) }) }
      if (kind === 'link') input.url = url.trim()
      if (kind === 'doi') input.doi = doi.trim()
      if (kind === 'text') input.text = text
      if (kind === 'file') Object.assign(input, { fileName: file.name, fileBase64: await readBase64(file) })
      const material = await addMaterialApi(input, clientId())
      onAdded(material, { select, tag })
      setDone(`「${material.title}」을(를) 추가했어요${select ? ' · 선별에도 담았어요' : ''}.`)
      setUrl('')
      setDoi('')
      setTitle('')
      setText('')
      setSource('')
      setFile(null)
      setConfirming(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel add-material" aria-label="자료 직접 추가">
      <div className="add-material-head">
        <h2>자료 직접 추가</h2>
        <p className="hint">메일로 받은 자료 · 전문매체 보고서 · 논문 · 보도자료를 넣어 두면 자료 현황에 남아 다시 찾을 수 있어요.</p>
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="seg" role="tablist" aria-label="자료 종류">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'seg-btn active' : 'seg-btn'} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <form className="add-material-form" onSubmit={submit}>
        {/* 11/17 조장: 한 화면에 들어가게 — 입력칸을 한 줄에 둘 · 셋씩, 작은 안내는 항목 이름 옆으로 */}
        <div className="add-material-row am-main">
          {kind === 'link' && (
            <label>
              <span className="am-lbl">
                주소 <small>페이지에서 제목 · 본문을 가져와요. 로그인이 필요한 곳은 「텍스트 붙여넣기」로</small>
              </span>
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (기사 · 블로그 · 보도자료 · PDF)" required />
            </label>
          )}
          {kind === 'doi' && (
            <label>
              <span className="am-lbl">
                DOI <small>학술지 · 날짜 · 저자 · 초록을 채워요 (유료 논문은 초록만)</small>
              </span>
              <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1002/jsid.1234 또는 https://doi.org/…" required />
            </label>
          )}
          {kind === 'file' && (
            <label>
              <span className="am-lbl">
                파일 <small>PDF · TXT · MD · HTML · EML, 10MB까지 (Word · PPT는 PDF로)</small>
                {file && file.size > MAX_FILE && <strong className="ai-error" role="alert"> 10MB를 넘어요</strong>}
              </span>
              <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,.eml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </label>
          )}
          <label>
            <span className="am-lbl">제목 {kind === 'text' ? '' : <small>비우면 자료에서 가져와요</small>}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required={kind === 'text'} />
          </label>
        </div>
        {kind === 'text' && (
          <label>
            <span className="am-lbl">
              내용 <small>메일 본문 · 보고서 내용 등 (30자 이상)</small>
            </span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} required />
          </label>
        )}
        <div className="add-material-row am-sub">
          <label>
            <span className="am-lbl">
              출처 이름 <small>선택</small>
            </span>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="예: UBI리서치 주간 보고서" maxLength={100} />
          </label>
          <label>
            <span className="am-lbl">출처 단계</span>
            <Dropdown
              value={tier}
              onChange={setTier}
              size="lg"
              label="출처 단계"
              options={[
                { value: '', label: '자동 (논문 1차 · 나머지 2차)' },
                { value: '1', label: '1차 · 기업 발표 · 학회 · 논문 · 분석 보고서' },
                { value: '2', label: '2차 · 전문매체' },
                { value: '3', label: '3차 · 일반 뉴스' },
              ]}
            />
          </label>
          <div className="am-select">
            <label className="check">
              <input type="checkbox" checked={select} onChange={(e) => setSelect(e.target.checked)} />
              선별에도 담기
            </label>
            {select && <span className="hint">태그 「{tag ?? '직접 추가'}」</span>}
          </div>
          {/* 11/17 조장: 「추가」를 누르면 한 번 확인 (공용 자료 현황에 남고 AI 요약 · 보고서에 쓰임) */}
          {confirming ? (
            <div className="am-confirm" role="alertdialog" aria-label="자료 추가 확인">
              <span>
                {kind === 'link' ? '이 주소의 자료를' : kind === 'doi' ? '이 논문을' : kind === 'file' ? `「${file?.name ?? '파일'}」을(를)` : `「${title.trim()}」을(를)`} 자료 현황에 추가할까요? 팀 모두에게 보이고 AI 요약 · 보고서에 쓰여요.
              </span>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? '가져오는 중…' : '추가'}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
                취소
              </button>
            </div>
          ) : (
            <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => setConfirming(true)}>
              자료 추가
            </button>
          )}
        </div>
        {error && <p className="ai-error" role="alert">{error}</p>}
        {done && (
          <p className="hint" role="status">
            {done}
          </p>
        )}
      </form>
    </section>
  )
}

export default AddMaterial
