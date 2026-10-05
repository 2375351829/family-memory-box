// 集成测试 #2 · 成员 CRUD（对照 app.py 端点 #3–#6）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf } from './辅助-夹具-helpers.mjs';

let env;
beforeAll(() => { env = setupTestEnv(); });
afterAll(() => { rmrf(env.tmp); });

describe('POST /api/members', () => {
  it('创建成功：默认头像色、sort_order=0、含 created_at', async () => {
    const res = await env.api.post('/api/members').send({ name: '李桂英', relation: '奶奶' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.id).toBeGreaterThan(0);
    expect(d.name).toBe('李桂英');
    expect(d.relation).toBe('奶奶');
    expect(d.avatar_color).toBe('#C0392B');
    expect(d.sort_order).toBe(0);
    expect(typeof d.created_at).toBe('string');
  });

  it('缺 name / relation → 400 且中文文案', async () => {
    const r1 = await env.api.post('/api/members').send({ relation: '爸爸' });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('BAD_REQUEST');
    expect(r1.body.error.message).toBe('name 长度须为 1–20');

    const r2 = await env.api.post('/api/members').send({ name: '王强' });
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toBe('relation 长度须为 1–10');
  });

  it('非对象请求体 → 400 请求体须为 JSON 对象', async () => {
    const res = await env.api.post('/api/members').set('Content-Type', 'application/json').send('[]');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('请求体须为 JSON 对象');
  });
});

describe('GET /api/members', () => {
  it('按 sort_order,id 排序返回列表', async () => {
    const res = await env.api.get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.name)).toEqual(['李桂英']);
  });
});

describe('PUT /api/members/:id', () => {
  it('更新成功并回显', async () => {
    const created = (await env.api.post('/api/members').send({ name: '待改', relation: '我' })).body.data;
    const res = await env.api.put(`/api/members/${created.id}`).send({ name: '改后' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('改后');
    expect(res.body.data.relation).toBe('我');
  });

  it('无可更新字段 → 400', async () => {
    const created = (await env.api.post('/api/members').send({ name: '空改', relation: '家人' })).body.data;
    const res = await env.api.put(`/api/members/${created.id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('无可更新字段');
  });

  it('目标不存在 → 404', async () => {
    const res = await env.api.put('/api/members/99999').send({ name: '不存在' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('member_id=99999 不存在');
  });
});

describe('DELETE /api/members/:id', () => {
  it('删除成功返回 {deleted:1}；再次删除 404', async () => {
    const created = (await env.api.post('/api/members').send({ name: '待删', relation: '亲属' })).body.data;
    const del = await env.api.delete(`/api/members/${created.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: 1 });

    const again = await env.api.delete(`/api/members/${created.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error.message).toBe(`member_id=${created.id} 不存在`);
  });
});

// 称谓唯一：避免「一键预设」重复点击、或手工重复添加造出两个「爷爷」，
// 否则抽题的「本轮轮到：X」无法区分。POST 与 PUT 都要拦。
// 放在文件末尾：本组会新增多名成员，不影响前面按顺序断言成员列表的用例。
describe('称谓唯一（去重校验）', () => {
  it('POST 相同 relation（姓名不同）→ 409 且中文文案', async () => {
    const first = await env.api.post('/api/members').send({ name: '甲', relation: '重复称谓' });
    expect(first.status).toBe(200);

    const res = await env.api.post('/api/members').send({ name: '乙', relation: '重复称谓' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('称谓「重复称谓」已存在，不可重复添加');
  });

  it('不同 relation 可同名 → 200', async () => {
    const r1 = await env.api.post('/api/members').send({ name: '张伟', relation: '表叔' });
    const r2 = await env.api.post('/api/members').send({ name: '张伟', relation: '堂叔' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('PUT 改成他人已用 relation → 409；只改姓名（relation 不变）→ 200', async () => {
    const a = (await env.api.post('/api/members').send({ name: '丙', relation: '甲称谓' })).body.data;
    const b = (await env.api.post('/api/members').send({ name: '丁', relation: '乙称谓' })).body.data;

    const dup = await env.api.put(`/api/members/${b.id}`).send({ relation: a.relation });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe(`称谓「${a.relation}」已存在，不可重复添加`);

    // 只改姓名：relation 未变，不应被自身误判为重复
    const keep = await env.api.put(`/api/members/${b.id}`).send({ name: '丁改' });
    expect(keep.status).toBe(200);
    expect(keep.body.data.name).toBe('丁改');
    expect(keep.body.data.relation).toBe('乙称谓');
  });
});