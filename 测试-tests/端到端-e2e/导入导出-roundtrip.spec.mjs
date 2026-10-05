// E2E 用例 3 · 导入导出往返：先导出备份 → 通过前端导入入口（含二次确认）导入同一文件
// → 断言成功提示、数据条数不变
import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test.describe('导入导出往返', () => {
  test('导出→前端导入同一文件→成功且数据条数不变', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[data-nav="memoir"]')).toBeVisible({ timeout: 15000 });

    await page.click('button[data-nav="memoir"]');
    await expect(page.locator('#view-memoir.is-active')).toBeVisible();
    await expect(page.locator('.view-memoir-tool-json')).toBeVisible();

    const readCounts = () =>
      page.evaluate(async () => {
        const r = await fetch('/api/state');
        const j = await r.json();
        const d = j.data;
        return { members: d.members.length, topics: d.topics.length, stories: d.stories.length, photos: d.photos.length, capsules: d.capsules.length };
      });

    const before = await readCounts();

    // 1) 导出备份（下载）
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('.view-memoir-tool-json'), // 导出备份（含照片）
    ]);
    expect(download.suggestedFilename()).toContain('family-memory-backup');

    const savePath = path.join(os.tmpdir(), `fmb-e2e-backup-${Date.now()}.json`);
    await download.saveAs(savePath);
    expect(fs.statSync(savePath).size).toBeGreaterThan(0);

    // 2) 通过前端导入入口导入同一文件（隐藏 file input 触发 change → importJson 二次确认）
    await page.setInputFiles('.view-memoir-file', savePath);
    const confirmBtn = page.locator('.dialog-overlay .dialog-actions .btn-danger');
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });
    await confirmBtn.click(); // 「覆盖导入」

    // 3) 成功提示
    await expect(page.locator('.toast', { hasText: '备份导入完成' })).toBeVisible({ timeout: 20000 });

    // 4) 数据条数不变
    const after = await readCounts();
    expect(after).toEqual(before);

    fs.rmSync(savePath, { force: true });
  });
});