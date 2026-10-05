// 模块-node-数据库-db.mjs
// SQLite 连接与建表（对照 app.py get_conn/SCHEMA_SQL/init_schema/seed_topics/init_db/
// purge_photos_of_story 及 BEGIN IMMEDIATE 事务约定）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeConfig, SCHEMA_VERSION } from './模块-node-配置-config.mjs';

// 建表 DDL（与 app.py SCHEMA_SQL 逐字一致：8 表 + 4 索引）
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);  -- schema_version = '1'

CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  relation     TEXT    NOT NULL,                     -- 称谓：爷爷/奶奶/爸爸/妈妈/我/自定义
  avatar_color TEXT    NOT NULL DEFAULT '#C0392B',   -- 头像底色
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT    NOT NULL,   -- 童年糗事|家人与宠爱|第一次|节日记忆|味道与物件|遗憾与心愿
  text       TEXT    NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS topic_followups (          -- N1 追问链
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  order_no INTEGER NOT NULL,
  text     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS draws (                     -- 抽题记录（不重复 + 轮换）
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  round_no  INTEGER NOT NULL DEFAULT 1,
  drawn_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL DEFAULT '',            -- 讲述正文
  story_date TEXT,                                   -- 故事发生日期，可空；格式 YYYY 或 YYYY-MM-DD（后端正则校验），时间轴取前 4 位分组
  followups  TEXT    NOT NULL DEFAULT '[]',          -- JSON: [{"q":"...","a":"..."}]（问题文本随答案快照，话题日后被改不影响历史）
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id      INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,                    -- uuid 重命名后文件名
  original_name TEXT    NOT NULL,
  caption       TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS time_capsules (             -- N3 时间胶囊
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,  -- 作者，可空；为空=家庭共享胶囊
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  open_date  TEXT    NOT NULL,                       -- YYYY-MM-DD，到期才可开启
  is_opened  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_draws_member_round ON draws(member_id, round_no);
CREATE INDEX IF NOT EXISTS idx_stories_member     ON stories(member_id);
CREATE INDEX IF NOT EXISTS idx_stories_topic      ON stories(topic_id);
CREATE INDEX IF NOT EXISTS idx_photos_story       ON photos(story_id);
`;

/**
 * 连接工厂（对照 app.py get_conn）：每连接必开 PRAGMA foreign_keys（否则级联静默失效）
 * + journal_mode=WAL（多线程并发写）+ 10s 锁超时。
 */
export function openDb(dbPath) {
  const conn = new DatabaseSync(dbPath, { timeout: 10000 });
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA busy_timeout = 10000');
  return conn;
}

/** 读取话题种子 JSON；缺失/不可解析返回 null（启动降级为空话题库，不阻断服务） */
export function loadTopicsSeed(topicsJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(topicsJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 话题种子导入（对照 seed_topics）：仅 topics 表为空时导入 48 条内置话题 + 追问 */
export function seedTopics(conn, topicsJsonPath) {
  const seed = loadTopicsSeed(topicsJsonPath);
  if (seed === null) {
    console.log(`[警告] 话题种子文件缺失或不可解析：${topicsJsonPath}`);
    return;
  }
  if (conn.prepare('SELECT COUNT(*) AS c FROM topics').get().c > 0) return;
  const insTopic = conn.prepare('INSERT INTO topics(category, text, is_builtin) VALUES (?, ?, 1)');
  const insFu = conn.prepare('INSERT INTO topic_followups(topic_id, order_no, text) VALUES (?, ?, ?)');
  for (const cat of seed.categories) {
    for (const t of cat.topics) {
      const r = insTopic.run(cat.name, t.text);
      const topicId = Number(r.lastInsertRowid);
      const fus = t.follow_ups || [];
      for (let i = 0; i < fus.length; i += 1) insFu.run(topicId, i + 1, fus[i]);
    }
  }
}

/**
 * 启动初始化（对照 init_db）：建目录 → 建表 → 写 schema_version → 导入种子。
 * node:sqlite 默认 autocommit，无需显式 commit（等价 Python conn.commit()）。
 */
export function initDb(options = {}) {
  const cfg = normalizeConfig(options);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(cfg.uploadDir, { recursive: true }); // 不预建首次上传会 500
  const conn = openDb(cfg.dbPath);
  try {
    conn.exec(SCHEMA_SQL);
    conn.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
    seedTopics(conn, cfg.topicsJsonPath);
  } finally {
    conn.close();
  }
}

/** 内置 6 分类固定顺序（回忆录 topic 视图组间排序依据） */
export function categoryOrderOf(topicsJsonPath) {
  const seed = loadTopicsSeed(topicsJsonPath);
  return seed ? seed.categories.map((c) => c.name) : [];
}

/**
 * 显式事务包装（对照 app.py 的 BEGIN IMMEDIATE / COMMIT / ROLLBACK）。
 * fn 收到 tx 控制对象；若 fn 内未显式 commit/rollback，则正常返回时自动 commit。
 */
export function withTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  let finished = false;
  const tx = {
    commit() {
      if (!finished) {
        db.exec('COMMIT');
        finished = true;
      }
    },
    rollback() {
      if (!finished) {
        db.exec('ROLLBACK');
        finished = true;
      }
    },
  };
  try {
    const result = fn(tx);
    if (!finished) tx.commit();
    return result;
  } catch (e) {
    if (!finished) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 事务可能已自动回滚 */
      }
    }
    throw e;
  }
}

/** 只删文件；photos 行由 ON DELETE CASCADE 处理；ENOENT 静默忽略（对照 purge_photos_of_story） */
export function purgePhotosOfStory(conn, uploadDir, storyId) {
  const rows = conn.prepare('SELECT filename FROM photos WHERE story_id=?').all(storyId);
  for (const p of rows) {
    try {
      fs.rmSync(path.join(uploadDir, p.filename));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

/** 导入绑定值转换（node:sqlite 拒收 undefined/布尔；对照任务书 42 条） */
export function bindVal(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}