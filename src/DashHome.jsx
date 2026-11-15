// 대시보드 첫 화면 아래 두 칸 (11/15 시안 A): 최근 중요 기사 · 최근 내 보고서
// - 화면 높이를 채우고, 기사 수는 칸 높이에 들어가는 만큼만 보여 준다 (FHD · QHD · 절반 화면마다 다름)
// - 「펼쳐 보기」를 누르면 나머지도 칸 안에서 스크롤해 본다
// - 보고서를 누르면 내 보고서에서 그 보고서를 연다
import { useLayoutEffect, useRef, useState } from 'react'

const ROW_FALLBACK = 52 // 줄 높이를 아직 못 쟀을 때
const ARTICLE_MAX = 30

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

// 칸 높이에 몇 줄 들어가는지 잰다 (창 크기를 바꾸면 다시)
function useFitCount(total) {
  const bodyRef = useRef(null)
  const [fit, setFit] = useState(total)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return undefined
    const measure = () => {
      const row = el.querySelector('li')?.getBoundingClientRect().height || ROW_FALLBACK
      // 화면 틀 안에서는 칸 높이, 밖(휴대폰 등)에서는 CSS의 최대 높이로 센다 (지금 그린 줄 수에 끌려가지 않게)
      const maxH = parseFloat(getComputedStyle(el).maxHeight)
      const avail = Number.isFinite(maxH) ? maxH : el.clientHeight
      setFit(Math.max(1, Math.floor(avail / row)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [total])
  return [bodyRef, fit]
}

function HomeBox({ title, sub, action, children, bodyRef, scroll }) {
  return (
    <section className="panel dash-home-box">
      <div className="dash-home-head">
        <h2 className="dash-title">{title}</h2>
        {sub && <span className="dash-home-sub">{sub}</span>}
        {action}
      </div>
      <div ref={bodyRef} className={scroll ? 'dash-home-body is-scroll' : 'dash-home-body'}>
        {children}
      </div>
    </section>
  )
}

function DashHome({ issues, reports, onOpenReport, onGoReports, onGoCollect }) {
  const [open, setOpen] = useState(false)
  const list = issues.slice(0, ARTICLE_MAX)
  const [bodyRef, fit] = useFitCount(list.length)
  const shown = open ? list : list.slice(0, fit)
  const more = list.length - shown.length
  const recent = [...reports].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12)
  const [repRef, repFit] = useFitCount(recent.length)

  return (
    <div className="dash-home">
      <HomeBox
        title="최근 중요 기사"
        sub="최근 48시간 · 중요도 순"
        bodyRef={bodyRef}
        scroll={open}
        action={
          <span className="dash-home-actions">
            {(more > 0 || open) && (
              <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
                {open ? '접기' : `펼쳐 보기 +${more}`}
              </button>
            )}
            <button type="button" className="link-btn" onClick={onGoCollect}>
              자료 현황 →
            </button>
          </span>
        }
      >
        {list.length === 0 ? (
          <p className="dash-home-empty">최근 48시간에 모은 기사가 없어요. 자동 최신화가 켜져 있는지 확인해 주세요.</p>
        ) : (
          <ul className="dash-home-list">
            {shown.map((a) => (
              <li key={a.id}>
                {a.importanceLevel === 'high' && <span className="dash-home-hi">중요</span>}
                <a className="dash-home-t" href={a.url} target="_blank" rel="noreferrer" title={a.title}>
                  {a.title}
                </a>
                <span className="dash-home-m">
                  {a.source} · {when(a.publishedAt)}
                  {a.sameIssue > 0 && ` · 같은 이슈 ${a.sameIssue + 1}건`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HomeBox>

      <HomeBox
        title="최근 내 보고서"
        sub={`전체 ${reports.length}건`}
        bodyRef={repRef}
        action={
          <span className="dash-home-actions">
            <button type="button" className="link-btn" onClick={onGoReports}>
              내 보고서 →
            </button>
          </span>
        }
      >
        {recent.length === 0 ? (
          <p className="dash-home-empty">아직 만든 보고서가 없어요. 선별·요약에서 보고서를 만들면 여기에 보여요.</p>
        ) : (
          <ul className="dash-home-list">
            {recent.slice(0, repFit).map((r) => (
              <li key={r.id}>
                <button type="button" className="dash-home-t dash-home-open" onClick={() => onOpenReport(r.id)} title={`「${r.report?.title ?? '보고서'}」 내 보고서에서 열기`}>
                  {r.report?.title ?? '보고서'}
                </button>
                <span className="dash-home-m">
                  {when(r.createdAt)}
                  {r.report?.headline?.text && ` · ${r.report.headline.text}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HomeBox>
    </div>
  )
}

export default DashHome
