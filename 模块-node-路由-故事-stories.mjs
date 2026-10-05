// 模块-node-路由-故事-stories.mjs
// 故事 CRUD / 照片上传删除 / 照片静态访问 / 回忆录三视图（对照 app.py 端点 #11–#17）
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { ok, err, ApiError, requireIntId, notFound } from './模块-node-响应-response.mjs';
import { PHOTO_EXTS, PHOTO_MAX_SIZE } from './模块-node-配置-config.mjs';
import { jsonBody, validateStoryFields, magicOk, fixOriginalname } from './模块-node-校验-validate.mjs';
import { storyById, publicStory, memoirGroups } from './模块-node-查询-query.mjs';
import { withTx, purgePhotosOfStory } from './模块-node-数据库-db.mjs';

// multipart 全部读入内存：先全量校验、再统一落盘（两遍式，避免写一半失败）
const upload = multer({ storage: multer.memoryStorage() });

export function registerStoryRoutes(app, ctx) {
  const { uploadDir } = ctx.config;
  const { categoryOrder } = ctx;

  // #11 新建故事
  app.post('/api/stories', (req, res) => {
    const payload = jsonBody(req);
    const conn = req.db;
    const fields = validateStoryFields(payload, conn, true);
    const result = conn
      .prepare(
        `INSERT INTO stories(topic_id, member_id, content, story_date, followups)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        fields.topic_id,
        fields.member_id,
        fields.content,
        fields.story_date ?? null,
        fields.followups ?? '[]'
      );
    return ok(res, publicStory(storyById(conn, Number(result.lastInsertRowid))));
  });

  // #12 更新故事（partial，自动更新 updated_at）
  app.put('/api/stories/:id', requireIntId, (req, res) => {
    const payload = jsonBody(req);
    const conn = req.db;
    const storyId = req.intId;
    if (!conn.prepare('SELECT 1 FROM stories WHERE id=?').get(storyId)) {
      return err(res, 'NOT_FOUND', `story_id=${storyId} 不存在`, 404);
    }
    const fields = validateStoryFields(payload, conn, false);
    if (Object.keys(fields).length === 0) throw new ApiError('BAD_REQUEST', '无可更新字段');
    const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    conn
      .prepare(`UPDATE stories SET ${sets}, updated_at = datetime('now','localtime') WHERE id=?`)
      .run(...Object.values(fields), storyId);
    return ok(res, publicStory(storyById(conn, storyId)));
  });

  // #13 删除故事（事务内先 purge 照片文件，photos 行由级联清除）
  app.delete('/api/stories/:id', requireIntId, (req, res) => {
    const conn = req.db;
    const storyId = req.intId;
    return withTx(conn, (tx) => {
      if (!conn.prepare('SELECT 1 FROM stories WHERE id=?').get(storyId)) {
        tx.rollback();
        return err(res, 'NOT_FOUND', `story_id=${storyId} 不存在`, 404);
      }
      purgePhotosOfStory(conn, uploadDir, storyId);
      conn.prepare('DELETE FROM stories WHERE id=?').run(storyId);
      tx.commit();
      return ok(res, { deleted: 1 });
    });
  });

  // #14 上传照片（multipart，字段 files[] 多值 + caption 可选）
  app.post('/api/stories/:id/photos', requireIntId, upload.any(), (req, res) => {
    const conn = req.db;
    const storyId = req.intId;
    if (!conn.prepare('SELECT 1 FROM stories WHERE id=?').get(storyId)) {
      return err(res, 'NOT_FOUND', `story_id=${storyId} 不存在`, 404);
    }
    const files = (req.files || []).filter((f) => f.fieldname === 'files[]');
    if (files.length === 0) throw new ApiError('BAD_REQUEST', '缺少上传文件字段 files[]');
    let cap = req.body ? req.body.caption : undefined;
    if (Array.isArray(cap)) cap = cap[0];
    const caption = (typeof cap === 'string' ? cap : '').trim();

    // 第一遍：逐文件校验（大小 → 扩展名 → 魔数），任一失败整体拒绝
    const validated = [];
    for (const f of files) {
      const size = f.buffer.length;
      if (size > PHOTO_MAX_SIZE) {
        return err(res, 'PAYLOAD_TOO_LARGE', `文件 ${f.originalname} 超过 10MB 上限`, 413);
      }
      const orig = fixOriginalname(f.originalname || '');
      const ext = orig.includes('.') ? orig.split('.').pop().toLowerCase() : '';
      if (!PHOTO_EXTS.has(ext)) {
        return err(res, 'UNSUPPORTED_TYPE', `文件 ${orig} 的扩展名不在白名单（jpg/jpeg/png/webp/gif）`, 415);
      }
      if (!magicOk(ext, f.buffer.subarray(0, 12))) {
        return err(res, 'UNSUPPORTED_TYPE', `文件 ${orig} 的内容与扩展名不符（疑似伪装文件）`, 415);
      }
      validated.push({ f, ext, orig });
    }
    // 第二遍：全部通过后落盘 + 写库（uuid 重命名，防穿越/乱码/重名）
    const savedIds = [];
    for (const { f, ext, orig } of validated) {
      const newName = `${randomUUID().replace(/-/g, '')}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, newName), f.buffer);
      const result = conn
        .prepare('INSERT INTO photos(story_id, filename, original_name, caption) VALUES (?, ?, ?, ?)')
        .run(storyId, newName, orig, caption);
      savedIds.push(Number(result.lastInsertRowid));
    }
    const rows = savedIds.map((pid) => ({ ...conn.prepare('SELECT * FROM photos WHERE id=?').get(pid) }));
    return ok(res, rows);
  });

  // #15 删除照片（先删行，再删文件，ENOENT 忽略）
  app.delete('/api/photos/:id', requireIntId, (req, res) => {
    const conn = req.db;
    const photoId = req.intId;
    const row = conn.prepare('SELECT * FROM photos WHERE id=?').get(photoId);
    if (!row) return err(res, 'NOT_FOUND', `photo_id=${photoId} 不存在`, 404);
    conn.prepare('DELETE FROM photos WHERE id=?').run(photoId);
    try {
      fs.rmSync(path.join(uploadDir, row.filename));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return ok(res, { deleted: 1 });
  });

  // #16 照片静态访问（含路径穿越防护 + 不存在 JSON 404）
  app.get('/uploads/:filename', (req, res) => {
    const raw = req.params.filename;
    const base = path.resolve(uploadDir);
    const target = path.resolve(base, raw);
    if (
      raw.includes('/') ||
      raw.includes('\\') ||
      raw.includes('\0') ||
      path.basename(raw) !== raw ||
      !(target === base || target.startsWith(base + path.sep))
    ) {
      return notFound(res);
    }
    return res.sendFile(target, (e) => {
      if (e && !res.headersSent) notFound(res);
    });
  });

  // #17 回忆录三视图（?view=timeline|member|topic，默认 timeline）
  app.get('/api/memoir', (req, res) => {
    let view = req.query.view;
    if (Array.isArray(view)) view = view[0];
    if (view === undefined) view = 'timeline';
    if (view !== 'timeline' && view !== 'member' && view !== 'topic') {
      throw new ApiError('BAD_REQUEST', 'view 须为 timeline / member / topic 之一');
    }
    const conn = req.db;
    return ok(res, memoirGroups(conn, view, categoryOrder));
  });
}