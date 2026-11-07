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
  // 관련도 규칙 예시 (11 문서): 모음 기사 · 주제 밖 제목 속 기술 정보 · 관련 낮음(기본 숨김)
  { id: 11, title: '[데일리픽] 비트코인 반등 공식…데이터센터 투자 外', source: '테크데일리', keyword: 'OLED', hoursAgo: 8, sameIssue: 0, relevance: 'mid', roundup: true, focus: "차량용 '탠덤 OLED' 선점 경쟁 본격화. 두 업체가 발광층을 두 층으로 쌓은 탠덤 OLED를 앞세워 차량용 시장 선점 경쟁에 나섰다." },
  { id: 12, title: '검사장비 업체, 영업익 10배 급증했는데 PER 3배…"저평가"', source: '경제뉴스', keyword: 'OLED', hoursAgo: 10, sameIssue: 0, relevance: 'mid', topicTag: '주식', focus: '프리미엄 OLED 패널 수요 확대가 투자 증가의 배경이다. 8.6세대 OLED 패널 양산 수율이 안정화되면서 설비투자가 늘었다.' },
  { id: 13, title: '가업상속세 개편, 업종 분류가 혁신 막는다', source: '경제뉴스', keyword: 'OLED', hoursAgo: 12, sameIssue: 0, relevance: 'low' },
]

// 고객사(LG디스플레이) 담당자님이 요즘 자주 본다고 한 기술 (14 문서). DB에 키워드가 없을 때 처음 한 번 쓰인다
export const DEFAULT_KEYWORDS = ['마이크로LED', '마이크로 디스플레이', 'OLED']

// AI 요약 연결 전까지 쓰는 샘플 요약 (06 와이어프레임 「뉴스 선별 요약」 화면 기준)
// importance: 'high' | 'normal'
export const SAMPLE_SUMMARIES = {
  1: {
    importance: 'high',
    lines: [
      '기업들이 업무용 생성형 AI 도구를 부서 단위로 도입하는 사례가 늘고 있다.',
      '보안 검토와 사내 데이터 연동이 도입 확산의 주요 과제로 꼽힌다.',
      '업계는 도입 범위가 앞으로 전사 단위로 넓어질 것으로 내다본다.',
    ],
    keywords: ['생성형 AI', '기업 도입', '보안'],
  },
  2: {
    importance: 'high',
    lines: [
      '주요 업체가 차세대 메모리 반도체 양산 시점을 당초 계획보다 앞당겼다.',
      'AI 서버용 고성능 메모리 수요가 일정 조정의 배경으로 꼽힌다.',
      '장비·소재 협력사의 공급 일정도 함께 앞당겨질 전망이다.',
    ],
    keywords: ['메모리', '양산', 'AI 서버'],
  },
  3: {
    importance: 'normal',
    lines: [
      '클라우드 사업자들이 서비스 장애 대응 체계를 점검하는 범위를 넓히고 있다.',
      '복수 지역 백업과 장애 알림 절차가 주요 점검 항목이다.',
      '고객사도 자체 장애 대응 계획을 마련하라는 권고가 나온다.',
    ],
    keywords: ['클라우드', '장애 대응', '백업'],
  },
  4: {
    importance: 'high',
    lines: [
      '인터넷 연결 없이 AI 기능을 쓰는 온디바이스 AI 노트북이 잇따라 공개됐다.',
      '전용 연산 칩을 넣어 배터리 소모와 응답 시간을 줄인 점이 특징이다.',
      '업계는 업무용 노트북 교체 수요로 이어질지 주목하고 있다.',
    ],
    keywords: ['온디바이스 AI', '노트북', 'NPU'],
  },
  5: {
    importance: 'normal',
    lines: [
      'AI 연산 확대로 데이터센터 전력 수요가 빠르게 늘고 있다.',
      '전력망 확충과 냉각 효율 개선이 주요 대책으로 논의된다.',
      '신규 데이터센터 입지 선정에도 전력 확보 여부가 핵심 조건이 됐다.',
    ],
    keywords: ['데이터센터', '전력', '냉각'],
  },
  6: {
    importance: 'normal',
    lines: [
      '파운드리 업체들이 첨단 공정 설비 투자 계획을 발표했다.',
      '고객사 확보 경쟁이 투자 규모를 키우는 요인으로 꼽힌다.',
      '투자 회수 시점은 수요 회복 속도에 달려 있다는 분석이다.',
    ],
    keywords: ['파운드리', '첨단 공정', '설비 투자'],
  },
  7: {
    importance: 'normal',
    lines: [
      'OLED 증착 공정의 수율을 높이는 새 기술이 발표됐다.',
      '불량을 줄여 패널 생산 비용을 낮출 수 있다는 설명이다.',
      '실제 양산 라인 적용 시점은 아직 정해지지 않았다.',
    ],
    keywords: ['OLED', '증착', '수율'],
  },
  8: {
    importance: 'normal',
    lines: [
      '대형 OLED 패널 출하량이 전년보다 늘었다.',
      'TV와 모니터용 프리미엄 제품 수요가 증가를 이끌었다.',
      '가격 경쟁이 심해져 수익성은 따로 살펴봐야 한다는 지적이 있다.',
    ],
    keywords: ['OLED', '출하량', '대형 패널'],
  },
  9: {
    importance: 'high',
    lines: [
      'AI 반도체 수요가 늘면서 HBM 공급을 둘러싼 경쟁이 커지고 있다.',
      '주요 업체들이 생산 능력 확대와 차세대 제품 인증을 서두른다.',
      '공급 부족이 당분간 이어질 것이라는 전망이 나온다.',
    ],
    keywords: ['HBM', 'AI 반도체', '공급 경쟁'],
  },
  10: {
    importance: 'normal',
    lines: [
      '기업용 AI 에이전트를 안전하게 쓰기 위한 보안 가이드라인이 공개됐다.',
      '권한 최소화와 작업 기록 보관이 핵심 권고 사항이다.',
      '도입 전 내부 데이터 접근 범위를 정하라고 안내한다.',
    ],
    keywords: ['AI 에이전트', '보안', '가이드라인'],
  },
}
