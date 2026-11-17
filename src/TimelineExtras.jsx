// 키워드 분석 「기술 시계열」 칸: 화면이 크면 「크게 보기」의 내용을 칸에 더 보여 준다 (11/18 조장)
// - 「크게 보기」와 같은 내용을 같은 순서로: 관심도 그래프(네이버 월별, 화면 표시만 — AI에 안 넣음) → AI 흐름 정리 성장 · 적용 · 배경 → 최근 소식 3건
// - 남는 자리 = 옆 칸(맵)의 내용이 끝나는 높이까지. 옆 칸이 접혀 있으면 화면 아래까지
//   (칸 상자 높이가 아니라 내용 높이로 재야 이 칸이 늘어나 옆 칸이 따라 늘어나는 일이 없다)
// - 조금이라도 잘리는 블록은 넣지 않는다 (요즘 뜨는 기술 막대와 같은 규칙). 작은 화면은 그대로
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchTimelineNews } from './api.js'
import { Spark } from './KeywordTrends.jsx'

const GAP = 12
const MIN_ROOM = 80
const SECTIONS = [
  ['growth', '성장 · 어떻게 커졌나'],
  ['application', '적용 · 어디에 쓰이나'],
  ['background', '배경 · 왜 나왔나'],
]

function Bullets({ label, list }) {
  return (
    <div className="ka-glance tlx-sec">
      <div>
        <h4>{label}</h4>
        <ul>
          {list.slice(0, 2).map((b, i) => (
            <li key={i}>
              <span className={b.kind === 'fact' ? 'tl-kind fact' : 'tl-kind ai'}>{b.kind === 'fact' ? '사실' : b.unverified ? 'AI 해설 · 확인 필요' : 'AI 해설'}</span> {b.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// 남는 높이 (CSS px). 옆 칸 내용의 아래 끝 - 이 칸 추가 자리의 위 끝
function roomFor(wrap) {
  const rect = wrap.getBoundingClientRect()
  const scale = rect.width ? wrap.offsetWidth / rect.width : 1 // 화면 배율(zoom)이 걸려 있어도 CSS px로
  const split = wrap.closest('.split')
  const other = split ? [...split.children].find((el) => el.classList.contains('split-pane') && !el.contains(wrap)) : null
  let bottom
  if (other) {
    const kids = [...(other.querySelector('.ka-pane') ?? other).children]
    bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))
  } else {
    bottom = window.innerHeight - 16
  }
  return Math.max(0, (bottom - rect.top) * scale)
}

export default function TimelineExtras({ keyword, data, job }) {
  const [news, setNews] = useState(null)
  useEffect(() => {
    let alive = true
    fetchTimelineNews(keyword)
      .then((d) => alive && setNews(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [keyword])

  const story = job?.status === 'done' && !job.story?.thin ? job.story.story : null
  const surge = data?.naver?.surge?.status === 'ok' ? data.naver.surge : null
  const blocks = []
  if (data?.naver?.status === 'ok' && data.naver.months?.length)
    blocks.push({
      key: 'naver',
      el: (
        <div className="tlx-chart">
          <Spark
            title="관심도 (네이버 검색)"
            unit=""
            monthly
            series={data.naver.months.map((m) => ({ t: `${m.t}-01`, v: m.v }))}
            band={surge?.range?.map((r) => ({ ...r, t: `${r.t}-01` }))}
            marks={surge?.surges?.map((m) => ({ ...m, t: `${m.t}-01` }))}
            source="네이버 데이터랩 · 월별 · 기간 최대 100 · 단계 판정에는 안 씀"
            note="검색량이 적어요."
          />
        </div>
      ),
    })
  for (const [k, label] of SECTIONS) if (story?.[k]?.length) blocks.push({ key: k, el: <Bullets label={label} list={story[k]} /> })
  if (news?.items?.length)
    blocks.push({
      key: 'news',
      el: (
        <div className="tlx-news">
          <h4>
            최근 소식 <span className="muted">· 모은 자료 {news.days}일 · 중요도순</span>
          </h4>
          <ul>
            {news.items.slice(0, 3).map((n) => (
              <li key={n.id}>
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
                <span className="muted">
                  {' '}
                  · {n.source}
                  {n.score != null ? ` · ${n.score}점` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ),
    })

  const wrapRef = useRef(null)
  const [fit, setFit] = useState({ height: 0, n: 0 })
  const key = blocks.map((b) => b.key).join(',')
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return undefined
    const decide = () => {
      const room = roomFor(wrap)
      if (room < MIN_ROOM) return setFit((f) => (f.n === 0 && f.height === 0 ? f : { height: 0, n: 0 }))
      let used = 0
      let n = 0
      for (const el of wrap.children) {
        const h = el.offsetHeight + (n ? GAP : 0)
        if (used + h > room) break
        used += h
        n += 1
      }
      setFit((f) => (f.n === n && Math.abs(f.height - used) < 1 ? f : { height: used, n }))
    }
    decide()
    const ro = new ResizeObserver(decide)
    const split = wrap.closest('.split')
    if (split) for (const pane of split.querySelectorAll('.ka-pane')) ro.observe(pane)
    for (const el of wrap.children) ro.observe(el)
    window.addEventListener('resize', decide)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', decide)
    }
  }, [key])

  if (!blocks.length) return null
  return (
    <div ref={wrapRef} className="tlx" style={{ height: fit.height, marginTop: fit.n ? undefined : 0 }} aria-label="화면이 넓어 더 보여 주는 내용 (크게 보기와 같음)">
      {blocks.map((b, i) => (
        <div key={b.key} className={i < fit.n ? 'tlx-block' : 'tlx-block is-out'} aria-hidden={i < fit.n ? undefined : true}>
          {b.el}
        </div>
      ))}
    </div>
  )
}
