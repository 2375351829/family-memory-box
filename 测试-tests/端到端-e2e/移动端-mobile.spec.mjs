// E2E 用例 2 · 390px 移动端：无横向滚动、主导航可用、抽题可用
import { test, expect } from '@playwright/test';

// 移动 project 专属：本文件仅被「移动-mobile」project 匹配（viewport 390×844）
test.describe('移动端 390px', () => {
  test('无横向滚动 + 导航可用 + 抽题可用', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[data-nav="home"]')).toBeVisible({ timeout: 15000 });

    const assertNoHorizontalScroll = async (label) => {
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `${label} 出现横向滚动（scrollWidth=${sw}）`).toBeLessThanOrEqual(390);
    };

    // 首页：应存在双节氛围挂载点
    await assertNoHorizontalScroll('首页');

    // 导航可用：逐个切换并校验激活态
    for (const view of ['members', 'draw', 'memoir', 'home']) {
      await page.click(`button[data-nav="${view}"]`);
      await expect(page.locator(`#view-${view}`)).toHaveClass(/is-active/);
      await assertNoHorizontalScroll(`${view} 视图`);
    }

    // 确保至少一位家人（空库时先添加）
    await page.click('button[data-nav="members"]');
    await expect(page.locator('#view-members.is-active')).toBeVisible();
    if ((await page.locator('.view-members-card').count()) === 0) {
      await page.fill('.view-members-form input.view-members-input >> nth=0', '移动端家人');
      await page.fill('.view-members-form input.view-members-input >> nth=1', '妈妈');
      await page.click('.view-members-form .btn-primary');
      await expect(page.locator('.view-members-card')).toHaveCount(1, { timeout: 10000 });
    }
    await assertNoHorizontalScroll('家人视图');

    // 抽题可用
    await page.click('button[data-nav="draw"]');
    await expect(page.locator('#view-draw.is-active')).toBeVisible();
    await page.click('button.view-draw-action');
    await expect(page.locator('.view-draw-card')).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalScroll('抽题后');

    // 抽题视图在 390px 下内容不溢出
    const drawOverflow = await page.evaluate(() => {
      const el = document.getElementById('view-draw');
      return el ? Math.ceil(el.getBoundingClientRect().width) : 0;
    });
    expect(drawOverflow).toBeLessThanOrEqual(390);
  });
});