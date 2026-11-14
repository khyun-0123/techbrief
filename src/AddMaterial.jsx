// 자료 직접 추가 (11/07 결정, 27 문서 3장): 링크 · DOI · 텍스트 · 파일
// 이메일로 받은 자료, 전문매체 정기 보고서 등을 올려 두고 자료 현황에서 다시 찾아 쓴다
// 유료 보고서처럼 계약상 AI에 넣으면 안 되는 자료는 「AI 요약 허용」을 끈다 → 요약 · 보고서에 넣지 않음
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

// folders: 담을 폴더 목록 (없으면 폴더 고르기 숨김) · defaultFolder · selectByDefault: 추가하면서 선별에도 담을지 기본값
function AddMaterial({ folders, defaultFolder, selectByDefault = false, onAdded, onClose }) {
  const [kind, setKind] = useState('link')
  const [url, setUrl] = useState('')
  const [doi, setDoi] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [file, setFile] = useState(null)
  const [tier, setTier] = useState('')
  const [aiAllowed, setAiAllowed] = useState(true)
  const [select, setSelect] = useState(selectByDefault)
  const [folderId, setFolderId] = useState(defaultFolder)
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
    if (!ready || busy) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const input = { kind, title: title.trim(), source: source.trim(), aiAllowed, ...(tier && { tier: Number(tier) }) }
      if (kind === 'link') input.url = url.trim()
      if (kind === 'doi') input.doi = doi.trim()
      if (kind === 'text') input.text = text
      if (kind === 'file') Object.assign(input, { fileName: file.name, fileBase64: await readBase64(file) })
      const material = await addMaterialApi(input, clientId())
      onAdded(material, { select, folderId })
      setDone(`「${material.title}」을(를) 추가했어요${select ? ' · 선별에도 담았어요' : ''}.`)
      setUrl('')
      setDoi('')
      setTitle('')
      setText('')
      setSource('')
      setFile(null)
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
        {kind === 'link' && (
          <label>
            주소
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (기사 · 블로그 · 보도자료 · PDF)" required />
            <small>페이지에서 제목과 본문을 가져와요. 로그인이 필요한 페이지는 「텍스트」로 붙여 넣어 주세요.</small>
          </label>
        )}
        {kind === 'doi' && (
          <label>
            DOI
            <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1002/jsid.1234 또는 https://doi.org/…" required />
            <small>학술지 · 날짜 · 저자 · 초록을 채워요 (Crossref). 유료 논문은 초록만 들어가요.</small>
          </label>
        )}
        {kind === 'file' && (
          <label>
            파일
            <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,.eml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            <small>
              PDF · TXT · MD · HTML · EML(메일 저장 파일), 10MB까지. Word · PPT는 PDF로 저장해 올려 주세요. 스캔한 그림 PDF는 글자를 읽지 못해요.
              {file && file.size > MAX_FILE && <strong className="ai-error" role="alert"> 파일이 10MB를 넘어요.</strong>}
            </small>
          </label>
        )}
        <label>
          제목 {kind === 'text' ? '' : <small>(비우면 자료에서 가져와요)</small>}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required={kind === 'text'} />
        </label>
        {kind === 'text' && (
          <label>
            내용
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="메일 본문 · 보고서 내용 등 (30자 이상)" required />
          </label>
        )}
        <div className="add-material-row">
          <label>
            출처 이름 <small>(선택)</small>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="예: UBI리서치 주간 보고서" maxLength={100} />
          </label>
          <label>
            출처 단계
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
        </div>
        <label className="check">
          <input type="checkbox" checked={aiAllowed} onChange={(e) => setAiAllowed(e.target.checked)} />
          AI 요약 · 보고서에 써도 돼요
          <small>유료 보고서처럼 계약상 AI에 넣으면 안 되는 자료는 끄세요. 끄면 보관만 하고 사람이 읽어요.</small>
        </label>
        <div className="add-material-row">
          <label className="check">
            <input type="checkbox" checked={select} onChange={(e) => setSelect(e.target.checked)} />
            선별에도 담기
          </label>
          {folders && select && (
            <label>
              담을 폴더
              <Dropdown value={folderId} onChange={setFolderId} size="lg" label="담을 폴더" options={folders.map((f) => ({ value: f.id, label: f.name }))} />
            </label>
          )}
        </div>
        {error && <p className="ai-error" role="alert">{error}</p>}
        {done && (
          <p className="hint" role="status">
            {done}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={!ready || busy}>
          {busy ? '가져오는 중…' : '자료 추가'}
        </button>
      </form>
    </section>
  )
}

export default AddMaterial
