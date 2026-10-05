// playwright.config.mjs · E2E 配置（Playwright + 系统 Edge，不下载浏览器）
// 两个 project：桌面 1280×800 / 移动 390×844（isMobile + hasTouch）
// webServer 仅在未提供 PW_BASE_URL 时启用（本地自动拉起后端；容器模式复用外部地址）
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.PW_BASE_URL || 'http://127.0.0.1:5099';
const REPORT_DIR = '测试-tests/报告-reports';

export default defineConfig({
  testDir: '测试-tests/端到端-e2e',
  outputDir: '测试-tests/报告-reports/playwright-artifacts',
  fullyParallel: false, // 共用同一后端/数据库，必须串行
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  globalTeardown: './测试-tests/端到端-e2e/辅助-清理-teardown.mjs',
  reporter: [
    ['html', { outputFolder: `${REPORT_DIR}/playwright-html`, open: 'never' }],
    ['json', { outputFile: `${REPORT_DIR}/playwright-result.json` }],
  ],
  use: {
    baseURL: BASE_URL,
    channel: 'msedge', // 复用系统 Edge，不执行 npx playwright install
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    {
      name: '桌面-desktop',
      testMatch: /.*(完整流程-flow|导入导出-roundtrip|轮流抽题-turn)\.spec\.mjs$/,
      use: {
        channel: 'msedge',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: '移动-mobile',
      testMatch: /.*移动端-mobile\.spec\.mjs$/,
      use: {
        channel: 'msedge',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  // 未显式提供外部地址时，本地拉起后端（数据目录取自 .env.e2e 的 .tmp-e2e，不污染 data/）
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'node --env-file-if-exists=.env.e2e 后端服务-node.mjs',
        url: 'http://127.0.0.1:5099/api/health',
        reuseExistingServer: true,
        timeout: 60000,
      },
});