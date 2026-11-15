// 대시보드 첫 화면 아래 두 칸 (11/15 시안 A): 최근 중요 기사 · 최근 내 보고서
// - 화면 높이를 채우고, 넘치는 기사 · 보고서는 늘 칸 안에서 스크롤 (11/15 조장: 「펼쳐 보기」 없이)
// - 보고서를 누르면 내 보고서에서 그 보고서를 연다
// - 칸에 기사가 몇 줄 들어가는지는 대시보드가 재서 「분석하면 이렇게 보여요 · 예시」를 펼칠지 정한다 (Dashboard.jsx)

const ARTICLE_MAX = 30

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function HomeBox({ title, sub, action, children, className = '' }) {
  return (
    <section className="panel dash-home-box">
      <div className="dash-home-head">
        <h2 className="dash-title">{title}</h2>
        {sub && <span className="dash-home-sub">{sub}</span>}
        {action}
      </div>
      <div className={`dash-home-body ${className}`}>
        {children}
      </div>
    </section>
  )
}

function DashHome({ issues, reports, onOpenReport, onGoReports, onGoCollect }) {
  const list = issues.slice(0, ARTICLE_MAX)
  const recent = [...reports].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12)

  return (
    <div className="dash-home">
      <HomeBox
        title="최근 중요 기사"
        sub={list.length > 0 ? `최근 48시간 · 중요도 순 ${list.length}건` : '최근 48시간 · 중요도 순'}
        className="is-articles"
        action={
          <span className="dash-home-actions">
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
            {list.map((a) => (
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
            {recent.map((r) => (
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
