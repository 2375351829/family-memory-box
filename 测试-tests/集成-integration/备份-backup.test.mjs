// 集成测试 #8 · JSON 备份导出/导入（对照 app.py 端点 #18–#19）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv, rmrf, createMember, createTopic, createStory, uploadPhoto, count } from './辅助-夹具-helpers.mjs';

let env;
let backupBody; // 首次导出的完整备份对象

async function exportBackup(withPhotos = true) {
  const res = await env.api.get('/api/export/json').query(withPhotos ? {} : { with_photos: '0' });
  return res;
}

async function importBackup(obj) {
  return env.api.post('/api/import/json').attach('file', Buffer.from(JSON.stringify(obj), 'utf8'), 'backup.json');
}

beforeAll(async () => {
  env = setupTestEnv();
  const m = await createMember(env.api, '备份员', '我');
  const t = await createTopic(env.api, '节日记忆', '备份话题');
  const s = await createStory(env.api, t.id, m.id, { content: '备份正文', story_date: '1985', followups: [{ q: '问', a: '答' }] });
  await uploadPhoto(env.api, s.id, undefined, '备份照片.jpg', '说明');
  const res = await exportBackup(true);
  backupBody = JSON.parse(res.text);
});
afterAll(() => { rmrf(env.tmp); });

describe('GET /api/export/json', () => {
  it('Content-Disposition 文件名格式 family-memory-backup-YYYYMMDD.json', async () => {
    const res = await exportBackup(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="family-memory-backup-\d{8}\.json"$/);
  });

  it('body 无末尾换行；含 9 个顶层键；photo_files 含照片 base64', async () => {
    const res = await exportBackup(true);
    expect(res.text.endsWith('\n')).toBe(false);
    const obj = JSON.parse(res.text);
    expect(Object.keys(obj).sort()).toEqual(['draws', 'members', 'meta', 'photo_files', 'photos', 'stories', 'time_capsules', 'topic_followups', 'topics']);
    expect(obj.meta.schema_version).toBe('1');
    expect(Object.keys(obj.photo_files).length).toBe(1);
    expect(obj.photo_files[Object.keys(obj.photo_files)[0]]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('with_photos=0 → photo_files 为空对象', async () => {
    const res = await exportBackup(false);
    const obj = JSON.parse(res.text);
    expect(obj.photo_files).toEqual({});
  });
});

describe('POST /api/import/json', () => {
  it('缺必要字段 → 400，且原库数据未变', async () => {
    const before = { m: count(env, 'members'), s: count(env, 'stories'), p: count(env, 'photos') };
    const broken = { ...backupBody };
    delete broken.members;
    const res = await importBackup(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('备份缺少必要字段：members');
    expect({ m: count(env, 'members'), s: count(env, 'stories'), p: count(env, 'photos') }).toEqual(before);
  });

  it('schema_version=9 → 400 VERSION_MISMATCH', async () => {
    const broken = { ...backupBody, meta: { schema_version: '9', exported_at: '2020-01-01 00:00:00' } };
    const res = await importBackup(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERSION_MISMATCH');
    expect(res.body.error.message).toContain('不一致');
  });

  it('photo_files 非法 base64 → 400 且整体回滚', async () => {
    const before = count(env, 'photos');
    const broken = { ...backupBody, photo_files: { 'a.jpg': '!!!not-base64!!!' } };
    const res = await importBackup(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('photo_files 内存在不合法的 base64 数据');
    expect(count(env, 'photos')).toBe(before);
  });

  it('photo_files 非法文件名（路径穿越）→ 400', async () => {
    const broken = { ...backupBody, photo_files: { '../evil.jpg': 'AAAA' } };
    const res = await importBackup(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('photo_files 内存在不合法的文件名或数据');
  });

  it('导出→导入往返：数据条数与内容一致', async () => {
    const before = await env.api.get('/api/state');
    const roundtrip = await exportBackup(true);
    const obj = JSON.parse(roundtrip.text);
    const res = await importBackup(obj);
    expect(res.status).toBe(200);
    expect(res.body.data.imported.members).toBe(before.body.data.members.length);
    expect(res.body.data.imported.stories).toBe(before.body.data.stories.length);

    const after = await env.api.get('/api/state');
    expect(after.body.data.members.map((x) => x.name)).toEqual(before.body.data.members.map((x) => x.name));
    expect(after.body.data.stories.find((s) => s.content === '备份正文').followups).toEqual([{ q: '问', a: '答' }]);
    expect(after.body.data.photos.length).toBe(before.body.data.photos.length);
  });

  it('非法 JSON 文件 → 400', async () => {
    const res = await env.api.post('/api/import/json').attach('file', Buffer.from('not json at all', 'utf8'), 'x.json');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('备份文件不是合法的 JSON');
  });

  it('缺 file 字段 → 400', async () => {
    const res = await env.api.post('/api/import/json').field('other', 'x');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('缺少上传文件字段 file');
  });
});