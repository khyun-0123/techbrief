// 자동 최신화 상태를 글로 바꾸는 함수 (일반 화면 RefreshPanel과 관리 페이지 AdminRefresh가 같이 쓴다)

export const MODE_LABEL = { off: '꺼짐', daily: '매일 정해진 시각', interval: '몇 시간마다' }

export function formatTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function resultText(r) {
  if (!r) return ''
  if (r.error) return `실패: ${r.error}`
  const parts = [`새 기사 ${r.added}건`]
  if (r.queued != null) parts.push(`자동 요약 대기 ${r.queued}건`)
  else if (r.summarized != null) parts.push(`미리 요약 ${r.summarized}건`) // 예전 결과
  if (r.failedKeywords?.length) parts.push(`수집 실패 키워드: ${r.failedKeywords.join(', ')}`)
  if (r.note) parts.push(r.note)
  return parts.join(' · ')
}

export function progressText(running) {
  if (running.phase === 'collect') return '기사 모으는 중…'
  return '정리 중…'
}

// 자동 요약 대기열: 최신화와 따로 뒤에서 돈다
// 완료·실패·양보(사람 요청에 자리를 내주고 다시 넣은 것, 저장 안 됨)는 서버를 켠 뒤 누적
export function backlogText(b) {
  const base = b.current ? `자동 요약 중 · 남은 ${b.remaining + 1}건 (중요 ${b.important}건)` : b.remaining > 0 ? `자동 요약 대기 ${b.remaining}건` : '자동 요약 대기 없음'
  const counts = [b.done ? `완료 ${b.done}` : null, b.failed ? `실패 ${b.failed}` : null, b.preempted ? `사람 요청에 양보 ${b.preempted}(다시 넣음)` : null].filter(Boolean)
  return counts.length ? `${base} · ${counts.join(' · ')}` : base
}

// 어느 앱 · 어느 코드가 돌렸는지 (관리 페이지, 11/15). runner가 없으면 이 기록을 남기기 전 코드(예전 앱)가 돌린 것
export function runnerText(r) {
  if (!r?.runner) return '기록 없음 (예전 코드로 켠 앱이 돌렸을 수 있음)'
  const { host, port, branch, commit } = r.runner
  return [`${host ?? '?'}:${port ?? '?'}`, branch && commit ? `${branch} @ ${commit}` : null].filter(Boolean).join(' · ')
}

// 지금 이 앱(응답한 앱)이 수집 담당인지
export function schedulerText(s) {
  if (!s) return '-'
  if (s.mode === 'off') return '이 앱은 수집 안 함 (REFRESH_SCHEDULER=off)'
  if (s.mode === 'on') return '잠금을 먼저 잡은 앱이 수집 (담당 고정 안 함)'
  return s.leader ? `이 앱이 수집 담당 · 잠금 쥠 (${formatTime(s.since)}부터)` : `담당 대기 · ${s.error ?? '잠금을 잡는 중'}`
}
