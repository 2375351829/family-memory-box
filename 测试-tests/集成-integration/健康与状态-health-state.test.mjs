// 集成测试 #1 · health / state（对照 app.py 端点 #1–#2）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember, createStory, uploadPhoto, drawOnce } from './辅助-夹具-helpers.mjs';

let env;
beforeAll(() => { env = setupTestEnv(); });
afterAll(() => { rmrf(env.tmp); });

describe('GET /api/health', () => {
  it('返回 status/schema_version/counts 五键，schema_version=1，内置话题 48', async () => {
    const res = await env.api.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.schema_version).toBe('1');
    expect(Object.keys(res.body.data.counts).sort()).toEqual(['capsules', 'members', 'photos', 'stories', 'topics']);
    expect(res.body.data.counts.topics).toBe(48);
    expect(res.body.data.counts.members).toBe(0);
    expect(res.body.data.counts.stories).toBe(0);
    expect(res.body.data.counts.photos).toBe(0);
    expect(res.body.data.counts.capsules).toBe(0);
  });

  it('响应体末尾带换行（jresp 约定）', async () => {
    const res = await env.api.get('/api/health');
    expect(typeof res.text).toBe('string');
    expect(res.text.endsWith('\n')).toBe(true);
  });

  // 首页「手机上看」从 /api/health.lan_urls 拿真实局域网地址（同步而非写死示例 IP）
  it('health 返回 lan_urls：全部 http://<私网IP>:<port>，且不含回环地址', async () => {
    const res = await env.api.get('/api/health');
    const urls = res.body.data.lan_urls;
    expect(Array.isArray(urls)).toBe(true);
    for (const u of urls) {
      expect(u).toMatch(/^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/);
      expect(u).not.toContain('127.0.0.1');
      expect(u).not.toContain('localhost');
    }
  });
});

describe('GET /api/state', () => {
  it('返回六键，followups 按 topic_id 分组（键为字符串）', async () => {
    const res = await env.api.get('/api/state');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(Object.keys(d).sort()).toEqual(['capsules', 'followups', 'members', 'photos', 'stories', 'topics']);
    expect(d.topics.length).toBe(48);
    expect(Array.isArray(d.followups['1'])).toBe(true);
    expect(d.followups['1'].length).toBe(2); // 每条内置话题 2 条追问
  });

  it('增删数据后 state 随之变化（成员/故事/照片/抽题计数）', async () => {
    const m = await createMember(env.api, '状态员', '家人');
    const draw = await drawOnce(env.api, m.id);
    const s = await createStory(env.api, draw.topic.id, m.id, { content: '状态测试' });
    await uploadPhoto(env.api, s.id);

    const res = await env.api.get('/api/state');
    const d = res.body.data;
    expect(d.members.length).toBe(1);
    expect(d.stories.length).toBe(1);
    expect(d.photos.length).toBe(1);
    expect(d.stories[0].content).toBe('状态测试');
    expect(d.stories[0].photos.length).toBe(1);

    const health = await env.api.get('/api/health');
    expect(health.body.data.counts.members).toBe(1);
    expect(health.body.data.counts.stories).toBe(1);
    expect(health.body.data.counts.photos).toBe(1);
  });
});