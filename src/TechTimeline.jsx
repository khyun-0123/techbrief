// 기술 시계열 (11/10 조장): 키워드 하나로 그 기술의 배경 → 성장 → 적용 → 전망을 본다. 「무엇이 트렌드가 될지 · 무엇을 연구할지」의 기준
// 숫자 · 단계는 서버가 규칙으로 계산(server/timeline.js), 글은 「AI로 흐름 정리」를 눌렀을 때만 (1분 안팎, 근거 번호 · 사실 / AI 해설)
// 대시보드 「키워드 분석」에서 열면 이미 돌고 있는 정리(job, storyJobs.js)를 이어서 보여 준다 (11/11: 정리 중인데 버튼이 안 누른 상태로 보였음)
// 그래프는 단위가 서로 달라 따로 그린다 (한 축에 겹치지 않음). 네이버 검색 관심도는 약관상 그래프로만 (AI에 넣지 않음)
import { useEffect, useState } from 'react'
import { fetchTimeline, fetchTimelineStory } from './api.js'
import { retryStory } from './storyJobs.js'
import { Spark } from './KeywordTrends.jsx'

const SECTION_LABEL = { background: '배경 · 왜 나왔나', growth: '성장 · 어떻게 커졌나', application: '적용 · 어디에 쓰이나', outlook: '전망', research: '우리가 볼 것 · 연구 제안' }
const STAGE_HINT = {
  '신생 · 탐색': '논문이 아직 적어요. 초기 신호로 지켜볼 단계',
  '연구 성장': '논문이 빠르게 느는데 기업 참여는 아직 적어요',
  '성장 · 상용화 진입': '논문이 빠르게 늘고 기업 저자도 많아요',
  '완만한 성장': '분야 전체보다 조금 빠르게 늘어요',
  '연구 지속': '논문 수가 분야 전체와 비슷하게 늘어요',
  '성숙 · 상용화': '논문 수는 비슷하고 기업 저자 비율이 높아요',
  '정체 · 감소': '논문이 줄고 있어요',
}
const THIS_YEAR = new Date().getFullYear()
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)
const doiUrl = (p) => (p.doi ? `https://doi.org/${p.doi}` : null)

// initialData: 대시보드 「키워드 분석」이 이미 받은 값이 있으면 다시 받지 않는다
// job: 대시보드에서 이미 시작한 AI 흐름 정리 ({ status: running · done · error, story, error }). 없으면 이 창에서 버튼으로 시작
function TechTimeline({ query, onClose, initialData = null, job = null }) {
  const [data, setData] = useState(initialData)
  const [error, setError] = useState('')
  const [own, setOwn] = useState(null) // 이 창에서 「다시 정리」로 새로 받은 값 (있으면 job보다 먼저)
  const [storyState, setStoryState] = useState('idle') // idle · loading · error
  const [storyError, setStoryError] = useState('')

  useEffect(() => {
    if (initialData) return undefined
    let alive = true
    fetchTimeline(query)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [query, initialData])

  async function makeStory(refresh = false) {
    setStoryState('loading')
    setStoryError('')
    try {
      setOwn(await fetchTimelineStory(query, refresh))
      setStoryState('idle')
    } catch (err) {
      setStoryError(err.message)
      setStoryState('error')
    }
  }

  const story = own ?? (job?.status === 'done' ? job.story : null)
  const loading = storyState === 'loading' || (!own && job?.status === 'running')
  const shownError = storyError || (!own && storyState !== 'loading' && job?.status === 'error' ? job.error : '')
  // 처음 정리(실패 뒤 다시 포함)는 대시보드 작업으로 → 「한눈에」 · 진행 창도 같이 바뀐다. 「다시 정리」는 새로 만들기
  const onStory = () => (!story && job ? retryStory(query) : makeStory(Boolean(story)))

  const c = data?.corpus
  const yearly = (list) => (list ?? []).map((x) => ({ t: `${x.y}-01-01`, v: x.n }))
  // 올해는 아직 안 끝나 줄어 보이므로 그래프에서 뺀다
  const full = (list) => (list ?? []).filter((x) => x.y < THIS_YEAR)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel modal tech-timeline" role="dialog" aria-modal="true" aria-labelledby="tl-title">
        <div className="modal-head">
          <h2 id="tl-title">기술 시계열 · {query}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기" autoFocus>
            ×
          </button>
        </div>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p className="hint">논문 · 특허 · 검색 관심도를 모으는 중이에요 (처음엔 10초 안팎)…</p>}
        {data && (
          <>
            <p className="hint">
              영문 검색어 「{data.terms.join(' · ')}」{data.display ? ' · 디스플레이 분야 논문만' : ''}
              {data.corpusPartial && ' · 논문 DB를 받는 중이라 2018년 이후 값은 일부예요'}
              {data.cached && ` · ${new Date(data.at).toLocaleDateString('ko-KR')} 계산한 값`}
            </p>

            <div className="tl-stage">
              <span className="tl-stage-badge">{data.stage.stage}</span>
              <span>
                {data.stage.why}
                <span className="muted"> · {STAGE_HINT[data.stage.stage] ?? ''} (비교: {data.stage.years}, 규칙으로 판정)</span>
              </span>
            </div>
            {data.thin && (
              <p className="hint" role="note">
                참고: {data.thin}
              </p>
            )}

            <div className="tl-charts">
              <Spark title="논문 수" unit="편" monthly="year" series={yearly(full(data.long))} source="OpenAlex · 해마다" note={data.longError ?? '논문이 없어요.'} />
              <Spark
                title="기업 저자 논문 비율"
                unit="%"
                monthly="year"
                series={(full(c?.years) ?? []).map((x) => ({ t: `${x.y}-01-01`, v: Math.round(x.companyShare * 100) }))}
                source="우리 논문 DB · 2018년~"
                note="2018년 이후 논문 DB에 맞는 논문이 없어요."
              />
              <Spark
                title="특허 공개 수"
                unit="건"
                monthly="year"
                series={data.patents.status === 'ok' ? yearly(full(data.patents.years)) : []}
                source="Google Patents · 영문 제목 기준"
                note={data.patents.status === 'no_key' ? 'Google Cloud 키가 없어요.' : data.patents.error ?? '특허가 없어요.'}
              />
              <Spark
                title="네이버 검색 관심도"
                unit=""
                monthly
                series={data.naver.status === 'ok' ? data.naver.months.map((m) => ({ t: `${m.t}-01`, v: m.v })) : []}
                source="네이버 데이터랩 · 월별 · 기간 최대 100"
                note={data.naver.status === 'not_enabled' ? '네이버 「검색어 트렌드」가 꺼져 있어요.' : '검색량이 적거나 받지 못했어요.'}
              />
            </div>

            {c?.periods?.length > 0 && (
              <div className="tl-table-wrap">
                <table className="tl-table">
                  <caption>시기별 변화 (우리 논문 DB · 디스플레이 주제)</caption>
                  <thead>
                    <tr>
                      <th scope="col">시기</th>
                      <th scope="col">논문</th>
                      <th scope="col">기업 저자</th>
                      <th scope="col">논문 낸 회사</th>
                      <th scope="col">특허 많은 출원인</th>
                      <th scope="col">많이 나온 핵심어</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.periods.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.label}</th>
                        <td>{p.papers}편</td>
                        <td>{pct(p.companyShare)}</td>
                        <td>{p.companies.slice(0, 5).map((x) => `${x.name} ${x.count}`).join(', ') || '-'}</td>
                        <td>{data.patents.periods?.find((x) => x.id === p.id)?.owners.slice(0, 4).map((x) => `${x.name} ${x.count}`).join(', ') || '-'}</td>
                        <td>{p.keywords.slice(0, 6).map((k) => k.name).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {c?.rising?.length > 0 && (
              <p className="tl-rising">
                <b>최근 새로 늘어난 핵심어</b> (2018~2023 → 2024~):{' '}
                {c.rising.map((r) => (
                  <span key={r.name} className="chip">
                    {r.name} {r.before}→{r.recent}
                  </span>
                ))}
              </p>
            )}

            {data.origins.length > 0 && (
              <details className="tl-origins">
                <summary>출발점 논문 (2017년까지 인용 많은 순)</summary>
                <ol>
                  {data.origins.map((o) => (
                    <li key={o.title}>
                      {doiUrl(o) ? (
                        <a href={doiUrl(o)} target="_blank" rel="noreferrer">
                          {o.title}
                        </a>
                      ) : (
                        o.title
                      )}{' '}
                      <span className="muted">
                        · {o.year} · {o.journal || '-'} · 인용 {o.cited}
                        {o.companies.length ? ` · ${o.companies.join(', ')}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {/* 디스플레이 근거가 적은 말은 AI 흐름 정리를 하지 않는다 (server/timeline.js thinReason, 11/11) */}
            {!data.thin && (
            <div className="tl-story">
              <div className="tl-story-head">
                <h3>흐름 정리</h3>
                {!loading && (
                  <button type="button" className="btn primary" onClick={onStory}>
                    {story ? '다시 정리' : shownError ? '다시 정리하기' : 'AI로 흐름 정리 (1분 안팎)'}
                  </button>
                )}
                {loading && (
                  <span className="hint" role="status">
                    AI가 정리하는 중… (위 숫자와 근거 논문만 보고 써요{storyState === 'loading' ? '' : ' · 검색할 때 시작한 정리를 이어서 기다려요'})
                  </span>
                )}
              </div>
              {shownError && (
                <p className="ai-error" role="alert">
                  {shownError}
                </p>
              )}
              {story && (
                <>
                  {Object.entries(SECTION_LABEL).map(([k, label]) =>
                    story.story[k]?.length ? (
                      <section key={k} className="tl-story-sec">
                        <h4>{label}</h4>
                        <ul>
                          {story.story[k].map((b, i) => (
                            <li key={i}>
                              <span className={b.kind === 'fact' ? 'tl-kind fact' : 'tl-kind ai'}>{b.kind === 'fact' ? '사실' : b.unverified ? 'AI 해설 · 확인 필요' : 'AI 해설'}</span> {b.text}
                              {b.refs.length > 0 && <span className="muted"> [{b.refs.join(', ')}]</span>}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null,
                  )}
                  <details>
                    <summary>근거 논문 {story.papers.length}편</summary>
                    <ol className="tl-refs">
                      {story.papers.map((p, i) => (
                        <li key={i}>
                          {doiUrl(p) ? (
                            <a href={doiUrl(p)} target="_blank" rel="noreferrer">
                              {p.title}
                            </a>
                          ) : (
                            p.title
                          )}{' '}
                          <span className="muted">
                            · {p.year} · {p.journal || '-'} · 인용 {p.cited}
                            {p.companies.length ? ` · ${p.companies.join(', ')}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                  <p className="hint">「사실」은 숫자 · 근거 논문에서 확인되는 내용, 「AI 해설」은 해석 · 전망 · 제안이에요. 원문에서 확인해 주세요.</p>
                </>
              )}
            </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

export default TechTimeline
