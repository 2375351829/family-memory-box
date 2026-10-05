// 辅助-清理-teardown.mjs · E2E 全局清理
// 测试结束后删除本次 E2E 专用的 .tmp-e2e 数据目录（避免临时目录残留）。
// 容器模式（PW_BASE_URL）下服务由外部托管，不做删除。
import fs from 'node:fs';
import path from 'node:path';

export default async function globalTeardown() {
  if (process.env.PW_BASE_URL) return;
  const target = path.resolve('.tmp-e2e');
  for (let i = 0; i < 10; i += 1) {
    try {
      if (!fs.existsSync(target)) return;
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300)); // 句柄未释放，稍后重试
    }
  }
}