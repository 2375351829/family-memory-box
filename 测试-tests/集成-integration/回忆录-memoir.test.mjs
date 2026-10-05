// 集成测试 #7 · 回忆录三视图（对照 app.py 端点 #17 与 8.2 分组）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember, createTopic, createStory, uploadPhoto } from './辅助-夹具-helpers.mjs';

let env;
let A; let B; let t1; let t2; let s1; let s2; let s3;
beforeAll(async () => {
  env = setupTestEnv();
  A = await createMember(env.api, '按成员A', '爷爷');
  B = await createMember(env.api, '按成员B', '奶奶');
  t1 = await createTopic(env.api, '节日记忆', '节日话题');
  t2 = await createTopic(env.api, '童年糗事', '童年话题');
  s1 = await createStory(env.api, t1.id, A.id, { content: 's1', story_date: '1985' });
  s2 = await createStory(env.api, t2.id, B.id, { content: 's2', story_date: '1990' });
  s3 = await createStory(env.api, t1.id, A.id, { content: 's3', story_date: null });
  await uploadPhoto(env.api, s1.id);
});
afterAll(() => { rmrf(env.tmp); });

function assertItemsDesc(items) {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const cur = items[i];
    const okOrder = prev.created_at !== cur.created_at ? prev.created_at > cur.created_at : prev.id > cur.id;
    expect(okOrder).toBe(true);
  }
}

describe('GET /api/memoir', () => {
  it('默认 timeline：年份升序、未详置末；meta.count/photoCount 正确', async () => {
    const res = await env.api.get('/api/memoir');
    expect(res.status).toBe(200);
    const groups = res.body.data.groups;
    expect(groups.map((g) => g.key)).toEqual(['1985', '1990', '年份未详']);
    const g1985 = groups.find((g) => g.key === '1985');
    expect(g1985.label).toBe('1985');
    expect(g1985.meta.count).toBe(1);
    expect(g1985.meta.photoCount).toBe(1); // s1 有 1 张照片
    expect(groups.find((g) => g.key === '年份未详').meta.count).toBe(1);
    groups.forEach((g) => assertItemsDesc(g.items));
    expect(g1985.items[0].followups).toEqual([]);
  });

  it('member 视图：按 sort_order/id 排序、label=成员姓名、组内降序', async () => {
    const res = await env.api.get('/api/memoir').query({ view: 'member' });
    expect(res.status).toBe(200);
    const groups = res.body.data.groups;
    expect(groups.map((g) => g.key)).toEqual([String(A.id), String(B.id)]);
    expect(groups[0].label).toBe('按成员A');
    expect(groups[0].meta.count).toBe(2);
    expect(groups[1].meta.count).toBe(1);
    groups.forEach((g) => assertItemsDesc(g.items));
  });

  it('topic 视图：按内置分类固定顺序排序、label=分类 · 话题文本', async () => {
    const res = await env.api.get('/api/memoir').query({ view: 'topic' });
    expect(res.status).toBe(200);
    const groups = res.body.data.groups;
    // 童年糗事(rank0) 在 节日记忆(rank3) 之前
    expect(groups.map((g) => g.key)).toEqual([String(t2.id), String(t1.id)]);
    expect(groups[0].label).toBe('童年糗事 · 童年话题');
    expect(groups[1].label).toBe('节日记忆 · 节日话题');
    expect(groups[1].meta.count).toBe(2);
    groups.forEach((g) => assertItemsDesc(g.items));
  });

  it('非法 view → 400 中文文案', async () => {
    const res = await env.api.get('/api/memoir').query({ view: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('view 须为 timeline / member / topic 之一');
  });
});