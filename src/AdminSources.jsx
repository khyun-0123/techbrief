// 관리 페이지 「수집 대상」 › 수집 출처 (14 문서 4-B 출처 4단계)
// - 네이버 밖 출처(RSS · 논문 검색)를 켜고 끈다. 저장 막대와 별개로 「적용」하면 다음 최신화부터 반영
// - 지난 수집 때 출처마다 받은 글 · 키워드에 맞은 글 · 새로 넣은 글 · 오류
import { useEffect, useState } from 'react'
import { fetchSources, saveSourcesApi } from './api.js'

const TIERS = [
  [1, '1차 · 기업 발표 · 학회 · 논문'],
  [2, '2차 · 국내외 전문매체'],
]

function formatAt(iso) {
  return iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
}

function AdminSources({ onToast }) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSources()
      .then((d) => {
        setData(d)
        setOff(d.disabled)
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="adm-desc">{error}</p>
  if (!data) return <p className="adm-desc">불러오는 중…</p>

  const results = Object.fromEntries((data.status?.results ?? []).filter(Boolean).map((r) => [r.id, r]))
  const changed = [...off].sort().join() !== [...data.disabled].sort().join()
  const toggle = (id) => setOff((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))

  async function apply() {
    setSaving(true)
    try {
      const d = await saveSourcesApi(off)
      setData((prev) => ({ ...prev, ...d }))
      setOff(d.disabled)
      onToast?.({ text: '수집 출처를 바꿨어요. 다음 최신화부터 반영돼요.' })
    } catch (err) {
      onToast?.({ text: err.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="adm-desc">
        네이버 뉴스(3차)에 더해 아래 출처에서도 모아요. 피드에는 검색이 없어서 <b>자동 수집 키워드</b>(영문 표기 포함)가 제목·요약에 있는 글만 넣어요. 제목·요약·링크만 저장해요.
        {data.status?.at && ` 지난 수집 ${formatAt(data.status.at)}.`}
      </p>
      {TIERS.map(([tier, label]) => (
        <div key={tier} className="adm-sources-group">
          <h3>{label}</h3>
          <ul className="adm-sources">
            {data.list
              .filter((f) => f.tier === tier)
              .map((f) => {
                const r = results[f.id]
                const on = !off.includes(f.id)
                return (
                  <li key={f.id} className={on ? '' : 'is-off'}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => toggle(f.id)} />
                      <span className="name">{f.name}</span>
                      <span className="lang">{f.paper ? '논문 검색 · Crossref' : f.lang === 'en' ? '영문' : '국문'}</span>
                    </label>
                    <span className="result">
                      {!r ? (
                        <span className="muted">아직 수집 전</span>
                      ) : r.ok ? (
                        <>
                          받은 글 {r.items} · 키워드 맞음 <b>{r.matched}</b>
                          {r.added != null && ` · 새로 ${r.added}`}
                        </>
                      ) : (
                        <span className="adm-state bad">오류 · {r.error}</span>
                      )}
                    </span>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
      <div className="adm-sources-actions">
        <span className="adm-desc">
          쓸 수 없는 곳: 삼성디스플레이 · BOE 뉴스룸(RSS 없음), Display Daily · Counterpoint(접속 차단), Google 뉴스 RSS(개인 피드 리더 전용 약관). 공시(OpenDART) · 논문 키가 필요한 곳은 키 발급 뒤 연결.
        </span>
        <button type="button" className="adm-btn primary" onClick={apply} disabled={!changed || saving}>
          {saving ? '적용 중…' : '적용'}
        </button>
      </div>
    </>
  )
}

export default AdminSources
