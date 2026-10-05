// 集成测试 #3 · 话题（对照 app.py 端点 #7–#9）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf } from './辅助-夹具-helpers.mjs';

let env;
beforeAll(() => { env = setupTestEnv(); });
afterAll(() => { rmrf(env.tmp); });

describe('GET /api/topics', () => {
  it('全量 48 条，均含 follow_ups 数组', async () => {
    const res = await env.api.get('/api/topics');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(48);
    expect(Array.isArray(res.body.data[0].follow_ups)).toBe(true);
    expect(res.body.data[0].follow_ups.length).toBe(2);
    expect(res.body.data.every((t) => t.is_builtin === 1)).toBe(true);
  });

  it('按分类过滤（节日记忆 8 条）', async () => {
    const res = await env.api.get('/api/topics').query({ category: '节日记忆' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(8);
    expect(res.body.data.every((t) => t.category === '节日记忆')).toBe(true);
  });
});

describe('POST /api/topics', () => {
  it('创建自定义话题（is_builtin=0），follow_ups 去空白', async () => {
    const res = await env.api.post('/api/topics').send({ category: '童年糗事', text: '自定义问题？', follow_ups: ['追问一', '  ', '追问二'] });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.is_builtin).toBe(0);
    expect(d.text).toBe('自定义问题？');
    expect(d.follow_ups).toEqual(['追问一', '追问二']);
  });

  it('category 必填 → 400；text 超长 → 400', async () => {
    const r1 = await env.api.post('/api/topics').send({ text: 'x' });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toBe('category 必填');

    const r2 = await env.api.post('/api/topics').send({ category: '童年糗事', text: 'x'.repeat(61) });
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toBe('text 长度须为 1–60');
  });

  it('follow_ups 非字符串数组 → 400', async () => {
    const res = await env.api.post('/api/topics').send({ category: '童年糗事', text: 'x', follow_ups: [1, 2] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('follow_ups 须为字符串数组');
  });
});

describe('DELETE /api/topics/:id', () => {
  it('内置话题不可删除 → 400', async () => {
    const res = await env.api.delete('/api/topics/1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('内置话题不可删除');
  });

  it('不存在 → 404', async () => {
    const res = await env.api.delete('/api/topics/99999');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('topic_id=99999 不存在');
  });

  it('自定义话题可删除 → {deleted:1}', async () => {
    const created = (await env.api.post('/api/topics').send({ category: '童年糗事', text: '待删除话题' })).body.data;
    const res = await env.api.delete(`/api/topics/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 1 });
  });
});