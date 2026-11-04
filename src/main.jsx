import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AdminApp from './AdminApp.jsx'
import App from './App.jsx'
import TestPage from './TestPage.jsx'

// 페이지 3개 (라우터 없이 주소만 본다)
// /            일반 접속: 뉴스 수집·선별·보고서
// /admin       관리 페이지: 설정·상태·실험 기능·변경 기록
// /admin/test  관리자 테스트 페이지: 실험 기능을 켠 뉴스 화면 + 시험 도구
const path = window.location.pathname.replace(/\/+$/, '') || '/'
const Page = path === '/admin/test' ? TestPage : path === '/admin' ? AdminApp : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
