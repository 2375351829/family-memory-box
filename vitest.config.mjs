// vitest.config.mjs · 单元测试 + 集成测试共用配置（Vitest 4.x）
// 通过 test.projects 把「单元-unit」与「集成-integration」拆成两个独立项目：
//   npm run test:unit        → vitest run --project unit        （只跑单元目录）
//   npm run test:integration → vitest run --project integration （只跑集成目录）
// 报告文件（vitest-unit.json / vitest-integration.json）由各自 npm 脚本用
// --reporter=json --outputFile.json=<路径> 指定（reporters/outputFile 属 Vitest 的
// NonProjectOptions，不能在 project 内声明，故放在 CLI 层）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['测试-tests/单元-unit/**/*.test.mjs'],
          environment: 'node',
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['测试-tests/集成-integration/**/*.test.mjs'],
          environment: 'node',
          testTimeout: 40000,
          hookTimeout: 40000,
        },
      },
    ],
  },
});