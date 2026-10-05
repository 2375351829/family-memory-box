// E2E 用例 1 · 完整流程（桌面 1280×800）：
// 添加家人 → 抽题 → 开始讲述（正文/日期/追问）→ 上传内嵌真图 → 保存 → 回忆录可见故事与照片
// → JSON 导出并断言下载文件名含 family-memory-backup
import { test, expect } from '@playwright/test';
import { jpegBuffer, JPEG_NAME } from './辅助-图片-fixtures.mjs';

// 桌面 project 专属：本文件仅被「桌面-desktop」project 匹配
test.describe('完整流程', () => {
  test('添加家人→抽题→讲故事→上传照片→回忆录→导出备份', async ({ page }) => {
    await page.goto('/');
    // 等待前端拉取 /api/state 完成（首页渲染出导航）
    await expect(page.locator('button[data-nav="members"]')).toBeVisible({ timeout: 15000 });

    // 1) 添加家人
    await page.click('button[data-nav="members"]');
    await expect(page.locator('.view-members-form input.view-members-input').first()).toBeVisible();
    await page.fill('.view-members-form input.view-members-input >> nth=0', '李桂英');
    await page.fill('.view-members-form input.view-members-input >> nth=1', '奶奶');
    await page.click('.view-members-form .btn-primary');
    await expect(page.locator('.toast', { hasText: '已添加家人' })).toBeVisible({ timeout: 10000 });

    // 2) 抽题
    await page.click('button[data-nav="draw"]');
    await expect(page.locator('button.view-draw-action')).toBeVisible();
    await page.click('button.view-draw-action');
    await expect(page.locator('.view-draw-card')).toBeVisible({ timeout: 10000 });
    const topicText = await page.locator('.view-draw-card .topic-card-text').innerText();
    expect(topicText.trim().length).toBeGreaterThan(0);

    // 3) 开始讲
    await page.click('.view-draw-card-actions .btn-primary'); // 「开始讲」
    await expect(page.locator('#view-story textarea.view-story-textarea')).toBeVisible({ timeout: 10000 });

    // 正文 + 日期
    await page.fill('#view-story textarea.view-story-textarea', '那年夏天的故事：麦田里追蜻蜓。');
    await page.fill('#view-story input.view-story-date', '1985');

    // 展开第一条追问并作答
    const fuToggle = page.locator('#view-story .view-story-followup-toggle').first();
    if (await fuToggle.count()) {
      await fuToggle.click();
      await page.locator('#view-story .view-story-followup-input').first().fill('答：当时六岁。');
    }

    // 4) 上传照片（内嵌 base64 真图，标准 JPEG）
    await page.setInputFiles('#view-story input.view-story-file', {
      name: JPEG_NAME,
      mimeType: 'image/jpeg',
      buffer: jpegBuffer(),
    });
    await expect(page.locator('#view-story .view-story-photo-item')).toHaveCount(1, { timeout: 10000 });
    await page.fill('#view-story input.view-story-caption', '麦田里的蜻蜓');

    // 5) 保存 → 自动跳转回忆录
    await page.click('#view-story .view-story-save');
    await expect(page.locator('.toast', { hasText: '已收进回忆录' })).toBeVisible({ timeout: 10000 });

    // 6) 回忆录确认故事与照片出现
    await expect(page.locator('#view-memoir.is-active')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.view-memoir-story', { hasText: '那年夏天的故事' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.view-memoir-story', { hasText: '故事日期：1985' })).toBeVisible();
    await expect(page.locator('.view-memoir-story .view-memoir-thumb').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.view-memoir-story .view-memoir-story-followup', { hasText: '答：当时六岁。' })).toBeVisible();

    // 7) 触发 JSON 导出并断言下载文件名
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('.view-memoir-tool-json'), // 「导出备份」→ window.location = /api/export/json?with_photos=1
    ]);
    expect(download.suggestedFilename()).toContain('family-memory-backup');
    expect(download.suggestedFilename()).toMatch(/^family-memory-backup-\d{8}\.json$/);
  });
});