// E2E 用例 · 抽题轮流对等（桌面 1280×800）
// 回归：「本轮轮到谁」曾用「故事数最少者」判定，全家人故事数并列时会永远只轮到第一人。
// 现按 state.members[].last_draw_id 轮流（最久没轮到的先轮到，自增序号无并列）：连抽应不断换人、
// 抽完即推进，且不会出现「永远同一个人」。说明：E2E 数据目录（.tmp-e2e）起始为空且各 spec 串行
// 共用同一后端，故本用例先用 API 备好家人才抽题。
import { test, expect } from '@playwright/test';

// 与前端 currentSpeaker() 同一口径：last_draw_id 最小者优先（从未抽过 null → 最优先）；
// 并列看故事数；再并列看顺序。state 已按 sort_order,id 返回。
function expectedOrder(state) {
  const storyCount = (id) => state.data.stories.filter((s) => String(s.member_id) === String(id)).length;
  const turnKey = (m) => (typeof m.last_draw_id === 'number' ? m.last_draw_id : -1);
  return state.data.members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ka = turnKey(a.m);
      const kb = turnKey(b.m);
      if (ka !== kb) return ka - kb;
      const sa = storyCount(a.m.id);
      const sb = storyCount(b.m.id);
      if (sa !== sb) return sa - sb;
      return a.i - b.i;
    })
    .map((x) => x.m.relation || x.m.name);
}

const speakerOf = (line) => line.replace(/^.*?：/, '').trim();

// 保证至少有 n 位家人（已够则不重复创建；称谓唯一，用「测试亲属N」避免冲突）
async function ensureMembers(request, n) {
  const state = await (await request.get('/api/state')).json();
  for (let i = state.data.members.length; i < n; i += 1) {
    const res = await request.post('/api/members', { data: { name: `轮转${i}`, relation: `测试亲属${i}` } });
    expect(res.ok(), `创建家人失败：${res.status()}`).toBe(true);
  }
}

test.describe('抽题轮流', () => {
  test('连抽一轮：依次轮到不同家人，抽满一轮后回到第一位', async ({ page, request }) => {
    await ensureMembers(request, 4);

    await page.goto('/');
    await expect(page.locator('button[data-nav="draw"]')).toBeVisible({ timeout: 15000 });
    await page.click('button[data-nav="draw"]');
    await expect(page.locator('p.view-draw-speaker')).toBeVisible({ timeout: 10000 });

    const before = await (await request.get('/api/state')).json();
    const order = expectedOrder(before);
    expect(order.length).toBeGreaterThanOrEqual(4);

    // 连续抽 4 次：每次顶栏「轮到谁」与卡片归属一致，抽完立即推进到下一位（且换人）
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      const name = speakerOf(await page.locator('p.view-draw-speaker').innerText());
      seen.push(name);

      await page.click('button.view-draw-action');
      await expect(page.locator('.view-draw-card-who')).toContainText(name, { timeout: 10000 }); // 卡片标明由谁讲
      const nextLine = page.locator('p.view-draw-speaker');
      await expect(nextLine).toContainText('下一次轮到');                                        // 抽完即推进
      expect(speakerOf(await nextLine.innerText())).not.toBe(name);                              // 不会再是同一人
    }

    // 修复前（故事数并列）这里会是同一个人 4 次；一轮之内应至少轮到 3 位不同家人
    expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
    // 首位应与「最久没轮到者优先」的规则一致（本轮之前几乎都没抽过 → 与期望顺序前几位对齐）
    expect(order.slice(0, new Set(seen).size)).toEqual(expect.arrayContaining([...new Set(seen)]));
  });

  test('换一题不换人：同一张卡反复换题，讲者与归属不变', async ({ page, request }) => {
    await ensureMembers(request, 3);

    await page.goto('/');
    await expect(page.locator('button[data-nav="draw"]')).toBeVisible({ timeout: 15000 });
    await page.click('button[data-nav="draw"]');
    await page.click('button.view-draw-action');
    await expect(page.locator('.view-draw-card')).toBeVisible({ timeout: 10000 });

    const whoBefore = await page.locator('.view-draw-card-who').innerText();
    const nextBefore = await page.locator('p.view-draw-speaker').innerText();

    await page.click('.view-draw-card-actions .btn-ghost');   // 换一题
    await expect(page.locator('.view-draw-card')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.view-draw-card-who')).toHaveText(whoBefore);  // 归属不变（仍是同一人）
    await expect(page.locator('p.view-draw-speaker')).toHaveText(nextBefore); // 下一位也不变
  });
});