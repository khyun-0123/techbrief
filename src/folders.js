// 선별 폴더 상수 (FolderBar · App · SelectSummary가 같이 쓴다)
export const INBOX = 'inbox'
export const INBOX_FOLDER = { id: INBOX, name: '미분류' }
export const DRAG_TYPE = 'application/x-techbrief-article'

// 기사 줄을 끌기 시작할 때
export function dragArticle(e, id) {
  e.dataTransfer.setData(DRAG_TYPE, id)
  e.dataTransfer.effectAllowed = 'move'
}
