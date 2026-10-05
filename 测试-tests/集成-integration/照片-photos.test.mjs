// 集成测试 #6 · 照片上传/删除与级联清文件（对照 app.py 端点 #14–#16）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv, rmrf, createMember, createTopic, createStory, uploadPhoto, count, JPEG_BYTES } from './辅助-夹具-helpers.mjs';

let env;
beforeAll(() => { env = setupTestEnv(); });
afterAll(() => { rmrf(env.tmp); });

const filePath = (fn) => path.join(env.config.uploadDir, fn);
const exists = (fn) => fs.existsSync(filePath(fn));

async function freshStory(member) {
  const topic = await createTopic(env.api, '味道与物件', `照片用例话题-${Date.now()}-${Math.random()}`);
  return createStory(env.api, topic.id, member.id, { content: '带照片的故事' });
}

describe('POST /api/stories/:id/photos', () => {
  it('上传合法 JPEG：回报 filename/original_name/caption，落盘写库', async () => {
    const m = await createMember(env.api, '拍照员', '妈妈');
    const story = await freshStory(m);
    const rows = await uploadPhoto(env.api, story.id, JPEG_BYTES, '回忆照片.jpg', '那年夏天');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    const p = rows[0];
    expect(p.filename).toMatch(/^[0-9a-f]{32}\.jpg$/);
    expect(p.original_name).toBe('回忆照片.jpg');
    expect(p.caption).toBe('那年夏天');
    expect(exists(p.filename)).toBe(true);

    // caption 存库
    const res = await env.api.get('/api/state');
    expect(res.body.data.photos.find((x) => x.id === p.id).caption).toBe('那年夏天');
  });

  it('超 10MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const m = await createMember(env.api, '大文件员', '爸爸');
    const story = await freshStory(m);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const res = await env.api.post(`/api/stories/${story.id}/photos`).attach('files[]', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.message).toContain('超过 10MB 上限');
  });

  it('扩展名白名单外 → 415 UNSUPPORTED_TYPE', async () => {
    const m = await createMember(env.api, '扩展名员', '奶奶');
    const story = await freshStory(m);
    const res = await env.api.post(`/api/stories/${story.id}/photos`).attach('files[]', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
    expect(res.body.error.message).toContain('不在白名单');
  });

  it('魔数伪装（文本内容 + .png 名）→ 415', async () => {
    const m = await createMember(env.api, '伪装员', '爷爷');
    const story = await freshStory(m);
    const res = await env.api.post(`/api/stories/${story.id}/photos`).attach('files[]', Buffer.from('this is not a png at all'), { filename: 'fake.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
    expect(res.body.error.message).toContain('内容与扩展名不符');
  });

  it('无 files[] 字段 → 400', async () => {
    const m = await createMember(env.api, '缺文件员', '我');
    const story = await freshStory(m);
    const res = await env.api.post(`/api/stories/${story.id}/photos`).field('caption', '只有说明');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('缺少上传文件字段 files[]');
  });

  it('故事不存在 → 404', async () => {
    const res = await env.api.post('/api/stories/99999/photos').attach('files[]', JPEG_BYTES, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('story_id=99999 不存在');
  });
});

describe('DELETE /api/photos/:id', () => {
  it('先删行后删文件：行消失且磁盘文件被删除', async () => {
    const m = await createMember(env.api, '单删员', '亲属');
    const story = await freshStory(m);
    const [p] = await uploadPhoto(env.api, story.id);
    expect(exists(p.filename)).toBe(true);

    const res = await env.api.delete(`/api/photos/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 1 });
    const state = await env.api.get('/api/state');
    expect(state.body.data.photos.find((x) => x.id === p.id)).toBeUndefined();
    expect(exists(p.filename)).toBe(false);
  });

  it('照片不存在 → 404', async () => {
    const res = await env.api.delete('/api/photos/99999');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('photo_id=99999 不存在');
  });
});

describe('级联清文件：删故事 / 删成员 / 删话题', () => {
  it('删除故事 → 其照片文件被清除', async () => {
    const m = await createMember(env.api, '删故事', '叔父');
    const story = await freshStory(m);
    const [p] = await uploadPhoto(env.api, story.id);
    expect(exists(p.filename)).toBe(true);
    await env.api.delete(`/api/stories/${story.id}`);
    expect(exists(p.filename)).toBe(false);
    expect(count(env, 'photos')).toBeTypeOf('number');
  });

  it('删除成员 → 其全部故事照片文件被清除', async () => {
    const m = await createMember(env.api, '删成员', '家人');
    const story = await freshStory(m);
    const [p] = await uploadPhoto(env.api, story.id);
    expect(exists(p.filename)).toBe(true);
    await env.api.delete(`/api/members/${m.id}`);
    expect(exists(p.filename)).toBe(false);
  });

  it('删除自定义话题 → 该话题下故事照片文件被清除', async () => {
    const m = await createMember(env.api, '删话题', '舅母');
    const topic = await createTopic(env.api, '遗憾与心愿', `待删话题-${Date.now()}`);
    const story = await createStory(env.api, topic.id, m.id, { content: 'x' });
    const [p] = await uploadPhoto(env.api, story.id);
    expect(exists(p.filename)).toBe(true);
    await env.api.delete(`/api/topics/${topic.id}`);
    expect(exists(p.filename)).toBe(false);
  });
});