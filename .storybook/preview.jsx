// 모든 스토리에 앱과 같은 글꼴·토큰·스타일을 입힌다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '../src/index.css'
import '../src/tokens.css'
import '../src/App.css'
import '../src/Admin.css'

/** @type { import('@storybook/react-vite').Preview } */
const preview = {
  // 위 도구막대에서 기본 버튼 색 두 안을 바꿔 볼 수 있다
  globalTypes: {
    primary: {
      description: '기본 버튼 색',
      toolbar: {
        title: '기본 버튼',
        icon: 'paintbrush',
        items: [
          { value: 'black', title: '검정 안 (결정)' },
          { value: 'red', title: '레드 안 (비교용)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { primary: 'black' },
  decorators: [
    (Story, ctx) => (
      <div data-primary={ctx.globals.primary} style={{ fontFamily: 'var(--font-sans)', color: 'var(--tb-color-text)' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    backgrounds: {
      options: {
        page: { name: '페이지 바탕', value: '#faf9f5' },
        white: { name: '흰색', value: '#ffffff' },
      },
    },
    controls: { matchers: { color: /(background|color)$/i } },
  },
}
export default preview
