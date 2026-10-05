// 集成测试 #4 · 抽题（对照 app.py 端点 #10 与 8.1 算法）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember } from './辅助-夹具-helpers.mjs';

let env;
let member;
beforeAll(async () => {
  env = setupTestEnv();
  member = await createMember(env.api, '抽题员', '我');
});
afterAll(() => { rmrf(env.tmp); });

describe('POST /api/draw', () => {
  it('抽题成功：返回 topic/round_no/is_new_round，topic 含 follow_ups', async () => {
    const res = await env.api.post('/api/draw').send({ member_id: member.id });
    expect(res.status).toBe(200);
    expect(res.body.data.round_no).toBe(1);
    expect(res.body.data.is_new_round).toBe(false);
    expect(res.body.data.topic.follow_ups.length).toBe(2);
  });

  it('同轮不重复：连抽 3 次 id 互不相同、round 恒 1', async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await env.api.post('/api/draw').send({ member_id: member.id });
      expect(res.body.data.round_no).toBe(1);
      expect(res.body.data.is_new_round).toBe(false);
      ids.push(res.body.data.topic.id);
    }
    expect(new Set(ids).size).toBe(3);
  });

  // 前端「本轮轮到谁」按 state.members[].last_draw_id 取最久没轮到的人（修复「永远只轮到第一人」）
  it('state 的 members 带轮转字段：新成员 last_draw_id=null/draw_count=0，抽一次后只更新该成员', async () => {
    const other = await createMember(env.api, '计数员', '表叔');
    const before = (await env.api.get('/api/state')).body.data.members;
    const fresh = before.find((m) => m.id === other.id);
    expect(fresh.last_draw_id).toBeNull();    // 从未抽过 → 最优先轮到
    expect(fresh.draw_count).toBe(0);
    expect(before.every((m) => 'last_draw_id' in m && typeof m.draw_count === 'number')).toBe(true);

    const drawnTopic = (await env.api.post('/api/draw').send({ member_id: other.id })).body.data;

    const after = (await env.api.get('/api/state')).body.data.members;
    const drawn = after.find((m) => m.id === other.id);
    expect(drawn.draw_count).toBe(1);
    expect(typeof drawn.last_draw_id).toBe('number');   // 有抽题序号 → 排到队尾
    // 其他成员的轮转字段不受影响（按人分别记账，这正是「对等轮流」的依据）
    const others = after.filter((m) => m.id !== other.id);
    const same = others.every((m) => {
      const b = before.find((x) => x.id === m.id);
      return m.draw_count === b.draw_count && m.last_draw_id === b.last_draw_id;
    });
    expect(same).toBe(true);
    expect(drawnTopic.topic.id).toBeGreaterThan(0);
  });

  it('分类过滤：节日记忆抽满 8 条不重复，第 9 次 is_new_round=true 且 round=2', async () => {
    const m2 = await createMember(env.api, '分类员', '家人');
    const ids = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await env.api.post('/api/draw').send({ member_id: m2.id, category: '节日记忆' });
      expect(res.status).toBe(200);
      expect(res.body.data.topic.category).toBe('节日记忆');
      expect(res.body.data.round_no).toBe(1);
      ids.push(res.body.data.topic.id);
    }
    expect(new Set(ids).size).toBe(8);
    const r9 = await env.api.post('/api/draw').send({ member_id: m2.id, category: '节日记忆' });
    expect(r9.body.data.is_new_round).toBe(true);
    expect(r9.body.data.round_no).toBe(2);
  });

  it('空分类池 → 400「该分类下暂无可抽的话题」', async () => {
    const m3 = await createMember(env.api, '空池员', '亲属');
    const res = await env.api.post('/api/draw').send({ member_id: m3.id, category: '不存在的分类' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('该分类下暂无可抽的话题');
  });

  it('member_id 非整数 → 400', async () => {
    const r1 = await env.api.post('/api/draw').send({ member_id: 'abc' });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toBe('member_id 必填且须为整数');

    const r2 = await env.api.post('/api/draw').send({ member_id: 1.5 });
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toBe('member_id 必填且须为整数');

    const r3 = await env.api.post('/api/draw').send({});
    expect(r3.status).toBe(400);
    expect(r3.body.error.message).toBe('member_id 必填且须为整数');
  });

  it('成员不存在 → 404', async () => {
    const res = await env.api.post('/api/draw').send({ member_id: 99999 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('member_id=99999 不存在');
  });
});