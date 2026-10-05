// 模块-node-路由-备份-backup.mjs
// JSON 备份导出 / 覆盖式导入（对照 app.py 端点 #18–#19 与 TABLE_COLS/CLEAR_ORDER/LOAD_ORDER）
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { ok, err, ApiError, pyDump } from './模块-node-响应-response.mjs';
import { IMPORT_LIMIT, SCHEMA_VERSION } from './模块-node-配置-config.mjs';
import { bindVal } from './模块-node-数据库-db.mjs';

const upload = multer({ storage: multer.memoryStorage() });

// 备份导入导出用的表列清单（列名白名单，防注入）
const TABLE_COLS = {
  members: ['id', 'name', 'relation', 'avatar_color', 'sort_order', 'created_at'],
  topics: ['id', 'category', 'text', 'is_builtin', 'created_at'],
  topic_followups: ['id', 'topic_id', 'order_no', 'text'],
  draws: ['id', 'member_id', 'topic_id', 'round_no', 'drawn_at'],
  stories: ['id', 'topic_id', 'member_id', 'content', 'story_date', 'followups', 'created_at', 'updated_at'],
  photos: ['id', 'story_id', 'filename', 'original_name', 'caption', 'created_at'],
  time_capsules: ['id', 'member_id', 'title', 'content', 'open_date', 'is_opened', 'created_at'],
};
// 清空/重灌顺序：先删子表再删父表，满足外键约束
const CLEAR_ORDER = ['photos', 'stories', 'draws', 'topic_followups', 'topics', 'members', 'time_capsules'];
const LOAD_ORDER = ['members', 'topics', 'topic_followups', 'draws', 'stories', 'photos', 'time_capsules'];
// 缺失字段提示（顺序无关，输出前排序）
const NEED_KEYS = ['meta', 'members', 'topics', 'topic_followups', 'draws', 'stories', 'photos', 'time_capsules', 'photo_files'];

function queryVal(v, dflt) {
  if (v === undefined) return dflt;
  return Array.isArray(v) ? v[0] : v;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function localDateCompact() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isDataError(e) {
  if (e instanceof TypeError || e instanceof RangeError) return true;
  return !!(e && typeof e.code === 'string' && e.code.startsWith('ERR_SQLITE'));
}

export function registerBackupRoutes(app, ctx) {
  const { uploadDir } = ctx.config;

  // #18 全量备份导出（?with_photos=0 排除照片）
  app.get('/api/export/json', (req, res) => {
    const withPhotos = queryVal(req.query.with_photos, '1') !== '0';
    const conn = req.db;
    const sv = conn.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    const payload = {
      meta: {
        schema_version: sv ? sv.value : SCHEMA_VERSION,
        exported_at: localNow(),
      },
      members: conn.prepare('SELECT * FROM members ORDER BY id').all().map((r) => ({ ...r })),
      topics: conn.prepare('SELECT * FROM topics ORDER BY id').all().map((r) => ({ ...r })),
      topic_followups: conn.prepare('SELECT * FROM topic_followups ORDER BY id').all().map((r) => ({ ...r })),
      draws: conn.prepare('SELECT * FROM draws ORDER BY id').all().map((r) => ({ ...r })),
      stories: conn.prepare('SELECT * FROM stories ORDER BY id').all().map((r) => ({ ...r })),
      photos: conn.prepare('SELECT * FROM photos ORDER BY id').all().map((r) => ({ ...r })),
      time_capsules: conn.prepare('SELECT * FROM time_capsules ORDER BY id').all().map((r) => ({ ...r })),
      photo_files: {},
    };
    if (withPhotos) {
      for (const p of conn.prepare('SELECT filename FROM photos').all()) {
        try {
          payload.photo_files[p.filename] = fs.readFileSync(path.join(uploadDir, p.filename)).toString('base64');
        } catch (e) {
          if (e.code !== 'ENOENT') throw e; // 文件缺失不阻断导出
        }
      }
    }
    // 导出端点例外：body 末尾不追加 \n（对照 app.py:902）
    const body = pyDump(payload);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="family-memory-backup-${localDateCompact()}.json"`);
    return res.status(200).send(body);
  });

  // #19 覆盖式导入（危险操作；导入接口独立 512MB 上限并豁免全局 16MB）
  app.post(
    '/api/import/json',
    (req, res, next) => {
      const cl = Number(req.headers['content-length']);
      if (Number.isFinite(cl) && cl > IMPORT_LIMIT) {
        return err(res, 'PAYLOAD_TOO_LARGE', '备份文件超过 512MB 上限', 413);
      }
      return next();
    },
    upload.any(),
    (req, res) => {
      const f = (req.files || []).find((x) => x.fieldname === 'file');
      if (!f) throw new ApiError('BAD_REQUEST', '缺少上传文件字段 file');
      const raw = f.buffer;
      if (raw.length > IMPORT_LIMIT) {
        return err(res, 'PAYLOAD_TOO_LARGE', '备份文件超过 512MB 上限', 413);
      }
      let backup;
      try {
        backup = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new ApiError('BAD_REQUEST', '备份文件不是合法的 JSON');
      }
      if (!isPlainObject(backup)) throw new ApiError('BAD_REQUEST', '备份文件结构不合法');
      const missing = NEED_KEYS.filter((k) => !(k in backup));
      if (missing.length) {
        throw new ApiError('BAD_REQUEST', `备份缺少必要字段：${[...missing].sort().join(', ')}`);
      }
      const meta = backup.meta;
      const bv = isPlainObject(meta) ? meta.schema_version : undefined;
      const bvRepr = bv === undefined || bv === null ? 'None' : String(bv);
      if (bvRepr !== SCHEMA_VERSION) {
        return err(
          res,
          'VERSION_MISMATCH',
          `备份 schema_version=${bvRepr} 与当前库 ${SCHEMA_VERSION} 不一致，已取消导入`,
          400
        );
      }
      for (const t of LOAD_ORDER) {
        if (!Array.isArray(backup[t])) throw new ApiError('BAD_REQUEST', `备份中 ${t} 须为数组`);
        for (const row of backup[t]) {
          if (!isPlainObject(row)) throw new ApiError('BAD_REQUEST', `备份中 ${t} 的每行须为对象`);
        }
      }
      if (!isPlainObject(backup.photo_files)) throw new ApiError('BAD_REQUEST', '备份中 photo_files 须为对象');

      // 照片先全部解码到内存（校验合法性），通过后再统一落盘
      const decoded = {};
      for (const [fn, b64] of Object.entries(backup.photo_files)) {
        if (typeof b64 !== 'string' || !fn || path.basename(fn) !== fn || fn === '.' || fn === '..') {
          throw new ApiError('BAD_REQUEST', 'photo_files 内存在不合法的文件名或数据');
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
          throw new ApiError('BAD_REQUEST', 'photo_files 内存在不合法的 base64 数据');
        }
        decoded[fn] = Buffer.from(b64, 'base64');
      }

      const conn = req.db;
      const imported = {};
      try {
        conn.exec('BEGIN IMMEDIATE');
        try {
          for (const t of CLEAR_ORDER) conn.prepare(`DELETE FROM ${t}`).run();
          conn.prepare('DELETE FROM meta').run();
          conn.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(bvRepr);
          for (const t of LOAD_ORDER) {
            const cols = TABLE_COLS[t];
            const rows = backup[t].map((row) => cols.map((c) => bindVal(row[c])));
            if (rows.length) {
              const stmt = conn.prepare(
                `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
              );
              for (const values of rows) stmt.run(...values);
            }
            imported[t] = rows.length;
          }
          for (const [fn, blob] of Object.entries(decoded)) {
            fs.writeFileSync(path.join(uploadDir, fn), blob); // 覆盖同名
          }
          conn.exec('COMMIT');
        } catch (e) {
          try {
            conn.exec('ROLLBACK');
          } catch {
            /* 已自动回滚 */
          }
          throw e;
        }
      } catch (e) {
        if (isDataError(e)) {
          throw new ApiError('BAD_REQUEST', '备份文件数据不合法，导入已整体回滚，原库未改动');
        }
        throw e;
      }
      return ok(res, { imported });
    }
  );
}