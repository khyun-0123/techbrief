// 관리 페이지 「사용 현황」 (17 문서 4장): 누가 얼마나 쓰나 · 무엇을 찾나 · 보고서까지 가나 · 시스템이 잘 도나
// 기록은 일반 화면(/)에서만 모은다 (src/usage.js). 개인 정보 없음
import { useEffect, useState } from 'react'
import { fetchUsage } from './api.js'

const PERIODS = [
  [1, '오늘'],
  [7, '7일'],
  [30, '30일'],
]
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // 업무 기준으로 월요일부터

const n = (v) => (v ?? 0).toLocaleString()

function seconds(ms) {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}초`
}

function percent(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}

function Tile({ label, value, sub }) {
  return (
    <div className="adm-tile">
      <span className="adm-tile-label">{label}</span>
      <span className="adm-tile-value">{value}</span>
      {sub && <span className="adm-tile-sub">{sub}</span>}
    </div>
  )
}

// 막대 하나짜리(한 계열) 세로 막대. 마우스를 올리면 값, 화면 읽기 프로그램에는 표로 읽힌다
// every: 아래 이름표를 몇 칸마다 보일지 (칸이 많으면 겹치지 않게)
function Bars({ title, unit, data, every = 1 }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <figure className="adm-bars">
      <figcaption>
        <span>{title}</span>
        <span className="adm-bars-max">
          최대 {n(Math.max(0, ...data.map((d) => d.value)))}
          {unit}
        </span>
      </figcaption>
      <div className="adm-bars-plot" aria-hidden="true" style={{ '--cols': data.length }}>
        {data.map((d) => (
          <div key={d.label} className="adm-bar" data-tip={`${d.tip ?? d.label} · ${n(d.value)}${unit}`}>
            <span className="adm-bar-fill" style={{ height: d.value ? `${Math.max(3, (d.value / max) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="adm-bars-axis" aria-hidden="true" style={{ '--cols': data.length }}>
        {data.map((d, i) => (
          <span key={d.label}>{i % every === 0 ? d.label : ''}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>
          {title} (합계 {n(total)}
          {unit})
        </caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.tip ?? d.label}</th>
              <td>
                {n(d.value)}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// 순위 목록: 이름 · 가로 막대 · 횟수
function RankList({ items, empty, action }) {
  if (!items.length) return <p className="adm-note">{empty}</p>
  const max = items[0].count
  return (
    <ol className="adm-rank">
      {items.map((it, i) => (
        <li key={it.label}>
          <span className="adm-rank-no">{i + 1}</span>
          <span className="adm-rank-label" title={it.label}>
            {it.label}
          </span>
          <span className="adm-rank-meter" aria-hidden="true">
            <span style={{ width: `${(it.count / max) * 100}%` }} />
          </span>
          <span className="adm-rank-count">{n(it.count)}번</span>
          {action?.(it)}
        </li>
      ))}
    </ol>
  )
}

// keywords: 지금 화면의 자동 수집 키워드(저장 전 변경 포함), onAddKeyword: 없으면 추가 버튼을 숨김
function AdminUsage({ keywords, onAddKeyword, refresh }) {
  const [days, setDays] = useState(7)
  const [result, setResult] = useState(null) // { days, data } 또는 { days, error }

  useEffect(() => {
    let alive = true
    const load = () =>
      fetchUsage(days)
        .then((data) => alive && setResult({ days, data }))
        .catch((err) => alive && setResult({ days, error: err.message }))
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [days])

  const loading = result?.days !== days
  const data = result?.data
  const has = new Set(keywords.map((k) => k.toLowerCase()))

  const periodSwitch = (
    <div className="adm-segment" role="radiogroup" aria-label="기간">
      {PERIODS.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={days === value} onClick={() => setDays(value)}>
          {label}
        </button>
      ))}
    </div>
  )

  if (!data) {
    return (
      <>
        <div className="adm-usage-bar">{periodSwitch}</div>
        <p className="adm-note">{result?.error ?? '불러오는 중…'}</p>
      </>
    )
  }

  const { usage, interests, outcomes, system } = data
  const empty = usage.visits + usage.actions === 0
  const dayLabel = (day) => {
    const [, m, d] = day.split('-')
    return `${Number(m)}/${Number(d)}`
  }
  const lastResult = refresh?.lastResult

  return (
    <div className={loading ? 'adm-usage is-loading' : 'adm-usage'}>
      <div className="adm-usage-bar">
        {periodSwitch}
        <span className="adm-note">{data.stored ? `기록은 ${data.keepDays}일 보관` : 'DB가 없어 서버를 다시 켜면 기록이 비워져요'}</span>
      </div>
      {result.error && <p className="adm-toast error">{result.error}</p>}

      <div className="adm-tiles">
        <Tile label="사용자 (브라우저 수)" value={n(usage.clients)} sub={`방문 ${n(usage.visits)}번 · 하루 한 번씩 셈`} />
        <Tile label="찾기 · 선별" value={`${n(outcomes.searches)} · ${n(outcomes.selects)}`} sub="「논문 · 뉴스에서 찾기」 · 「선별 추가」" />
        <Tile label="요약 요청" value={n(outcomes.summaries)} sub="사람이 요청한 것만 (자동 요약 제외)" />
        <Tile label="보고서 · 내보내기" value={`${n(outcomes.reports)} · ${n(outcomes.exports.total)}`} sub={`PDF ${outcomes.exports.pdf} · PPT ${outcomes.exports.ppt} · 복사 ${outcomes.exports.copy}`} />
        <Tile
          label="보고서까지 간 비율"
          value={percent(outcomes.reportClients, outcomes.selectClients)}
          sub={outcomes.selectClients ? `선별한 ${outcomes.selectClients}명 중 ${outcomes.reportClients}명` : '선별한 사람이 아직 없어요'}
        />
      </div>

      {empty && (
        <section className="adm-card">
          <p className="adm-note">이 기간에는 아직 기록이 없어요. 일반 화면(/)을 쓰면 쌓여요. 관리·테스트 페이지에서 한 일은 세지 않아요.</p>
        </section>
      )}

      <section className="adm-card">
        <h2>언제 쓰나</h2>
        <p className="adm-desc">방문은 브라우저마다 하루 한 번, 활동은 찾기 · 선별 · 요약 · 원문 열기 · 보고서 · 내보내기를 모두 센 것이에요.</p>
        <div className="adm-bars-grid">
          {data.days > 1 ? (
            <Bars
              title="날짜별 방문"
              unit="번"
              data={usage.byDay.map((d) => ({ label: dayLabel(d.day), value: d.visits }))}
              every={data.days > 10 ? 5 : 1}
            />
          ) : (
            <Bars title="오늘 방문" unit="번" data={[{ label: '오늘', value: usage.visits }]} />
          )}
          <Bars
            title="시간대별 활동"
            unit="번"
            data={usage.byHour.map((value, h) => ({ label: String(h), tip: `${h}시`, value }))}
            every={3}
          />
          {data.days > 1 && (
            <Bars
              title="요일별 활동"
              unit="번"
              data={WEEK_ORDER.map((i) => ({ label: WEEKDAYS[i], tip: `${WEEKDAYS[i]}요일`, value: usage.byWeekday[i] }))}
            />
          )}
        </div>
      </section>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>자주 찾는 검색어</h2>
          <p className="adm-desc">「논문 · 뉴스에서 찾기」로 찾은 말 Top 20. 자동 수집에 없는 말은 키워드 후보예요.</p>
          <RankList
            items={interests.searches}
            empty="아직 찾은 말이 없어요."
            action={(it) =>
              has.has(it.label.toLowerCase()) ? (
                <span className="adm-tag adm-tag-muted">수집 중</span>
              ) : onAddKeyword ? (
                <button type="button" className="adm-link-btn" onClick={() => onAddKeyword(it.label)} title="저장해야 반영돼요">
                  키워드로 추가
                </button>
              ) : (
                <span className="adm-tag adm-tag-warn">수집 안 함</span>
              )
            }
          />
        </section>
        <section className="adm-card">
          <h2>많이 선별 · 요약된 키워드</h2>
          <p className="adm-desc">기사가 어떤 키워드로 모였는지 기준이에요.</p>
          <h3 className="adm-sub">선별</h3>
          <RankList items={interests.selectedKeywords} empty="아직 선별한 기사가 없어요." />
          <h3 className="adm-sub">요약 요청</h3>
          <RankList items={interests.summarizedKeywords} empty="아직 요약 요청이 없어요." />
        </section>
      </div>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>많이 열어 본 기사</h2>
          <p className="adm-desc">자료 현황에서 제목을 눌러 원문을 연 횟수예요.</p>
          <RankList items={interests.openedArticles} empty="아직 연 기사가 없어요." />
        </section>
        <section className="adm-card">
          <h2>시스템</h2>
          <p className="adm-desc">AI 호출은 자동 요약 · 보고서 · 시험까지 모두 센 것이에요 (비용 가늠).</p>
          <dl className="adm-usage-dl">
            <dt>AI 호출 (이 기간)</dt>
            <dd>{n(system.aiCalls)}번</dd>
            <dt>오늘 AI 호출</dt>
            <dd>{n(system.aiCallsToday)}번</dd>
            <dt>AI 실패율</dt>
            <dd>
              {percent(system.aiFailed, system.aiCalls)}
              {system.aiFailed > 0 && <span className="adm-tile-sub"> · 실패 {system.aiFailed}번</span>}
            </dd>
            <dt>AI 평균 시간</dt>
            <dd>{seconds(system.aiAvgMs)}</dd>
            <dt>마지막 수집</dt>
            <dd>
              {!lastResult
                ? '—'
                : lastResult.error
                  ? `실패: ${lastResult.error}`
                  : `가져온 기사 ${n(lastResult.fetched)}건 · 새 기사 ${n(lastResult.added)}건${lastResult.failedKeywords?.length ? ` · 실패 키워드 ${lastResult.failedKeywords.join(', ')}` : ''}`}
            </dd>
            <dt>자동 요약 대기</dt>
            <dd>{n(refresh?.backlog?.remaining)}건</dd>
          </dl>
        </section>
      </div>

      <section className="adm-card adm-usage-privacy">
        <h2>무엇을 기록하나</h2>
        <ul>
          <li>일반 화면(/)에서 한 일만: 방문(하루 한 번) · 찾은 말 · 선별·요약한 기사의 키워드 · 연 기사 제목 · 보고서 만들기 · 내보내기 형식</li>
          <li>사람을 알아볼 수 있는 값(이름 · IP · 브라우저 정보)은 저장하지 않아요. 브라우저마다 무작위 번호 하나만 남겨 대략적인 사용자 수를 세요</li>
          <li>원본 기록은 {data.keepDays}일 뒤 지워져요. 관리 · 테스트 페이지에서 한 일은 세지 않아요</li>
        </ul>
      </section>
    </div>
  )
}

export default AdminUsage
