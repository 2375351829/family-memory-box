// 集成测试 #5 · 故事 CRUD（对照 app.py 端点 #11–#13；含存储格式与 updated_at 断言）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember, createTopic, queryOne } from './辅助-夹具-helpers.mjs';

let env;
let member;
let topic;
beforeAll(async () => {
  env = setupTestEnv();
  member = await createMember(env.api, '讲述人', '爷爷');
  topic = await createTopic(env.api, '童年糗事', '小时候做过什么？', ['当时几岁？', '现在怎么看？']);
});
afterAll(() => { rmrf(env.tmp); });

describe('POST /api/stories', () => {
  it('创建成功，返回 Story 契约字段与已解析 followups', async () => {
    const res = await env.api.post('/api/stories').send({
      topic_id: topic.id,
      member_id: member.id,
      content: '  那年夏天  ',
      story_date: '1985',
      followups: [{ q: '问', a: '答' }],
    });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.topic_id).toBe(topic.id);
    expect(d.member_id).toBe(member.id);
    expect(d.content).toBe('那年夏天'); // 去空白
    expect(d.story_date).toBe('1985');
    expect(d.followups).toEqual([{ q: '问', a: '答' }]);
    expect(d.photos).toEqual([]);
    expect(d.name).toBe('讲述人');
    expect(d.relation).toBe('爷爷');
    expect(Object.keys(d)).toEqual(['id', 'topic_id', 'member_id', 'topic_text', 'relation', 'name', 'content', 'story_date', 'followups', 'photos', 'created_at', 'updated_at']);
  });

  it('存储格式：DB 内 stories.followups 文本等于 Python json.dumps 风格 [{"q": "问", "a": "答"}]', async () => {
    const row = queryOne(env, 'SELECT followups FROM stories ORDER BY id LIMIT 1');
    expect(row.followups).toBe('[{"q": "问", "a": "答"}]');
  });

  it('缺 content → 400；topic_id 非整数 → 404；member_id 不存在 → 404', async () => {
    const r1 = await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: member.id });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toBe('content 必填（可为空串占位）');

    const r2 = await env.api.post('/api/stories').send({ topic_id: 'abc', member_id: member.id, content: 'x' });
    expect(r2.status).toBe(404);
    expect(r2.body.error.message).toBe('topic_id=abc 不存在');

    const r3 = await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: 99999, content: 'x' });
    expect(r3.status).toBe(404);
    expect(r3.body.error.message).toBe('member_id=99999 不存在');
  });

  it('story_date 非法格式 → 400', async () => {
    const res = await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: member.id, content: 'x', story_date: '1985-6-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('story_date 格式须为 YYYY 或 YYYY-MM-DD');
  });
});

describe('PUT /api/stories/:id', () => {
  it('更新成功并自动刷新 updated_at', async () => {
    const created = (await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: member.id, content: '初稿' })).body.data;
    await new Promise((r) => setTimeout(r, 1100)); // 时间戳为秒级，稍候以确保可区分
    const res = await env.api.put(`/api/stories/${created.id}`).send({ content: '改稿', story_date: '1990-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('改稿');
    expect(res.body.data.story_date).toBe('1990-01-01');
    expect(res.body.data.updated_at >= created.updated_at).toBe(true);
    expect(res.body.data.updated_at > created.updated_at).toBe(true);
  });

  it('无可更新字段 → 400；故事不存在 → 404', async () => {
    const created = (await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: member.id, content: 'x' })).body.data;
    const r1 = await env.api.put(`/api/stories/${created.id}`).send({});
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toBe('无可更新字段');

    const r2 = await env.api.put('/api/stories/99999').send({ content: 'x' });
    expect(r2.status).toBe(404);
    expect(r2.body.error.message).toBe('story_id=99999 不存在');
  });
});

describe('followups 往返与删除', () => {
  it('followups 经 /api/state 往返一致', async () => {
    const created = (await env.api.post('/api/stories').send({
      topic_id: topic.id,
      member_id: member.id,
      content: '往返',
      followups: [{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: '' }],
    })).body.data;
    const res = await env.api.get('/api/state');
    const found = res.body.data.stories.find((s) => s.id === created.id);
    expect(found.followups).toEqual([{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: '' }]);
  });

  it('删除成功 {deleted:1}；再次删除 404', async () => {
    const created = (await env.api.post('/api/stories').send({ topic_id: topic.id, member_id: member.id, content: '待删' })).body.data;
    const del = await env.api.delete(`/api/stories/${created.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: 1 });
    const again = await env.api.delete(`/api/stories/${created.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error.message).toBe(`story_id=${created.id} 不存在`);
  });
});