// 관리 페이지 「수집 대상」 › 수집 출처 (14 문서 4-B 출처 4단계)
// - 네이버 밖 출처(RSS · 논문 검색)를 켜고 끈다. 저장 막대와 별개로 「적용」하면 다음 최신화부터 반영
// - 지난 수집 때 출처마다 받은 글 · 키워드에 맞은 글 · 새로 넣은 글 · 오류
import { useEffect, useState } from 'react'
import { withConfirm } from './AdminConfirm.jsx'
import { addSourceApi, checkSourcesApi, deleteSourceApi, fetchSources, saveSourcesApi, testSourceApi } from './api.js'

const TIERS = [
  [1, '1차 · 기업 발표 · 학회 · 논문'],
  [2, '2차 · 국내외 전문매체'],
]

function formatAt(iso) {
  return iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
}

const PAPER_NAMES = { openalex: 'OpenAlex', crossref: 'Crossref', semanticscholar: 'Semantic Scholar', arxiv: 'arXiv' }

// 논문 출처 사슬 상태 (server/papers): 순서대로 쓰고, 한도에 걸린 곳은 풀릴 때까지 건너뜀
// 디스플레이 논문 DB (11/10, server/papers/corpus.js): 찾기는 여기서 먼저 한다
function CorpusLine({ c }) {
  if (!c?.enabled) return null
  const JOB = { backfill: '처음 받기', recent: '최근 60일', citations: '최근 3년 인용 수' }
  return (
    <p className="adm-desc">
      <b>디스플레이 논문 모음</b> {c.papers.toLocaleString()}편 (초록 {c.withAbstract.toLocaleString()}편 · {c.first ?? '-'} ~ {c.last ?? '-'})
      {c.busy ? ` · ${JOB[c.phase] ?? '받는 중'}…` : c.backfillDone ? ` · 처음 받기 끝 (${c.backfillDone})` : c.backfillTotal ? ` · 처음 받기 중 (전체 약 ${c.backfillTotal.toLocaleString()}편, 남은 예산에 맞춰 이어 받음)` : ' · 아직 안 받음 (서버가 켜지고 3분 뒤 시작)'}
      {c.lastRun && ` · 마지막 ${JOB[c.lastJob] ?? c.lastJob} ${formatAt(c.lastRun)} ${c.lastSaved ?? 0}편`}
      {c.stopped && <span className="adm-state bad"> · {c.stopped}</span>}
      {c.error && <span className="adm-state bad"> · 오류 {c.error}</span>}
      . 「논문 · 뉴스에서 찾기」는 이 모음에서 먼저 찾고, 맞는 논문이 적으면 아래 출처로 찾아요.
    </p>
  )
}

// KCI 국내 논문 한 번 채우기 (11/26, server/papers/kciOai.js · npm run kci-oai). 돌린 적이 없으면 안 보임
function KciOaiLine({ k }) {
  if (!k) return null
  return (
    <p className="adm-desc">
      <b>KCI 국내 논문 (전자 · 재료 · 물리)</b> {k.papers.toLocaleString()}편{k.first ? ` (${k.first} ~ ${k.last}년)` : ''}
      {k.from && ` · 받은 범위 ${k.from} ~ ${k.until}`}
      {k.done ? ` · 끝 (${formatAt(k.finishedAt)})` : k.day ? ` · ${k.day}까지 읽음 ${(k.scanned ?? 0).toLocaleString()}건 중 ${(k.kept ?? 0).toLocaleString()}건 남김 (마지막 ${formatAt(k.updatedAt)})` : ''}
      {k.error && <span className="adm-state bad"> · 오류 {k.error} — 같은 명령으로 다시 돌리면 이어 받아요</span>}
    </p>
  )
}

function PaperProviders({ list, corpus, kciOai }) {
  if (!list?.length) return null
  return (
    <div className="adm-sources-group">
      <CorpusLine c={corpus} />
      <KciOaiLine k={kciOai} />
      <h3>논문 출처 (위에서부터 쓰고, 막히면 다음 곳)</h3>
      <ul className="adm-sources">
        {list.map((p) => (
          <li key={p.id}>
            <span className="name">
              {p.order}. {p.name}
              {p.keyed === false && <span className="muted"> · 키 없음</span>}
            </span>
            <span className="result">
              {p.state === 'limited' ? (
                <span className="adm-state bad">
                  한도 도달 · {formatAt(p.limitedUntil)} 풀림{p.reason ? ` (${p.reason})` : ''}
                </span>
              ) : (
                <span className="adm-state ok">정상</span>
              )}
              {' · '}
              {p.lastOk ? `마지막 성공 ${formatAt(p.lastOk)}` : <span className="muted">아직 안 씀</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const EVERY_LABEL = (h) => (!h ? '최신화 때마다' : h >= 168 ? '일주일마다' : `${h}시간마다`)

// 시험 · 점검 결과 한 줄 (11/25)
function TestResult({ r, onUse }) {
  if (!r) return null
  if (r.busy) return <span className="adm-src-test muted">받아 보는 중…</span>
  if (!r.ok) return <span className="adm-src-test adm-state bad">시험 실패 · {r.error}</span>
  return (
    <span className="adm-src-test">
      <span className="adm-state ok">글 {r.items}건 · {(r.ms / 1000).toFixed(1)}초</span>
      {r.newest && <span className="muted"> · 최근 글 {formatAt(r.newest)}</span>}
      {r.recommend && (
        <>
          {' '}
          · 추천 <b>{EVERY_LABEL(r.recommend.hours)}</b> <span className="muted">({r.recommend.why})</span>
          {onUse && (
            <button type="button" className="adm-link-btn" onClick={() => onUse(r.recommend.hours)}>
              이 주기로
            </button>
          )}
        </>
      )}
    </span>
  )
}

function AdminSources({ onToast }) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState([])
  const [every, setEvery] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [tests, setTests] = useState({}) // 출처 id → 시험 결과
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(null) // { name, url, tier, lang, test }
  const [group, setGroup] = useState(1) // 11/26: 보이는 출처 묶음 (1 · 2 · 'papers')

  const load = (d) => {
    setData(d)
    setOff(d.disabled)
    setEvery(d.every ?? {})
  }
  useEffect(() => {
    fetchSources()
      .then(load)
      .catch((err) => setError(err.message))
  }, [])

  if (error && !data) return <p className="adm-desc">{error}</p>
  if (!data) return <p className="adm-desc">불러오는 중…</p>

  const results = Object.fromEntries((data.status?.results ?? []).filter(Boolean).map((r) => [r.id, r]))
  const sameEvery = (a, b) => JSON.stringify(Object.entries(a).filter(([, h]) => h).sort()) === JSON.stringify(Object.entries(b).filter(([, h]) => h).sort())
  const changed = [...off].sort().join() !== [...data.disabled].sort().join() || !sameEvery(every, data.every ?? {})
  const toggle = (id) => setOff((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  const choices = data.choices ?? [0, 6, 12, 24, 168]

  async function apply() {
    setSaving(true)
    try {
      const d = await saveSourcesApi(off, Object.fromEntries(Object.entries(every).filter(([, h]) => h)))
      setData((prev) => ({ ...prev, ...d }))
      setOff(d.disabled)
      setEvery(d.every ?? {})
      onToast?.({ text: '수집 출처를 바꿨어요. 다음 최신화부터 반영돼요.' })
    } catch (err) {
      onToast?.({ text: err.message, error: true })
    } finally {
      setSaving(false)
    }
  }
  async function test(id) {
    setTests((t) => ({ ...t, [id]: { busy: true } }))
    try {
      const r = await testSourceApi({ id })
      setTests((t) => ({ ...t, [id]: r }))
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: err.message } }))
    }
  }
  async function checkAll() {
    setChecking(true)
    try {
      const d = await checkSourcesApi()
      setTests(Object.fromEntries(d.results.map((r) => [r.id, r])))
      onToast?.({ text: `켜 둔 출처 ${d.results.length}곳을 받아 봤어요 — 정상 ${d.results.filter((r) => r.ok).length}곳` })
    } catch (err) {
      onToast?.({ text: err.message, error: true })
    } finally {
      setChecking(false)
    }
  }
  const recommended = Object.values(tests).filter((r) => r?.ok && r.recommend && (every[r.id] ?? 0) !== r.recommend.hours)
  async function testNew() {
    setAdding((a) => ({ ...a, test: { busy: true } }))
    try {
      const r = await testSourceApi({ url: adding.url })
      setAdding((a) => ({ ...a, test: r }))
    } catch (err) {
      setAdding((a) => ({ ...a, test: { ok: false, error: err.message } }))
    }
  }
  async function addNew(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const d = await addSourceApi({ name: adding.name, url: adding.url, tier: adding.tier, lang: adding.lang })
      load(d)
      setAdding(null)
      onToast?.({ text: `「${d.added.name}」 출처를 더했어요 — 주기 ${EVERY_LABEL(d.every?.[d.added.id])}, 다음 최신화부터 모아요` })
    } catch (err) {
      setAdding((a) => ({ ...a, test: { ok: false, error: err.message } }))
    } finally {
      setSaving(false)
    }
  }
  // 더한 출처 지우기: 확인 창 → 서버가 비밀번호 확인을 요구하면 창(10분 유지, AdminConfirm.jsx)
  async function removeFeed(f) {
    if (!window.confirm(`「${f.name}」 출처를 지울까요? 이미 모은 글은 그대로 남아요.`)) return
    try {
      const d = await withConfirm(() => deleteSourceApi(f.id))
      load(d)
      onToast?.({ text: '출처를 지웠어요. 이미 모은 글은 그대로예요.' })
    } catch (err) {
      if (!err.cancelled) onToast?.({ text: err.message, error: true })
    }
  }

  return (
    <>
      <p className="adm-desc">
        네이버 뉴스(3차)에 더해 아래 출처에서도 모아요. 피드에는 검색이 없어서 <b>자동 수집 키워드</b>(영문 표기 포함)가 제목·요약에 있는 글만 넣어요. 제목·요약·링크만 저장해요.
        {data.status?.at && ` 지난 수집 ${formatAt(data.status.at)}.`} 출처마다 <b>수집 주기</b>를 정할 수 있어요 — 「전체 점검」을 누르면 피드마다 글이 올라오는 간격을 재서 놓치지 않을 주기를 추천해요.
      </p>
      <div className="adm-src-toolbar">
        <button type="button" className="adm-btn" onClick={checkAll} disabled={checking}>
          {checking ? '점검 중… (출처마다 받아 봄)' : '전체 점검 · 주기 추천'}
        </button>
        {recommended.length > 0 && (
          <button type="button" className="adm-btn" onClick={() => setEvery((e) => ({ ...e, ...Object.fromEntries(recommended.map((r) => [r.id, r.recommend.hours])) }))}>
            추천 주기 {recommended.length}곳 모두 고르기
          </button>
        )}
        <button type="button" className="adm-btn" onClick={() => setAdding(adding ? null : { name: '', url: '', tier: 2, lang: 'ko', test: null })}>
          {adding ? '출처 더하기 닫기' : '+ 출처 더하기'}
        </button>
      </div>
      {adding && (
        <form className="adm-conn-form adm-src-add" onSubmit={addNew}>
          <h3>새 출처 (RSS · Atom 피드)</h3>
          <label>
            이름
            <input value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} placeholder="예: 디스플레이 전문지" maxLength={40} required />
          </label>
          <label>
            피드 주소
            <input value={adding.url} onChange={(e) => setAdding((a) => ({ ...a, url: e.target.value, test: null }))} placeholder="https://…/rss.xml" inputMode="url" required />
          </label>
          <div className="adm-src-add-row">
            <label>
              출처 단계
              <select value={adding.tier} onChange={(e) => setAdding((a) => ({ ...a, tier: Number(e.target.value) }))}>
                <option value={1}>1차 · 기업 발표 · 학회 · 논문</option>
                <option value={2}>2차 · 국내외 전문매체</option>
              </select>
            </label>
            <label>
              언어
              <select value={adding.lang} onChange={(e) => setAdding((a) => ({ ...a, lang: e.target.value }))}>
                <option value="ko">국문</option>
                <option value="en">영문</option>
              </select>
            </label>
          </div>
          <TestResult r={adding.test} />
          {adding.test?.sample?.length > 0 && <small className="muted">최근 글: {adding.test.sample.join(' / ')}</small>}
          <div className="adm-actions">
            <button type="button" className="adm-btn" onClick={testNew} disabled={!adding.url || adding.test?.busy}>
              시험
            </button>
            <button type="submit" className="adm-btn primary" disabled={saving || !adding.name || !adding.url}>
              더하기
            </button>
            <small className="muted">더하기를 누르면 한 번 받아 보고, 글이 있을 때만 넣어요. 추천 주기도 함께 정해져요.</small>
          </div>
        </form>
      )}
      {/* 11/26: 묶음을 골라 보기 (예전: 1차 · 2차 · 논문 출처를 한 번에 — 화면 두 개 반). 오류가 있는 묶음은 이름 옆에 수 */}
      <div className="adm-segment adm-src-groups" role="radiogroup" aria-label="출처 묶음">
        {[...TIERS.map(([tier, label]) => [tier, label.split(' · ')[0] + ' · ' + (tier === 1 ? '기업 발표 · 학회' : '전문매체')]), ['papers', '논문 출처']].map(([g, label]) => {
          const items = g === 'papers' ? [] : data.list.filter((f) => f.tier === g)
          const bad = items.filter((f) => results[f.id] && !results[f.id].ok && !off.includes(f.id)).length
          return (
            <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => setGroup(g)}>
              {label}
              <span className="adm-subtab-n">{g === 'papers' ? data.papers?.length ?? 0 : items.length}</span>
              {bad > 0 && <span className="adm-state bad">오류 {bad}</span>}
            </button>
          )
        })}
      </div>
      {TIERS.filter(([tier]) => tier === group).map(([tier, label]) => (
        <div key={tier} className="adm-sources-group">
          <h3>{label}</h3>
          <ul className="adm-sources">
            {data.list
              .filter((f) => f.tier === tier)
              .map((f) => {
                const r = results[f.id]
                const on = !off.includes(f.id)
                // 11/17: 받기는 되는데 14일 동안 저장된 글이 없으면 표시 (논문 검색은 따로 셈)
                // 피드의 최근 글도 14일보다 오래됐으면 고장이 아니라 「새 글이 드문 곳」 (예: SID 논문집은 1년에 한 번, VESA는 1년에 두어 번)
                const st = data.stored?.[f.id]
                const dead = data.stored && !f.paper && on && !(st?.recent > 0)
                const quiet = dead && r?.newest && Date.now() - Date.parse(r.newest) > 14 * 86_400_000
                return (
                  <li key={f.id} className={on ? '' : 'is-off'}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => toggle(f.id)} />
                      <span className="name">
                        {f.name}
                        {f.custom && <span className="adm-conn-tag">더한 출처</span>}
                      </span>
                      <span className="lang">{f.paper ? `논문 검색 · ${r?.via?.length ? r.via.map((v) => PAPER_NAMES[v] ?? v).join(' · ') : 'OpenAlex 외 3곳'}` : f.lang === 'en' ? '영문' : '국문'}</span>
                    </label>
                    <span className="result">
                      {!r ? (
                        <span className="muted">아직 수집 전</span>
                      ) : r.ok ? (
                        <>
                          {r.skipped && <span className="muted">지난번엔 주기가 안 돼 건너뜀 · </span>}
                          받은 글 {r.items ?? '-'} · 키워드 맞음 <b>{r.matched ?? '-'}</b>
                          {r.added != null && ` · 새로 ${r.added}`}
                          {quiet ? (
                            <span className="muted" title="피드에 새 글이 올라오면 그때 모아요. 끌 필요 없어요">
                              {' '}
                              · 새 글이 드문 곳 (피드 최근 글 {formatAt(r.newest)})
                            </span>
                          ) : (
                            dead && (
                              <span className="adm-state warn" title={st?.last ? `마지막으로 저장된 글: ${formatAt(st.last)}` : '한 번도 저장된 적 없음'}>
                                {' '}
                                · 14일 동안 저장 0건{st?.total ? '' : ' (저장된 적 없음)'}
                              </span>
                            )
                          )}
                        </>
                      ) : (
                        <span className="adm-state bad">오류 · {r.error}</span>
                      )}
                    </span>
                    {!f.paper && (
                      <span className="adm-src-tools">
                        <label className="adm-src-every">
                          수집 주기
                          <select value={every[f.id] ?? 0} onChange={(e) => setEvery((x) => ({ ...x, [f.id]: Number(e.target.value) }))} disabled={!on}>
                            {choices.map((h) => (
                              <option key={h} value={h}>
                                {EVERY_LABEL(h)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {data.last?.[f.id] && <small className="muted">마지막으로 받음 {formatAt(data.last[f.id])}</small>}
                        <button type="button" className="adm-link-btn" onClick={() => test(f.id)} disabled={tests[f.id]?.busy}>
                          시험
                        </button>
                        {f.custom && (
                          <button type="button" className="adm-link-btn danger" onClick={() => removeFeed(f)}>
                            지우기
                          </button>
                        )}
                        <TestResult r={tests[f.id]} onUse={(h) => setEvery((x) => ({ ...x, [f.id]: h }))} />
                      </span>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
      {group === 'papers' && <PaperProviders list={data.papers} corpus={data.corpus} kciOai={data.kciOai} />}
      <div className="adm-sources-actions">
        <span className="adm-desc">
          쓸 수 없는 곳: 삼성디스플레이 · BOE 뉴스룸(RSS 없음), Display Daily · Counterpoint(접속 차단), Google 뉴스 RSS(개인 피드 리더 전용 약관). 공시(OpenDART)는 기술 내용이 적어 붙이지 않음(11/09).
        </span>
        <button type="button" className="adm-btn primary" onClick={apply} disabled={!changed || saving}>
          {saving ? '적용 중…' : '적용'}
        </button>
      </div>
    </>
  )
}

export default AdminSources
