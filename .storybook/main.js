// Storybook 설정: 화면 부품과 디자인 토큰 카탈로그 (npm run storybook)
/** @type { import('@storybook/react-vite').StorybookConfig } */
const config = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx)'],
  addons: ['@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  // vite.config.js의 요약 API 플러그인은 서버를 켜고 자동 최신화 예약까지 시작한다 → Storybook에서는 뺀다
  viteFinal(config) {
    config.plugins = (config.plugins ?? []).flat().filter((p) => p?.name !== 'summary-api')
    return config
  },
}
export default config
