// 화면 표시 설정. 관리자 화면이 생기면 서버 설정으로 옮긴다 (17 문서 3-3)

// 긍정·중립·부정 ○ △ ✕ (13 F5). 담당자님 "크게 도움 안 됨"(14 문서) → 기본 숨김
// 다시 켜려면 .env.local에 VITE_SHOW_SENTIMENT=true
export const SHOW_SENTIMENT = import.meta.env.VITE_SHOW_SENTIMENT === 'true'
