import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 글꼴: Pretendard를 서버에서 직접 제공 (컴퓨터에 설치돼 있지 않아도, 외부 글꼴 서버가 막혀도 보이게)
// 화면에 쓰인 글자 묶음만 그때그때 받는다 (dynamic subset). SIL OFL 1.1
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import './tokens.css' // LG UI Kit 기반 디자인 토큰 (Storybook 「Foundations」)
import AdminApp from './AdminApp.jsx'
import OpsGate from './OpsGate.jsx'
import TestPage from './TestPage.jsx'
import { clientId } from './usage.js'

clientId() // 브라우저 번호를 쿠키로 맞춰 둔다 (AI 대기열 「내 작업」)

// 페이지 3개 (라우터 없이 주소만 본다)
// /            일반 접속: 뉴스 수집·선별·보고서
// /admin       관리 페이지: 설정·상태·실험 기능·변경 기록
// /admin/test  관리자 테스트 페이지: 실험 기능을 켠 뉴스 화면 + 시험 도구
const path = window.location.pathname.replace(/\/+$/, '') || '/'
// 일반 화면은 운영 상태(점검 중 등)를 먼저 확인한다 (OpsGate)
const Page = path === '/admin/test' ? TestPage : path === '/admin' ? AdminApp : OpsGate

// 화면 오류 막이 (11/17): 예전엔 화면 안에서 오류가 하나만 나도 전체가 하얗게 꺼졌다(브라우저 저장 한도 초과 사례).
// 이제는 무슨 일인지와 「새로고침」 단추를 보여 준다. 오류 내용은 콘솔과 서버 기록(serve.log)에 남는다
class Guard extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error('[화면 오류]', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="crash" role="alert">
        <h1>화면을 그리다 문제가 생겼어요</h1>
        <p>새로고침해 보세요. 계속되면 이 화면을 캡처해 알려 주세요.</p>
        <p className="crash-detail">{String(this.state.error?.message ?? this.state.error).slice(0, 200)}</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </main>
    )
  }
}

// 보고서 양식(글꼴 · 글자 크기 · 여백 …, 관리 페이지에서 정함)을 먼저 받아 두고 그린다 (11/20). 1.5초 넘게 걸리거나 실패하면 처음 값으로
const styleReady = Promise.race([
  Promise.all([import('./api.js'), import('./reportSlides.js')]).then(([api, slides]) => api.fetchReportStyle().then(slides.applyReportStyle)),
  new Promise((ok) => setTimeout(ok, 1500)),
]).catch(() => {})

styleReady.then(() =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Guard>
        <Page />
      </Guard>
    </StrictMode>,
  ),
)
