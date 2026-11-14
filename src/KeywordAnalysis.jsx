// 대시보드 「키워드 분석」 (11/10 조장): 키워드로 찾으면 → 연관 키워드 맵 + 기술 시계열 요약 → 범위를 골라 자료 현황에서 선별
// - 왼쪽 맵은 **임시 맵**이다 (뉴스에서 함께 나온 말, server/related.js). 워드클라우드팀 맵이 오면 그림만 바꾸고 범위 고르기는 그대로 (32 문서)
//   범위 고르기: 레버 = 연관도 순으로 몇 개까지 자동으로 고를지(「일반」 말은 건너뜀) · 노드 클릭 = 예외(손으로 켜고 끈 것은 레버를 움직여도 유지)
//   「자료 찾기 →」는 고른 말이 하나 이상 든 자료만 자료 현황에 보여 준다 (11/14: 넓게/좁게 없앰, server/scopeSearch.js)
// - 오른쪽은 기술 시계열 요약(단계 · 논문 수 · 기업 저자 비율 · 특허 · 새로 늘어난 핵심어). 「자세히 · AI 흐름 정리」는 TechTimeline 창
// 예전 「추적 중인 키워드 추이」(뉴스 수 · 검색량 · 위키 · GDELT)는 11/10 조장 결정으로 대시보드에서 뺐다 — 키워드 하나를 제대로 분석하는 쪽으로
import KeywordMap from './KeywordMap.jsx'
import SplitPanes from './SplitPanes.jsx'
import { useEffect, useState } from 'react'
import { fetchBundle, fetchRelated, fetchTimeline, fetchTimelineStory } from './api.js'
import { retryStory, useStory } from './storyJobs.js'
import { Spark } from './KeywordTrends.jsx'
import TechTimeline from './TechTimeline.jsx'
import { Seg } from './Dropdown.jsx'

const THIS_YEAR = new Date().getFullYear() // 올해는 안 끝나 줄어 보이므로 그래프에서 뺀다
// 11/14 통합: 임시 맵(ScopeMap)을 워드클라우드팀 맵 v2 이식본(KeywordMap.jsx)으로 바꿈 — 분할 칸 왼쪽에 들어감

// 기다리는 동안 1초마다 지금 시각을 새로 받는다 (경과 초)
function useNow(on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}
const secs = (from, now) => (from ? Math.max(0, Math.round((now - from) / 1000)) : 0)

// 기다리는 칸 (11/11): 퍼센트 게이지는 쓰지 않는다 — AI 정리는 한 번 부르고 끝나 서버도 진행률을 모른다 (지어낸 숫자가 됨)
// 대신 ① 지금 어느 단계인지 ② 몇 초째인지(보통 걸리는 시간과 함께) ③ 무엇이 나올 자리인지(회색 자리)를 보여 주고,
// 기다리지 않아도 된다고 알린다 (떠나면 오른쪽 아래 진행 창이 이어 받는다, storyJobs.js)
function WaitSteps({ steps, note }) {
  return (
    <div className="ka-wait" role="status">
      <ol className="ka-wait-steps">
        {steps.map(([state, text]) => (
          <li key={text} className={`is-${state}`}>
            <span className="ka-wait-mark" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'now' ? '●' : '○'}
            </span>
            <span className="sr-only">{state === 'done' ? '끝남: ' : state === 'now' ? '진행 중: ' : '다음: '}</span>
            {text}
          </li>
        ))}
      </ol>
      {note && <p className="ka-wait-note">{note}</p>}
    </div>
  )
}

function GlanceWait({ startedAt }) {
  const s = secs(startedAt, useNow(true))
  const slow = s >= 60
  return (
    <div className="ka-glance is-waiting">
      <WaitSteps
        steps={[
          ['done', '논문 · 특허 숫자 받기'],
          ['now', `AI가 근거 논문을 읽고 흐름을 정리하는 중 · ${s}초째 ${slow ? '(평소보다 오래 걸려요. AI 서버에 다른 작업이 있을 수 있어요)' : '(보통 30초 안팎)'}`],
          ['next', '전망 · 우리가 볼 것'],
        ]}
        note="기다리지 않아도 돼요. 다른 키워드나 화면을 보고 있으면, 끝났을 때 오른쪽 아래 「AI 작업 진행」 창에서 알려 드려요."
      />
      <div className="ka-skeleton" aria-hidden="true">
        {['전망', '우리가 볼 것'].map((h) => (
          <div key={h}>
            <h4>{h}</h4>
            <span className="ka-bar" style={{ width: '92%' }} />
            <span className="ka-bar" style={{ width: '74%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// 「한눈에」: AI 흐름 정리 중 전망 · 우리가 볼 것 앞부분 (전체는 「자세히」 창)
// stage: 단계 배지와 같은 말을 되풀이하는 글머리는 뺀다
function Glance({ job, stage, keyword }) {
  if (!job || job.status === 'running') return <GlanceWait startedAt={job?.startedAt} />
  if (job.story?.thin) return null // 디스플레이 근거가 적어 AI 정리를 하지 않음 (단계 아래 안내, server/timeline.js thinReason)
  if (job.status === 'error')
    return (
      <p className="hint">
        AI 흐름 정리를 받지 못했어요 ({job.error}).{' '}
        <button type="button" className="link-btn" onClick={() => retryStory(keyword)}>
          다시 정리하기
        </button>
      </p>
    )
  const story = job.story
  const pick = [
    ['전망', (story.story.outlook ?? []).filter((b) => !(stage && b.text.includes(stage)))],
    ['우리가 볼 것', story.story.research ?? []],
  ]
  return (
    <div className="ka-glance">
      {pick.map(([label, list]) =>
        list.length ? (
          <div key={label}>
            <h4>{label}</h4>
            <ul>
              {list.slice(0, 2).map((b, i) => (
                <li key={i}>
                  <span className={b.kind === 'fact' ? 'tl-kind fact' : 'tl-kind ai'}>{b.kind === 'fact' ? '사실' : b.unverified ? 'AI 해설 · 확인 필요' : 'AI 해설'}</span> {b.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  )
}

// 대시보드 「키워드 분석」 패널 안(검색창 아래)에 펼쳐진다. 기간은 「자료 찾기 →」로 자료 현황에서 찾을 때만 쓴다
const MAX_SCOPE_TERMS = 30 // server/scopeSearch.js MAX_TERMS와 같게 (거르기용, 네이버는 앞 6개만 따로 부름)

function KeywordAnalysis({ keyword, onSearch, onScopeSearch, onAutoReport, periods = [], period, onPeriod }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [related, setRelated] = useState(null)
  const [relatedError, setRelatedError] = useState('')
  const [bundle, setBundle] = useState(null) // 11/12 분석 묶음 (상용화 시점 문장 등, 보고서에 자동으로 들어가는 것과 같음)
  // 고른 말 (11/14 조장): 순서 있는 목록 하나. 레버 값 = 고른 개수. 처음엔 1개
  // - 레버를 올리면 연관도 순 다음 후보(기술 · 회사, 직접 뺀 말은 건너뜀)를 뒤에 붙이고, 내리면 뒤에서부터 뺌
  // - 맵 · 칩을 눌러 빼면 개수(레버)도 같이 줄고, 눌러 넣으면 늘어남
  // - 레버 왼쪽 끝 = 주제어만, 오른쪽 끝 = 맵의 1단계 말 전부(직접 뺀 말도 다시 넣음). 11/14 조장
  const [picks, setPicks] = useState(null) // null = 아직 안 건드림(처음 1개)
  const [skip, setSkip] = useState({}) // 직접 뺀 말 — 레버를 올려도 다시 안 넣음
  const [flash, setFlash] = useState(null) // 넣고 뺄 때 「자료 찾기」 옆에 잠깐: { text, at }
  useEffect(() => {
    if (!flash) return undefined
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])
  const [open, setOpen] = useState(false)
  const [bigMap, setBigMap] = useState(false) // 맵 크게 보기 판 (11/14 조장)
  const [mapView, setMapView] = useState('map') // 칸에서 고른 보기(마인드맵 · 워드클라우드)를 크게 보기에도 그대로
  // 보기 칩 (마인드맵팀 디자인 가이드: 칸 머리 오른쪽 칩 2개, 표시 설정 창의 「보기」와 같은 값)
  const viewChips = (
    <span className="km-chips" role="group" aria-label="보기">
      {[
        ['map', '마인드맵'],
        ['cloud', '워드클라우드'],
      ].map(([v, t]) => (
        <button key={v} type="button" className="km-chip" aria-pressed={mapView === v} onClick={() => setMapView(v)}>
          {t}
        </button>
      ))}
    </span>
  )
  useEffect(() => {
    if (!bigMap) return undefined
    const esc = (e) => e.key === 'Escape' && setBigMap(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [bigMap])
  const [dataStartedAt] = useState(() => Date.now())
  const now = useNow(!data && !error)
  // AI 흐름 정리는 숫자를 받은 뒤 시작 (앱 전체에서 기다림: 이 칸을 닫아도 끝나면 진행 창이 알림, storyJobs.js)
  const job = useStory(keyword, Boolean(data))

  useEffect(() => {
    if (!keyword) return undefined
    let alive = true
    fetchRelated(keyword)
      .then((r) => alive && setRelated(r))
      .catch((err) => alive && setRelatedError(err.message))
    return () => {
      alive = false
    }
  }, [keyword])

  // 숫자 (미리 분석해 둔 말은 곧바로 옴). 받으면 위 useStory가 AI 흐름 정리를 시작한다
  useEffect(() => {
    if (!keyword) return undefined
    let alive = true
    fetchTimeline(keyword)
      .then((d) => {
        if (!alive) return
        setData(d)
        // 숫자를 받은 뒤 묶음 (서버가 /api/timeline 때 이미 만들기 시작함)
        fetchBundle(keyword)
          .then((b) => alive && setBundle(b))
          .catch(() => {})
      })
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [keyword])

  if (!keyword) return null
  const full = (list) => (list ?? []).filter((x) => x.y < THIS_YEAR)
  const nodes = related?.nodes ?? []
  // 자동으로 고를 수 있는 말: 기술 · 회사이고 너무 넓지 않은 말 (PC · TV · LG 같은 두 글자 영문은 직접 눌러야)
  const autoable = nodes.filter((n) => n.kind !== 'general' && !n.broad)
  // 처음 개수 = 서버의 자동 개수 (11/15: 고른 말이 주제어 이슈를 새로 5% 이상 덮는 동안 더함, server/related.js suggestCount). 없으면 1개
  const autoN = Math.min(autoable.length, related?.autoPick?.n ?? 1)
  const autoWords = autoable.slice(0, autoN).map((n) => n.word)
  const picked = picks ?? autoWords // 1단계 · 2단계 · 워드클라우드 말 모두 (11/14: 2단계도 개수에 넣음)
  const isAuto = picked.length === autoWords.length && picked.every((w, i) => w === autoWords[i])
  const pickedSet = new Set(picked)
  const isOn = (w) => pickedSet.has(w)
  // 레버를 올리면 붙을 다음 말: 기술 · 회사 말 먼저, 그다음 나머지 1단계 말 (연관도 순)
  const order = [...autoable, ...nodes.filter((n) => !autoable.includes(n))].map((n) => n.word)
  const candidates = order.filter((w) => !pickedSet.has(w) && !skip[w])
  const everything = [...new Set([...picked, ...order])].slice(0, MAX_SCOPE_TERMS)
  const leverMax = everything.length
  const toggle = (w) => {
    if (pickedSet.has(w)) {
      setPicks(picked.filter((x) => x !== w))
      setSkip((m) => ({ ...m, [w]: true }))
      setFlash({ text: `− 「${w}」 · 지금 ${picked.length - 1}개`, at: Date.now() })
    } else if (picked.length >= MAX_SCOPE_TERMS) {
      setFlash({ text: `한 번에 ${MAX_SCOPE_TERMS}개까지 골라요 — 하나를 빼고 넣어 주세요`, at: Date.now() })
    } else {
      setPicks([...picked, w])
      setSkip((m) => {
        const n = { ...m }
        delete n[w]
        return n
      })
      setFlash({ text: `+ 「${w}」 · 지금 ${picked.length + 1}개`, at: Date.now() })
    }
  }
  const setCount = (n) => {
    if (n >= leverMax) {
      setPicks(everything) // 오른쪽 끝 = 전부 (직접 뺀 말까지)
      setSkip({})
    } else setPicks(n >= picked.length ? [...picked, ...candidates.slice(0, n - picked.length)] : picked.slice(0, n))
  }
  function findScope() {
    if (picked.length && onScopeSearch) onScopeSearch({ query: keyword, terms: picked })
    else onSearch(keyword)
  }

  return (
    <div className="ka" aria-label={`「${keyword}」 분석`}>
      <div className="ka-head">
        <p className="ka-for">
          <b>{keyword}</b> — 연관 키워드에서 볼 범위를 고르고 기술의 흐름을 확인한 뒤 자료를 찾아요
        </p>
        <div className="ka-actions">
          {periods.length > 0 && (
            <Seg value={period} onChange={(v) => onPeriod?.(v)} label="자료 찾을 기간" options={periods} />
          )}
          {onAutoReport && related && (
            <button type="button" className="btn" onClick={() => onAutoReport({ query: keyword, terms: picked })} title="고른 범위의 자료를 중요도로 자동으로 골라 보고서까지 — 만들기 전에 확인 창이 떠요">
              자동으로 보고서 만들기
            </button>
          )}
          <span className="ka-flash" aria-live="polite" key={flash?.at}>
            {flash?.text}
          </span>
          <button type="button" className="btn primary" onClick={findScope} title={picked.length ? `「${keyword}」 자료 중 ${picked.join(' · ')}이(가) 든 것만` : `「${keyword}」 자료 전부`}>
            {picked.length ? `「${keyword}」 + ${picked.length}개로 자료 찾기 →` : `「${keyword}」 자료 찾기 →`}
          </button>
        </div>
      </div>

      {/* 11/14 조장: 맵 | 기술 시계열 비율을 끌어서 조절, 좁아지면 접힘 · × 로 닫기 · 탭 누르면 반반 (SplitPanes.jsx) */}
      <SplitPanes
        storageKey="techbrief.kaSplit"
        left={{
          title: '연관 키워드 맵',
          render: (closeBtn) => (
            <div className="ka-pane">
              <div className="ka-pane-head">
                <h3>연관 키워드 · 볼 범위</h3>
                {related && nodes.length > 0 && viewChips}
                {related && nodes.length > 0 && (
                  <button type="button" className="pane-zoom" onClick={() => setBigMap(true)} title="마인드맵 · 워드클라우드를 한 화면 크게">
                    <span aria-hidden="true">⤢</span> 크게 보기
                  </button>
                )}
                {closeBtn}
              </div>
              {related ? (
                nodes.length ? (
                  <>
                    <KeywordMap keyword={keyword} issues={related.issues} nodes={nodes} edges={related.edges} branches={related.children} isOn={isOn} onToggle={toggle} view={mapView} onView={setMapView} onEnlarge={() => setBigMap(true)} />
                    <div className="ka-controls">
                      <label>
                        자동으로 고를 범위 <b>{picked.length ? `「${keyword}」 + ${picked.length}개` : `「${keyword}」만`}</b>
                        {autoN > 0 &&
                          (isAuto ? (
                            <span className="ka-auto-note">추천 개수 · 「{keyword}」 이슈의 {Math.round((related.autoPick?.coverage ?? 0) * 100)}%를 덮어요</span>
                          ) : (
                            <button
                              type="button"
                              className="link-btn ka-auto-note"
                              onClick={() => {
                                setPicks(null)
                                setSkip({})
                              }}
                            >
                              추천 {autoN}개로
                            </button>
                          ))}
                        <input type="range" min={0} max={Math.max(1, leverMax)} className="ka-lever" style={{ '--f': Math.min(picked.length, leverMax) / Math.max(1, leverMax) }} value={Math.min(picked.length, leverMax)} onChange={(e) => setCount(Number(e.target.value))} aria-describedby="ka-auto-help" aria-valuetext={picked.length ? `「${keyword}」 + ${picked.length}개 · ${picked.join(', ')}` : `「${keyword}」만`} />
                      </label>
                      <span className="ka-lever-ends" aria-hidden="true">
                        <span>주제어만</span>
                        <span>전체 {leverMax}개</span>
                      </span>
                    </div>
                    <p className="hint ka-mode-help">「자료 찾기」는 「{keyword}」 자료 중 고른 말이 하나 이상 든 것만 보여 줘요. 더 넓게 보려면 맵에서 말을 더 고르세요.</p>
                    <p id="ka-auto-help" className="hint">
                      레버 왼쪽 끝은 주제어만, 오른쪽 끝은 맵의 말 전부예요. 처음엔 추천 개수만큼 골라 둬요 — 연관도(함께 나온 이슈 수) 순 기술 · 회사 말을 하나씩 더하다가, 「{keyword}」 이슈를 새로 5% 이상 덮지 못하면 멈춘 개수예요. 레버를 올리면 다음 말을 하나씩 더하고(기술 · 회사 말 먼저), 내리면 마지막에 더한 말부터 빼요. 맵의 점이나 글자를 눌러 넣고 빼면 개수도 같이 바뀌어요 (직접 뺀 말은 오른쪽 끝이 아니면 다시 안 들어가요). 검정 점 옆 「+n」은 그 가지를 펼쳐요.
                    </p>
                    <div className="ka-picked" aria-live="polite">
                      {picked.length ? (
                        <>
                          <span className="ka-picked-label">고른 범위</span>
                          {picked.map((w) => (
                            <button key={w} type="button" className="chip" onClick={() => toggle(w)} aria-label={`${w} 빼기`}>
                              {w} ×
                            </button>
                          ))}
                          {(picks || Object.keys(skip).length > 0) && (
                            <button
                              type="button"
                              className="link-btn ka-reset"
                              onClick={() => {
                                setPicks(null)
                                setSkip({})
                              }}
                            >
                              처음 상태로
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="hint">고른 말이 없어요. 「{keyword}」만으로 찾아요.</span>
                      )}
                    </div>
                    <span className="ka-legend">
                      점이 클수록 「{keyword}」와 함께 나온 이슈가 많음 · 재료: 뉴스(함께 나온 말, {related.issues}개 이슈) · 특허 출원인 · 논문 핵심어 (점에 마우스를 올리면 수)
                    </span>
                  </>
                ) : (
                  <p className="hint">함께 나온 말이 충분하지 않아요 (이슈 {related.issues}개). 「{keyword}」만으로 찾아요.</p>
                )
              ) : (
                <p className="hint">{relatedError || '함께 나온 말을 세는 중…'}</p>
              )}
            </div>
          ),
        }}
        right={{
          title: '기술 시계열',
          render: (closeBtn) => (
            <div className="ka-pane">
              <div className="ka-pane-head">
                <h3>기술 시계열</h3>
                {data && (
                  <button type="button" className="pane-zoom" onClick={() => setOpen(true)} title="기술 시계열 전체 · AI 흐름 정리를 한 페이지로">
                    <span aria-hidden="true">⤢</span> 크게 보기 · AI 흐름 정리
                  </button>
                )}
                {closeBtn}
              </div>
              {error && (
                <p className="ai-error" role="alert">
                  {error}
                </p>
              )}
              {!data && !error && (
                <>
                  <WaitSteps
                    steps={[
                      ['now', `논문 · 특허 숫자 받기 · ${secs(dataStartedAt, now)}초째 (처음 보는 말은 10초 안팎)`],
                      ['next', 'AI가 흐름 정리 (보통 30초 안팎)'],
                    ]}
                  />
                  <div className="ka-sparks ka-skeleton" aria-hidden="true">
                    {['논문 수', '기업 저자 비율', '특허 공개 수'].map((t) => (
                      <div key={t} className="ka-spark-wait">
                        <h4>{t}</h4>
                        <span className="ka-bar ka-bar-chart" />
                      </div>
                    ))}
                  </div>
                </>
              )}
              {data && (
                <>
                  <div className="tl-stage">
                    <span className="tl-stage-badge">{data.stage.stage}</span>
                    <span>{data.stage.why}</span>
                  </div>
                  {data.stage.attention?.label && (
                    <p className="hint" title={data.stage.attention.basis}>
                      관심 대 실질: {data.stage.attention.label} <span className="muted">({data.stage.attention.basis})</span>
                    </p>
                  )}
                  {data.thin && (
                    <p className="hint" role="note">
                      참고: {data.thin}
                    </p>
                  )}
                  <div className="ka-sparks">
                    <Spark title="논문 수" unit="편" monthly="year" series={full(data.long).map((x) => ({ t: `${x.y}-01-01`, v: x.n }))} source="OpenAlex" note={data.longError ?? '논문이 없어요.'} />
                    <Spark
                      title="기업 저자 비율"
                      unit="%"
                      monthly="year"
                      series={full(data.corpus?.years).map((x) => ({ t: `${x.y}-01-01`, v: Math.round(x.companyShare * 100) }))}
                      source="논문 DB · 2018년~"
                      note="맞는 논문이 없어요."
                    />
                    <Spark
                      title="특허 공개 수"
                      unit="건"
                      monthly="year"
                      series={data.patents.status === 'ok' ? full(data.patents.years).map((x) => ({ t: `${x.y}-01-01`, v: x.n })) : []}
                      source="Google Patents · 제목"
                      note="특허가 없거나 받지 못했어요."
                    />
                  </div>
                  <Glance job={job} stage={data.stage.stage} keyword={keyword} />
                  <dl className="ka-facts">
                    {(() => {
                      const last = data.corpus?.periods?.[2]
                      const firms = (last?.companies ?? []).slice(0, 4).map((c) => c.name)
                      const owners = data.patents.status === 'ok' ? data.patents.topOwners.slice(0, 3).map((o) => o.name) : []
                      const origin = data.origins?.[0]
                      return (
                        <>
                          {firms.length > 0 && (
                            <div>
                              <dt>논문 낸 회사 (2024~)</dt>
                              <dd>{firms.join(', ')}</dd>
                            </div>
                          )}
                          {data.stage?.patentRecent != null && data.stage.patentRecent >= 10 && data.stage.patentGrowth != null && (
                            <div>
                              <dt>특허 (같은 발명 한 번)</dt>
                              <dd>
                                최근 3년 {data.stage.patentRecent.toLocaleString()}건 · {data.stage.patentFieldGrowth != null ? `특허 분야 대비 ${data.stage.patentGrowth}배` : `앞 3년의 ${data.stage.patentGrowth}배`}
                              </dd>
                            </div>
                          )}
                          {bundle?.quotes?.length > 0 && (
                            <div>
                              <dt>상용화 시점 언급 {bundle.quotes.length}건</dt>
                              <dd title={bundle.quotes.map((x) => `「${x.text}」 — ${x.source ?? ''}`).join('\n')}>
                                「{bundle.quotes[0].text.slice(0, 70)}{bundle.quotes[0].text.length > 70 ? '…' : ''}」 — {bundle.quotes[0].source}
                              </dd>
                            </div>
                          )}
                          {owners.length > 0 && (
                            <div>
                              <dt>특허 많은 출원인</dt>
                              <dd>{owners.join(', ')}</dd>
                            </div>
                          )}
                          {data.corpus?.rising?.length > 0 && (
                            <div>
                              <dt>새로 늘어난 핵심어</dt>
                              <dd>{data.corpus.rising.slice(0, 6).map((r) => r.name).join(', ')}</dd>
                            </div>
                          )}
                          {origin && (
                            <div>
                              <dt>출발점 논문</dt>
                              <dd>
                                {origin.year} · {origin.title}
                                {origin.companies?.length ? ` (${origin.companies.join(', ')})` : ''}
                              </dd>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </dl>
                </>
              )}
            </div>
          ),
        }}
      />
      {open && <TechTimeline query={keyword} initialData={data} job={job} onClose={() => setOpen(false)} />}
      {/* 맵 크게 보기 (11/14 조장): 워드클라우드팀 맵 v2처럼 한 화면 크게 — 마인드맵 · 워드클라우드, 고른 범위는 대시보드와 같음 */}
      {bigMap && related && (
        <div className="km-full-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && setBigMap(false)}>
          <div className="km-full" role="dialog" aria-modal="true" aria-label={`「${keyword}」 연관 키워드 맵 크게 보기`}>
            <div className="km-full-head">
              <h2>
                연관 키워드 맵 <span className="km-full-kw">{keyword}</span>
              </h2>
              <span className="km-full-sub">
                고른 범위 {picked.length}개{picked.length ? ` · ${picked.slice(0, 6).join(', ')}${picked.length > 6 ? ' 외' : ''}` : ''} — 닫으면 대시보드에 그대로 남아요
              </span>
              {viewChips}
              <button type="button" className="trend-drawer-close" onClick={() => setBigMap(false)} autoFocus>
                작게 보기 <span aria-hidden="true">⤡</span>
              </button>
            </div>
            <KeywordMap keyword={keyword} issues={related.issues} nodes={nodes} edges={related.edges} branches={related.children} isOn={isOn} onToggle={toggle} large view={mapView} onView={setMapView} />
          </div>
        </div>
      )}
    </div>
  )
}

export default KeywordAnalysis

// ── 검색 전 「분석하면 이렇게 보여요」 (11/10 조장: 검색 전엔 무슨 분석을 해 주는지 와닿지 않음, 자리는 적게) ──
// 미리 분석된 실제 키워드 하나로 4칸 축소판: 연관 키워드 → 기술 단계 → 논문 · 특허 흐름 → AI 전망. 누르면 그 예시가 열린다
function MiniLine({ series }) {
  const pts = series.filter((p) => p.v != null)
  if (pts.length < 2) return null
  const max = Math.max(...pts.map((p) => p.v), 1)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 116 + 2).toFixed(1)},${(30 - (p.v / max) * 26).toFixed(1)}`).join('')
  return (
    <svg className="kp-line" viewBox="0 0 120 32" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function MiniMap({ names }) {
  const spots = [
    [20, 10],
    [100, 10],
    [12, 34],
    [108, 34],
    [60, 44],
  ]
  return (
    <svg className="kp-map" viewBox="0 0 120 48" aria-hidden="true">
      {spots.slice(0, Math.max(3, names.length)).map(([x, y], i) => (
        <g key={i}>
          <line x1={60} y1={24} x2={x} y2={y} />
          <circle cx={x} cy={y} r={4} className={i % 3 === 2 ? 'firm' : ''} />
        </g>
      ))}
      <circle cx={60} cy={24} r={7} className="center" />
    </svg>
  )
}

export function AnalysisPreview({ example, onOpen }) {
  const [data, setData] = useState(null)
  const [story, setStory] = useState(null)
  useEffect(() => {
    if (!example) return undefined
    let alive = true
    // 미리 분석된 말이라 둘 다 기억해 둔 값이 바로 온다
    fetchTimeline(example)
      .then((d) => alive && setData(d))
      .catch(() => {})
    fetchTimelineStory(example)
      .then((st) => alive && setStory(st))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [example])
  if (!example || !data) return null
  const p = data.corpus?.periods ?? []
  const names = [...(data.corpus?.rising ?? []).map((r) => r.name), ...(p[2]?.keywords ?? []).map((k) => k.name)].slice(0, 3)
  const firms = (p[2]?.companies ?? []).slice(0, 2).map((c) => c.name)
  const ai = [...(story?.story?.research ?? []), ...(story?.story?.outlook ?? [])].find((b) => !b.text.includes(data.stage.stage))
  const series = (data.long ?? []).filter((x) => x.y < THIS_YEAR).slice(-12).map((x) => ({ v: x.n }))
  return (
    <button type="button" className="kp" onClick={() => onOpen(example)} aria-label={`분석 예시 「${example}」 열기`}>
      <span className="kp-title">
        분석하면 이렇게 보여요 · 예: <b>{example}</b> <span className="kp-open">열어 보기 →</span>
      </span>
      <span className="kp-steps">
        <span className="kp-step">
          <span className="kp-label">① 연관 키워드</span>
          <MiniMap names={names} />
          <span className="kp-text">{[...names.slice(0, 2), ...firms.slice(0, 1)].join(' · ') || '기술 · 회사'}</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">② 기술 단계</span>
          <span className="tl-stage-badge kp-badge">{data.stage.stage}</span>
          <span className="kp-text">{data.stage.growth ? `논문 앞 3년의 ${data.stage.growth}배` : ''}{data.stage.companyShareNow != null ? ` · 기업 저자 ${Math.round(data.stage.companyShareNow * 100)}%` : ''}</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">③ 논문 · 특허 흐름</span>
          <MiniLine series={series} />
          <span className="kp-text">해마다 논문 · 특허 수, 낸 회사</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">④ AI 전망 · 연구 제안</span>
          <span className="kp-text kp-ai">{ai ? (ai.text.length > 70 ? `${ai.text.slice(0, 69)}…` : ai.text) : '근거 논문으로 배경 · 성장 · 적용 · 전망 정리'}</span>
        </span>
      </span>
    </button>
  )
}
