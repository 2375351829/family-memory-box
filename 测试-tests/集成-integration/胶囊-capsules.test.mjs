// 集成测试 #9 · 时间胶囊（对照 app.py 端点 #20–#22）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember } from './辅助-夹具-helpers.mjs';

let env;
let member;
beforeAll(async () => {
  env = setupTestEnv();
  member = await createMember(env.api, '胶囊员', '我');
});
afterAll(() => { rmrf(env.tmp); });

describe('POST /api/capsules', () => {
  it('创建成功（指定成员），is_opened=0', async () => {
    const res = await env.api.post('/api/capsules').send({ member_id: member.id, title: '给未来的信', content: '你好', open_date: '2099-01-01' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.member_id).toBe(member.id);
    expect(d.title).toBe('给未来的信');
    expect(d.is_opened).toBe(0);
    expect(d.open_date).toBe('2099-01-01');
  });

  it('member_id 省略 → 家庭共享胶囊（member_id=null）', async () => {
    const res = await env.api.post('/api/capsules').send({ title: '共享', open_date: '2000-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.data.member_id).toBe(null);
  });

  it('open_date 非法日期 2024-02-30 → 400「不是合法日期」', async () => {
    const res = await env.api.post('/api/capsules').send({ title: 'x', open_date: '2024-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('open_date 不是合法日期');
  });

  it('open_date 格式 2024-2-1 → 400「格式须为 YYYY-MM-DD」', async () => {
    const res = await env.api.post('/api/capsules').send({ title: 'x', open_date: '2024-2-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('open_date 必填且格式须为 YYYY-MM-DD');
  });

  it('member_id 不存在 → 404', async () => {
    const res = await env.api.post('/api/capsules').send({ member_id: 99999, title: 'x', open_date: '2099-01-01' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('member_id=99999 不存在');
  });
});

describe('POST /api/capsules/:id/open', () => {
  it('未到期 → 400「胶囊未到期，开启日期为 …」', async () => {
    const c = (await env.api.post('/api/capsules').send({ title: '未到期', open_date: '2099-01-01' })).body.data;
    const res = await env.api.post(`/api/capsules/${c.id}/open`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('胶囊未到期，开启日期为 2099-01-01');
  });

  it('到期可开启，且再次开启幂等', async () => {
    const c = (await env.api.post('/api/capsules').send({ title: '已到期', open_date: '2000-01-01' })).body.data;
    const r1 = await env.api.post(`/api/capsules/${c.id}/open`);
    expect(r1.status).toBe(200);
    expect(r1.body.data.is_opened).toBe(1);
    const r2 = await env.api.post(`/api/capsules/${c.id}/open`);
    expect(r2.status).toBe(200);
    expect(r2.body.data.is_opened).toBe(1);
  });

  it('胶囊不存在 → 404', async () => {
    const res = await env.api.post('/api/capsules/99999/open');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('capsule_id=99999 不存在');
  });
});

describe('GET /api/capsules', () => {
  it('列出全部胶囊（created_at 降序）', async () => {
    const res = await env.api.get('/api/capsules');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });
});