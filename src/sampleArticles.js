// 뉴스 검색 API 연결 전까지 쓰는 샘플 기사 (06 와이어프레임 「뉴스 수집」 화면 기준)
// hoursAgo: 지금 기준 몇 시간 전에 발행됐는지, sameIssue: 규칙으로 묶인 같은 이슈 기사 수
export const SAMPLE_ARTICLES = [
  { id: 1, title: '생성형 AI 업무 도구, 기업 도입 사례 늘어', source: '테크데일리', keyword: '생성형 AI', hoursAgo: 1, sameIssue: 2 },
  { id: 2, title: '차세대 메모리 반도체 양산 일정 앞당겨', source: '반도체타임스', keyword: '반도체', hoursAgo: 2, sameIssue: 0 },
  { id: 3, title: '클라우드 서비스 장애 대응 체계 점검 확대', source: 'IT뉴스룸', keyword: '클라우드', hoursAgo: 3, sameIssue: 0 },
  { id: 4, title: '온디바이스 AI 탑재 노트북 라인업 공개', source: '테크데일리', keyword: '생성형 AI', hoursAgo: 4, sameIssue: 3 },
  { id: 5, title: '데이터센터 전력 수요 급증, 대책 논의', source: 'IT뉴스룸', keyword: '클라우드', hoursAgo: 5, sameIssue: 0 },
  { id: 6, title: '파운드리 업계, 첨단 공정 투자 계획 발표', source: '반도체타임스', keyword: '반도체', hoursAgo: 6, sameIssue: 0 },
  { id: 7, title: 'OLED 증착 공정 수율 개선 기술 발표', source: '디스플레이투데이', keyword: 'OLED', hoursAgo: 30, sameIssue: 0 },
  { id: 8, title: '대형 OLED 패널 출하량 전년 대비 증가', source: '디스플레이투데이', keyword: 'OLED', hoursAgo: 52, sameIssue: 2 },
  { id: 9, title: 'AI 반도체 수요 확대로 HBM 공급 경쟁', source: '반도체타임스', keyword: '반도체', hoursAgo: 75, sameIssue: 0 },
  { id: 10, title: '기업용 AI 에이전트 보안 가이드라인 공개', source: 'IT뉴스룸', keyword: '생성형 AI', hoursAgo: 120, sameIssue: 0 },
]

export const DEFAULT_KEYWORDS = ['생성형 AI', '반도체', '클라우드']
