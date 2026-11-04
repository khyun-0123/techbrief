import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AdminApp from './AdminApp.jsx'
import App from './App.jsx'

// /admin 주소면 관리자 화면 (17 문서). 라우터 없이 주소만 본다
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin'

createRoot(document.getElementById('root')).render(<StrictMode>{isAdmin ? <AdminApp /> : <App />}</StrictMode>)
