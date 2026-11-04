// 관리자 테스트 페이지 (/admin/test). 관리자로 로그인해야 들어온다
// 일반 화면과 같은 뉴스 화면에 '테스트에서만' 실험 기능을 켜고, 「시험 도구」 탭을 더한다
import { useEffect, useState } from 'react'
import { fetchAdminMe } from './api.js'
import App from './App.jsx'

function TestPage() {
  const [state, setState] = useState('checking') // checking | ok | offline
  useEffect(() => {
    fetchAdminMe()
      .then((me) => {
        if (me.admin) setState('ok')
        else window.location.replace('/admin?next=/admin/test') // 로그인 뒤 다시 여기로
      })
      .catch(() => setState('offline'))
  }, [])
  if (state === 'ok') return <App mode="test" />
  if (state === 'offline') return <p style={{ padding: 24 }}>서버에 연결되지 않아요. npm run dev가 켜져 있는지 확인해 주세요.</p>
  return null
}

export default TestPage
