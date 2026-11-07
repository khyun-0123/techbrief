// 키워드 추이 (22 문서 6-4, 21 문서 6-2 시각화). 대시보드에 항상 보임 (11/07 팀 회의에서 기본 기능으로)
// 키워드마다 카드 하나 + 작은 그래프 네 개. 단위가 서로 달라 한 축에 겹치지 않고 따로 그린다
// - 뉴스 기사량(우리 수집, 일별) · 네이버 검색량(주별, 구간 최대 100) · 전 세계 관심도(Wikipedia 조회수, 일별) · 해외 보도량(GDELT, 일별)
// 색은 글자색 한 가지(값의 크기), 레드는 「급증」 표시에만 (20 문서 원칙)
import { useEffect, useMemo, useState } from 'react'
import { fetchTrends } from './api.js'

const W = 240
const H = 64
const PAD = { t: 6, r: 6, b: 4, l: 2 }

const fmtDay = (t, monthly) => {
  const [y, m, d] = t.split('-')
  return monthly ? `${y.slice(2)}년 ${Number(m)}월` : `${Number(m)}월 ${Number(d)}일`
}
const fmtAt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const fmtNum = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}천` : String(Math.round(v * 10) / 10))

function Spark({ title, unit, series, note, source, asOf, monthly = false }) {
  const [hover, setHover] = useState(null)
  const pts = useMemo(() => {
    if (!series?.length) return []
    const max = Math.max(...series.map((p) => p.v), 1)
    const step = series.length > 1 ? (W - PAD.l - PAD.r) / (series.length - 1) : 0
    return series.map((p, i) => ({ ...p, x: PAD.l + i * step, y: PAD.t + (H - PAD.t - PAD.b) * (1 - p.v / max) }))
  }, [series])

  const last = pts.at(-1)
  const shown = hover ?? last
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const area = pts.length ? `${line}L${last.x.toFixed(1)},${H - PAD.b}L${pts[0].x.toFixed(1)},${H - PAD.b}Z` : ''

  function onMove(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p
    setHover(best)
  }

  return (
    <figure className="trend-spark">
      <figcaption>
        <span className="trend-spark-title">{title}</span>
        {shown && (
          <span className="trend-spark-value">
            <b>{fmtNum(shown.v)}</b>
            {unit} <span className="trend-spark-date">{fmtDay(shown.t, monthly)}</span>
          </span>
        )}
      </figcaption>
      {pts.length > 1 ? (
        <div className="trend-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: ${fmtDay(pts[0].t, monthly)}부터 ${fmtDay(last.t, monthly)}까지, 최근 ${fmtNum(last.v)}${unit}, 최대 ${fmtNum(Math.max(...pts.map((p) => p.v)))}${unit}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <path d={area} className="trend-area" />
          <path d={line} className="trend-line" vectorEffect="non-scaling-stroke" />
          {hover && <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={H - PAD.b} className="trend-cross" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* 점은 그래프가 늘어나도 동그랗게: SVG 밖에 겹쳐 그림 */}
        <span className="trend-dot" style={{ left: `${(shown.x / W) * 100}%`, top: `${(shown.y / H) * 100}%` }} aria-hidden="true" />
        </div>
      ) : (
        <p className="trend-empty">{note ?? '아직 데이터가 없어요.'}</p>
      )}
      {source && <span className="trend-source">{source}</span>}
      {/* 언제 받은 값인지. 새로 받기에 실패해 지난 값을 보여 주는 중이면 따로 표시 (11/07) */}
      {asOf?.at && pts.length > 1 && (
        <span className={asOf.stale ? 'trend-asof stale' : 'trend-asof'} title={asOf.error ? `새로 받기 실패: ${asOf.error}` : undefined}>
          {asOf.stale ? '지난 값 · ' : ''}
          {fmtAt(asOf.at)} {asOf.label ?? '받음'}
        </span>
      )}
    </figure>
  )
}

const NAVER_NOTE = {
  not_enabled: '관리자가 네이버 API HUB 앱에서 「검색어 트렌드」를 켜면 보여요.',
  no_key: '네이버 API 키가 없어요.',
  error: '네이버 검색량을 받지 못했어요.',
}

// 오늘 기사 수는 하루가 끝나기 전이라 줄어 보이므로 그래프에서 뺀다
const today = new Date().toLocaleDateString('sv-SE')

const PATENT_NOTE = {
  no_key: '관리자가 Google Cloud 키(gcp-key.json)를 넣으면 보여요.',
  loading: '특허 집계 중이에요 (한 달에 한 번, 1~2분).',
  error: '특허 집계를 받지 못했어요.',
}

function TrendCard({ item, naverStatus, naverAt, naverStale, naverError, patentStatus, patentAt, patentStale }) {
  const s = item.newsSurge
  return (
    <article className="trend-card">
      <header>
        <h3>{item.keyword}</h3>
        {s && (
          <p>
            최근 7일 기사 <b>{s.week}건</b>
            {s.enough ? ` · 그 전 3주 평균 ${s.before}건` : ''}
            {s.surge && <span className="trend-surge">급증</span>}
            {!s.enough && <span className="trend-wait">급증 판단은 2주치가 더 쌓이면</span>}
          </p>
        )}
      </header>
      <div className="trend-grid">
        <Spark title="뉴스 기사량" unit="건" series={item.news.filter((p) => p.t < today)} source="테크브리프 수집 · 오늘은 빼고" />
        <Spark title="네이버 검색량" unit="" series={item.naver} note={NAVER_NOTE[naverStatus]} source="네이버 데이터랩 · 최대 100 기준" asOf={{ at: naverAt, stale: naverStale, error: naverError }} />
        <Spark
          title="전 세계 관심도"
          unit="회"
          series={item.wiki?.series}
          note={item.wiki ? `받지 못했어요${item.wiki.error ? ` (${item.wiki.error})` : ''}` : '영문 문서가 정해지지 않은 키워드예요.'}
          source={item.wiki ? `Wikipedia 「${item.wiki.article}」 조회수` : null}
          asOf={item.wiki}
        />
        {/* GDELT: 이 서버 IP가 막혀 30분마다 다시 시도. 24시간 동안 한 번도 못 받으면 서버가 retired로 보내 칸을 뺀다 */}
        {!item.gdelt?.retired && (
          <Spark
            title="해외 보도량"
            unit="건"
            series={item.gdelt?.series}
            note={item.gdelt ? `GDELT 요청 제한에 걸렸어요. 30분마다 다시 시도해요${item.gdelt.retryAt ? ` (마지막 시도 ${fmtAt(item.gdelt.retryAt)})` : ''}.` : '영문 검색어가 정해지지 않은 키워드예요.'}
            source={item.gdelt ? `GDELT 「${item.gdelt.term}」` : null}
            asOf={item.gdelt}
          />
        )}
        <Spark
          title="특허 공개 건수"
          monthly
          unit="건"
          series={item.patents}
          note={item.patents === null && patentStatus === 'ok' ? '특허 검색어가 정해지지 않은 키워드예요.' : PATENT_NOTE[patentStatus] ?? '아직 데이터가 없어요.'}
          source="Google Patents · 월별, 영문 제목 · 최근 달은 덜 잡힘"
          asOf={{ at: patentAt, label: '집계 (30일마다)', stale: patentStale }}
        />
      </div>
    </article>
  )
}

function KeywordTrends() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)

  // 서버가 지난 값을 먼저 주고 뒤에서 새로 받는 중이면(refreshing) 20초마다 다시 불러 새 값으로 바꾼다 (11/08)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetchTrends()
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [tick])
  useEffect(() => {
    if (!data?.refreshing) return undefined
    const t = setTimeout(() => setTick((n) => n + 1), 20_000)
    return () => clearTimeout(t)
  }, [data])

  return (
    <section className="panel trends" aria-labelledby="trends-title">
      <div className="trends-head">
        <h2 id="trends-title">추적 중인 키워드 추이</h2>
        <span className="trends-meta">
          {data?.updatedAt
            ? `${new Date(data.updatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 값${data.refreshing ? ' · 새 값 받는 중… (받으면 바뀌어요)' : ' · 6시간마다 새로'}`
            : data?.refreshing
              ? '처음 받는 중…'
              : error || '불러오는 중…'}
        </span>
        <button type="button" className="btn-text" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && data && (
        <div className="trend-cards">
          {data.items.length === 0 ? <p className="trend-empty">자동 수집 키워드가 없어요.</p> : data.items.map((item) => <TrendCard key={item.keyword} item={item} naverStatus={data.naverStatus} naverAt={data.naverAt} naverStale={data.naverStale} naverError={data.naverError} patentStatus={data.patentStatus} patentAt={data.patentAt} patentStale={data.patentStale} />)}
        </div>
      )}
    </section>
  )
}

export default KeywordTrends
