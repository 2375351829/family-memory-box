// 辅助-夹具-helpers.mjs · 集成测试共享夹具
// 每文件 beforeAll 建隔离临时目录 → initDb(normalizeConfig({dataDir:tmp})) → createApp(config)
// → supertest(app)；afterAll 先关连接再递归删除临时目录（Windows 上 WAL/-shm 句柄未关会删不掉）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { normalizeConfig } from '../../模块-node-配置-config.mjs';
import { initDb, openDb } from '../../模块-node-数据库-db.mjs';
import { createApp } from '../../模块-node-应用-app.mjs';

// 标准 JPEG（1×1 白色，真实可解码）base64：供照片上传/备份往返用例
export const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
export const JPEG_BYTES = Buffer.from(JPEG_BASE64, 'base64');

/** 建隔离测试环境：返回 { tmp, config, api, app } */
export function setupTestEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmb-test-'));
  const config = normalizeConfig({ dataDir: tmp });
  initDb(config); // 建表 + schema_version + 48 条内置话题
  const app = createApp(config);
  const api = request(app);
  return { tmp, config, api, app };
}

/** 删除临时目录（带重试：等残余连接句柄释放） */
export function rmrf(dir) {
  for (let i = 0; i < 30; i += 1) {
    try {
      if (!fs.existsSync(dir)) return;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch {
      sleepSync(150);
    }
  }
  // 最后一次尝试，失败则抛出以便发现泄漏
  fs.rmSync(dir, { recursive: true, force: true });
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* 自旋 */
  }
}

/** 直连查询（独立短连接，返回行/标量） */
export function query(env, sql, ...params) {
  const conn = openDb(env.config.dbPath);
  try {
    const stmt = conn.prepare(sql);
    return params.length ? stmt.all(...params) : stmt.all();
  } finally {
    conn.close();
  }
}

export function queryOne(env, sql, ...params) {
  const conn = openDb(env.config.dbPath);
  try {
    const stmt = conn.prepare(sql);
    return params.length ? stmt.get(...params) : stmt.get();
  } finally {
    conn.close();
  }
}

export function count(env, table) {
  return queryOne(env, `SELECT COUNT(*) AS c FROM ${table}`).c;
}

/** 集成辅助：创建成员 → 返回后端 data（含 id） */
export async function createMember(api, name = '测试员', relation = '我') {
  const res = await api.post('/api/members').send({ name, relation });
  if (res.status !== 200) throw new Error(`createMember 失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** 集成辅助：创建自定义话题 → 返回 data（含 id） */
export async function createTopic(api, category = '童年糗事', text = '自定义话题', followUps = []) {
  const payload = { category, text };
  if (followUps.length) payload.follow_ups = followUps;
  const res = await api.post('/api/topics').send(payload);
  if (res.status !== 200) throw new Error(`createTopic 失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** 集成辅助：抽一题 → 返回 data */
export async function drawOnce(api, memberId, category) {
  const payload = { member_id: memberId };
  if (category) payload.category = category;
  const res = await api.post('/api/draw').send(payload);
  if (res.status !== 200) throw new Error(`draw 失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** 集成辅助：创建故事 → 返回 data */
export async function createStory(api, topicId, memberId, extra = {}) {
  const payload = { topic_id: topicId, member_id: memberId, content: '正文内容', ...extra };
  const res = await api.post('/api/stories').send(payload);
  if (res.status !== 200) throw new Error(`createStory 失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** 上传照片（buffer）→ 返回 data（照片数组） */
export async function uploadPhoto(api, storyId, buffer = JPEG_BYTES, filename = '照片.jpg', caption = '') {
  let req = api.post(`/api/stories/${storyId}/photos`);
  if (caption) req = req.field('caption', caption);
  const res = await req.attach('files[]', buffer, { filename, contentType: 'image/jpeg' });
  if (res.status !== 200) throw new Error(`uploadPhoto 失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}