// 대시보드 「키워드 분석」 (11/10 조장): 키워드로 찾으면 → 연관 키워드 맵 + 기술 시계열 요약 → 범위를 골라 자료 현황에서 선별
// - 왼쪽 맵은 **임시 맵**이다 (뉴스에서 함께 나온 말, server/related.js). 워드클라우드팀 맵이 오면 그림만 바꾸고 범위 고르기는 그대로 (32 문서)
//   범위 고르기: 레버 = 연관도 순으로 몇 개까지 자동으로 고를지(「일반」 말은 건너뜀) · 노드 클릭 = 예외(손으로 켜고 끈 것은 레버를 움직여도 유지)
//   「자료 찾기 →」는 고른 말이 하나 이상 든 자료만 자료 현황에 보여 준다 (11/14: 넓게/좁게 없앰, server/scopeSearch.js)
// - 오른쪽은 기술 시계열 요약(단계 · 논문 수 · 기업 저자 비율 · 특허 · 새로 늘어난 핵심어). 「자세히 · AI 흐름 정리」는 TechTimeline 창
// 예전 「추적 중인 키워드 추이」(뉴스 수 · 검색량 · 위키 · GDELT)는 11/10 조장 결정으로 대시보드에서 뺐다 — 키워드 하나를 제대로 분석하는 쪽으로
import KeywordMap from './KeywordMap.jsx'
import SplitPanes from './SplitPanes.jsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchBundle, fetchRelated, fetchTimeline, fetchTopPatents, fetchWordArticles } from './api.js'
import { retryStory, useStory } from './storyJobs.js'
import { Spark } from './KeywordTrends.jsx'
import TechTimeline from './TechTimeline.jsx'
import TimelineExtras from './TimelineExtras.jsx'
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

// 예상 시간 막대 (11/17 조장: 「빈 화면이면 이상하게 생각할 수 있다 — 시간 예측해서 로딩되는 걸 보여 주자」)
// 퍼센트 숫자는 쓰지 않는다(서버도 진행률을 모름, 위 11/11 원칙). 대신 「보통 걸리는 시간」을 기준으로 막대가 차고,
// 그 시간을 넘으면 끝을 모르는 움직이는 막대로 바꾸고 이유를 알린다. 막대 옆 글자는 실제로 지난 초와 보통 시간
function EtaBar({ startedAt, expect, label = '보통', slowNote }) {
  const s = secs(startedAt, useNow(true))
  const over = s >= expect
  const pct = Math.min(92, Math.round((s / expect) * 100))
  return (
    <div className={over ? 'eta is-over' : 'eta'}>
      <span className="eta-track" aria-hidden="true">
        <span className="eta-fill" style={over ? undefined : { width: `${pct}%` }} />
      </span>
      <span className="eta-text">
        {s}초째 · {label} {expect}초 안팎
      </span>
      {over && slowNote && <p className="ka-wait-note">{slowNote}</p>}
    </div>
  )
}

// 맵을 기다리는 자리 (11/17): 글자 한 줄만 있어 빈 화면처럼 보였음 → 단계 · 예상 시간 · 맵 자리
function MapWait({ startedAt }) {
  return (
    <div className="km-wait">
      <WaitSteps
        steps={[
          ['now', '모은 자료 · 뉴스에서 함께 나온 말 세기 (형태소 분석)'],
          ['next', '볼 범위 추천 개수 고르기'],
        ]}
      />
      <EtaBar startedAt={startedAt} expect={5} label="처음 보는 말은" slowNote="평소보다 오래 걸려요. 네이버 응답을 기다리는 중일 수 있어요. 요즘 뜨는 기술 · 자동 수집 키워드처럼 미리 분석된 말은 바로 떠요." />
      <div className="km-wait-art" aria-hidden="true">
        <span className="km-wait-dot is-center" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="km-wait-dot" style={{ '--a': `${i * 60}deg` }} />
        ))}
      </div>
    </div>
  )
}

function GlanceWait({ startedAt }) {
  return (
    <div className="ka-glance is-waiting">
      <WaitSteps
        steps={[
          ['done', '논문 · 특허 숫자 받기'],
          ['now', 'AI가 근거 논문을 읽고 흐름을 정리하는 중'],
          ['next', '전망 · 우리가 볼 것'],
        ]}
      />
      <EtaBar startedAt={startedAt} expect={30} slowNote="평소보다 오래 걸려요. AI 서버에 다른 작업이 있을 수 있어요." />
      <p className="ka-wait-note">기다리지 않아도 돼요. 다른 키워드나 화면을 보고 있으면, 끝났을 때 오른쪽 아래 「AI 작업 진행」 창에서 알려 드려요.</p>
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

// 바뀐 문장을 잠시 뒤 한 번만 화면 읽기 프로그램에 (계속 바뀌면 마지막 것만)
function Spoken({ text, delay = 900 }) {
  const [said, setSaid] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSaid(text), delay)
    return () => clearTimeout(t)
  }, [text, delay])
  return (
    <span className="sr-only" aria-live="polite">
      {said}
    </span>
  )
}

function KeywordAnalysis({ keyword, autoNote = null, onSearch, onScopeSearch, onAutoReport, nextSlot = null, onStage }) {
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
  // 관련 기사 칸 (11/15, 마인드맵 가이드): 맵에서 점을 눌러 범위에 넣은 말의 기사 3건. 「숨기기」로 닫음
  const [relWord, setRelWord] = useState(null)
  const [relArticles, setRelArticles] = useState(null) // { word, articles } | { word, error }
  useEffect(() => {
    if (!relWord) return undefined
    let alive = true
    fetchWordArticles(keyword, relWord)
      .then((d) => alive && setRelArticles({ word: relWord, articles: d.articles }))
      .catch((err) => alive && setRelArticles({ word: relWord, error: err.message }))
    return () => {
      alive = false
    }
  }, [keyword, relWord])
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
    <Seg
      value={mapView}
      onChange={setMapView}
      label="보기"
      size="md"
      options={[
        { value: 'map', label: '마인드맵' },
        { value: 'cloud', label: '워드클라우드' },
      ]}
    />
  )
  useEffect(() => {
    if (!bigMap) return undefined
    const esc = (e) => e.key === 'Escape' && setBigMap(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [bigMap])
  const [dataStartedAt] = useState(() => Date.now())
  const [relatedStartedAt] = useState(() => Date.now())
  // AI 흐름 정리는 숫자를 받은 뒤 시작 (앱 전체에서 기다림: 이 칸을 닫아도 끝나면 진행 창이 알림, storyJobs.js)
  // 11/18 조장: 검색하는 순간 AI 대기열에 넣는다 (예전엔 시계열 숫자를 받은 뒤 시작 → 3~4초 안에 닫으면 아예 안 걸렸음).
  // 서버(timelineStory)가 시계열을 스스로 만든 뒤 쓰므로 화면이 숫자를 기다릴 필요가 없다. 닫아도 끝까지 하고 진행 창에 「정리 끝」
  const job = useStory(keyword, true)

  // 대표 특허 3건 (11/22): 특허 내용을 자료로 — 누르면 초록, 제목은 Google Patents 원문
  const [topPatents, setTopPatents] = useState([])
  useEffect(() => {
    if (!keyword) return undefined
    let alive = true
    fetchTopPatents(keyword)
      .then((p) => alive && setTopPatents(p))
      .catch(() => alive && setTopPatents([]))
    return () => {
      alive = false
    }
  }, [keyword])

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
    fetchTimeline(keyword, false, { open: true })
      .then((d) => {
        if (!alive) return
        setData(d)
        onStage?.(d?.stage?.stage ?? null) // 11/22 A안: 대시보드 제목 띠에 단계
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
  // 11/15: 서버가 정한 auto(너무 넓지 않고 기술 · 회사이거나, 일반이라도 주제어 이슈 15% 이상 · 논문 · 특허 재료 점은 제외)를 따름 — 자동 개수 계산과 같은 순서
  const autoable = nodes.filter((n) => n.auto ?? (n.kind !== 'general' && !n.broad))
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
      setRelWord(w)
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

  // 고른 범위가 주제어 이슈를 얼마나 덮는지: 추천 순서(서버 autoPick.steps)대로 고른 경우에만 정확한 값이 있다
  const coverage = (() => {
    const steps = related?.autoPick?.steps ?? []
    if (!picked.length || picked.length > steps.length || !picked.every((w, i) => steps[i]?.word === w)) return null
    return steps[picked.length - 1].coverage
  })()
  const shown = picked.slice(0, 4)
  const scopeLine = `「${keyword}」${picked.length ? ` + ${shown.join(', ')}${picked.length > shown.length ? ` 외 ${picked.length - shown.length}개` : ''}` : '만'}${coverage != null ? ` · 이슈 ${Math.round(coverage * 100)}% 포함` : ''}`
  const nextBar = (
    <div id="ka-next" className="ka-next" role="region" aria-label="선택한 범위와 다음 단계" tabIndex={-1}>
      <p className="ka-next-scope" title={picked.length ? `「${keyword}」 + ${picked.join(', ')}` : undefined}>
        <span className="ka-next-label">선택한 범위</span>
        <b>「{keyword}」</b>
        {picked.length ? (
          <>
            {' '}
            + {shown.join(', ')}
            {picked.length > shown.length && <span className="muted"> 외 {picked.length - shown.length}개</span>}
          </>
        ) : (
          '만'
        )}
        {coverage != null && <span className="muted"> · 이슈 {Math.round(coverage * 100)}% 포함</span>}
      </p>
      {/* 화면 읽기 프로그램: 범위가 바뀌면 잠시 뒤 한 번만 읽는다 (맵 · 레버를 여러 번 바꾸면 마지막 것만) */}
      <Spoken text={`선택한 범위 ${scopeLine}`} />
      <span className="ka-flash" aria-hidden="true" key={flash?.at}>
        {flash?.text}
      </span>
      <div className="ka-next-actions">
        {onAutoReport && (
          <button type="button" className="btn ka-next-auto" onClick={() => onAutoReport({ query: keyword, terms: picked })} title="고른 범위의 자료를 중요도로 자동으로 골라 보고서까지 — 만들기 전에 확인 창이 떠요">
            보고서까지 자동 진행
          </button>
        )}
        <button type="button" className="btn primary ka-next-go" onClick={findScope} title={picked.length ? `「${keyword}」 자료 중 ${picked.join(' · ')}이(가) 든 것만` : `「${keyword}」 자료 전부`}>
          자료 선별하기 <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  )
  return (
    <div className="ka" aria-label={`「${keyword}」 분석`}>
      {/* 11/22 시안 2차 검토: 위 「「키워드」 + n개」 줄은 아래 범위 바와 겹쳐 뺌. 1위를 저절로 고른 안내는 검색칸 회색 안내 + 화면 읽기용으로만 */}
      {autoNote && <p className="sr-only">{autoNote}</p>}
      {/* 「자료 선별하기 · 보고서까지 자동 진행」은 아래 고정 바 — 키보드는 여기서 건너뛸 수 있다 */}
      <a className="skip-next" href="#ka-next">
        다음 단계(자료 선별)로 건너뛰기
      </a>

      {/* 11/14 조장: 맵 | 기술 시계열 비율을 끌어서 조절, 좁아지면 접힘 · × 로 닫기 · 탭 누르면 반반 (SplitPanes.jsx) */}
      <SplitPanes
        storageKey="techbrief.kaSplit"
        left={{
          title: '연관 키워드 맵',
          render: (closeBtn) => (
            <div className="ka-pane">
              <div className="ka-pane-head">
                <h3>연관 키워드</h3>
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
                    {relWord && (
                      <section className="ka-rel" aria-live="polite" aria-label={`「${relWord}」 관련 자료`}>
                        <div className="ka-rel-head">
                          <b>「{relWord}」 관련 자료</b>
                          <span className="hint">「{keyword}」와 함께 나온 자료 · 제목에 그 말이 든 것 먼저</span>
                          <button type="button" className="btn-text" onClick={() => setRelWord(null)}>
                            숨기기
                          </button>
                        </div>
                        {relArticles?.word !== relWord ? (
                          <p className="hint">찾는 중…</p>
                        ) : relArticles.error ? (
                          <p className="hint">관련 자료를 못 불러왔어요 ({relArticles.error})</p>
                        ) : relArticles.articles.length ? (
                          <ol className="ka-rel-list">
                            {relArticles.articles.map((a) => (
                              <li key={a.url}>
                                <a href={a.url} target="_blank" rel="noreferrer">
                                  {a.title}
                                </a>
                                <span className="ka-rel-meta">
                                  {a.source} · {new Date(a.publishedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                  {a.from === 'naver' ? ' · 네이버 검색' : ''}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="hint">「{keyword}」와 「{relWord}」가 함께 나온 자료가 아직 없어요.</p>
                        )}
                      </section>
                    )}
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
                    {/* 11/16 검수: 「글이 너무 많다」 → 레버 · 맵 설명 세 문단을 접어 둠 (aria-describedby는 접혀도 읽힘) */}
                    <details className="ka-help">
                      <summary>레버 · 맵 읽는 법</summary>
                      <p className="hint">「자료 선별하기」는 「{keyword}」 자료 중 고른 말이 하나 이상 든 것만 보여 줘요. 더 넓게 보려면 맵에서 말을 더 고르세요.</p>
                      <p id="ka-auto-help" className="hint">
                        레버 왼쪽 끝은 주제어만, 오른쪽 끝은 맵의 말 전부예요. 처음엔 추천 개수만큼 골라 둬요 — 연관도(함께 나온 이슈 수) 순 기술 · 회사 말을 하나씩 더하다가, 「{keyword}」 이슈를 새로 5% 이상 덮지 못하면 멈춘 개수예요. 레버를 올리면 다음 말을 하나씩 더하고(기술 · 회사 말 먼저), 내리면 마지막에 더한 말부터 빼요. 맵의 점이나 글자를 눌러 넣고 빼면 개수도 같이 바뀌어요 (직접 뺀 말은 오른쪽 끝이 아니면 다시 안 들어가요). 점 옆 「+n」은 그 가지를 펼쳐요.
                      </p>
                      <p className="hint">
                        점이 클수록 「{keyword}」와 함께 나온 이슈가 많음 · 재료: 뉴스 · 모은 기사(전체 기간) · AI 요약 문장 {related.issues}개 이슈{related.words === 'kiwi' ? ' (형태소 분석으로 명사만)' : ''} · 특허 출원인 · 논문 핵심어 (점에 마우스를 올리면 수)
                      </p>
                    </details>
                    {/* 11/22 팀 회의: 맵 아래 「고른 범위」 칩 줄은 뺌 — 맵의 ✓ 표시로 확인한다 */}
                  </>
                ) : (
                  <p className="hint">함께 나온 말이 충분하지 않아요 (이슈 {related.issues}개). 「{keyword}」만으로 찾아요.</p>
                )
              ) : (
                relatedError ? <p className="hint">{relatedError}</p> : <MapWait startedAt={relatedStartedAt} />
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
                      ['now', '논문 · 특허 숫자 받기'],
                      ['next', 'AI가 흐름 정리 (보통 30초 안팎)'],
                    ]}
                  />
                  <EtaBar startedAt={dataStartedAt} expect={10} label="처음 보는 말은" slowNote="평소보다 오래 걸려요. 논문 DB(OpenAlex) 응답을 기다리는 중일 수 있어요." />
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
                    <Spark title="논문 수" unit="편" monthly="year" bars series={full(data.long).map((x) => ({ t: `${x.y}-01-01`, v: x.n }))} source="OpenAlex" note={data.longError ?? '논문이 없어요.'} />
                    <Spark
                      title="기업 저자 비율"
                      unit="%"
                      monthly="year"
                      bars
                      series={full(data.corpus?.years).map((x) => ({ t: `${x.y}-01-01`, v: Math.round(x.companyShare * 100) }))}
                      source="논문 DB · 2018년~"
                      note="맞는 논문이 없어요."
                    />
                    <Spark
                      title="특허 공개 수"
                      unit="건"
                      monthly="year"
                      bars
                      series={data.patents.status === 'ok' ? full(data.patents.years).map((x) => ({ t: `${x.y}-01-01`, v: x.n })) : []}
                      source="Google Patents · 제목"
                      note="특허가 없거나 받지 못했어요."
                    />
                  </div>
                  <Glance job={job} stage={data.stage.stage} keyword={keyword} />
                  {/* 11/25 팀 검수: 논문 낸 회사 · 특허 · 상용화 언급 · 대표 특허 · 세부 분류는 길어서 접었다 펼침 (처음엔 접힘) */}
                  <details className="ka-facts-wrap">
                    <summary>세부 근거 — 논문 낸 회사 · 특허 · 상용화 언급 · 대표 특허 · 세부 분류</summary>
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
                                {data.stage.patentIntlShare != null && ` · 해외 출원(2개국 이상) ${Math.round(data.stage.patentIntlShare * 100)}%`}
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
                          {topPatents.length > 0 && (
                            <div>
                              <dt>대표 특허</dt>
                              <dd>
                                <ul className="ka-patents">
                                  {topPatents.map((p) => (
                                    <li key={p.url}>
                                      <details>
                                        <summary title="누르면 초록">
                                          {p.title} <span className="muted">· {p.owner} · {p.year}{p.countries >= 2 ? ` · ${p.countries}개국` : ''}</span>
                                        </summary>
                                        <p>{p.abstract}</p>
                                        <a href={p.url} target="_blank" rel="noreferrer">
                                          원문 (Google Patents{p.patentNo ? ` ${p.patentNo}` : ''})
                                        </a>
                                      </details>
                                    </li>
                                  ))}
                                </ul>
                              </dd>
                            </div>
                          )}
                          {/* 세부 기술 분류 (11/17 R11, keywordBundle.js categoryMix): 이 말 특허가 걸친 분류 · 분류 전체 특허 추이 */}
                          {bundle?.categoryMix?.items?.length > 0 && (
                            <div>
                              <dt>세부 기술 분류 (특허)</dt>
                              <dd title={bundle.categoryMix.span ? `괄호 안 배수: 그 분류 전체 특허 ${bundle.categoryMix.span}` : undefined}>
                                {bundle.categoryMix.items.map((x) => `${x.name} ${x.share}%${x.ratio != null ? ` (분류 특허 ${x.ratio}배)` : ''}`).join(' · ')}
                              </dd>
                            </div>
                          )}
                          {/* 소부장 기업 특허 (11/17 R10, server/suppliers.js): 관리 페이지 「회사 › 소부장 기업」 목록 */}
                          {bundle?.suppliers?.items?.length > 0 && (
                            <div>
                              <dt>소부장 기업 특허 ({bundle.suppliers.years})</dt>
                              <dd>{bundle.suppliers.items.slice(0, 4).map((x) => `${x.name}(${x.kind}) ${x.count}건`).join(', ')}</dd>
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
                  </details>
                  {/* 화면이 넓으면 「크게 보기」 내용을 더 (11/18 조장, TimelineExtras.jsx) */}
                  <TimelineExtras keyword={keyword} data={data} job={job} />
                </>
              )}
            </div>
          ),
        }}
      />
      {/* 하단 고정 바 (11/22 조장 시안): 대시보드가 준 자리(nextSlot, 세 칸 아래 전체 폭)에. 자리가 없으면 분석 칸 맨 아래 */}
      {nextSlot ? createPortal(nextBar, nextSlot) : nextBar}
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
