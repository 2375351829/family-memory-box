# -*- coding: utf-8 -*-
"""
家庭回忆话题盒子 · 后端服务-app.py

技术栈：Flask 3.0 + Python 标准库 sqlite3（不用 ORM）+ waitress 生产服务器
运行方式：python 后端服务-app.py（直接执行；文件名含中文连字符，项目内不做模块间 import）
契约依据：《开发计划》§五（数据库 DDL 与连接约定）、§六（API 规格全表与 §6.1 响应示例）、§八（关键算法）

统一响应：成功 {"ok":true,"data":...}；失败 {"ok":false,"error":{"code":"...","message":"..."}}
错误码：BAD_REQUEST(400) / NOT_FOUND(404) / PAYLOAD_TOO_LARGE(413) / UNSUPPORTED_TYPE(415)
        / VERSION_MISMATCH(400) / INTERNAL(500)
"""

import base64
import datetime
import json
import os
import random
import re
import sqlite3
import uuid

from flask import Flask, g, request, send_from_directory
from waitress import serve
from werkzeug.exceptions import HTTPException

# ─────────────────────────── 路径与环境 ───────────────────────────
# 数据目录：容器内 A2 会设 DATA_DIR=/data；本地开发默认 ./data（已被 .gitignore 排除）
DATA_DIR = os.environ.get('DATA_DIR', './data')
DB_PATH = os.path.join(DATA_DIR, 'family_memory.db')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
# 话题种子与 app.py 同目录（纯数据 JSON，文件名含连字符不可 import，只能运行时读取）
TOPICS_JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '数据-话题库-topics.json')

SCHEMA_VERSION = '1'

# 请求体上限：普通接口 16MB（全局兜底 + before_request 拦截）；
# 导入接口单独 512MB（备份含照片 base64，十几张就超 16MB，共用会在最需要时被拦）
BODY_LIMIT = 16 * 1024 * 1024
IMPORT_LIMIT = 512 * 1024 * 1024

# 上传照片：白名单扩展名 + 单文件大小上限（前端 canvas 已预压缩，服务端只做校验兜底）
PHOTO_EXTS = {'jpg', 'jpeg', 'png', 'webp', 'gif'}
PHOTO_MAX_SIZE = 10 * 1024 * 1024

# ─────────────────────────── 话题种子加载 ───────────────────────────
def _load_topics_json():
    """读取话题种子 JSON；文件缺失时返回 None（启动降级为空话题库，不阻断服务）"""
    try:
        with open(TOPICS_JSON_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


TOPICS_SEED = _load_topics_json()
# 内置 6 分类固定顺序（回忆录 topic 视图的组间排序依据）
CATEGORY_ORDER = [c['name'] for c in TOPICS_SEED['categories']] if TOPICS_SEED else []

# ─────────────────────────── Flask 应用 ───────────────────────────
app = Flask(__name__)
# 响应 JSON 不转义中文（Content-Type 由统一响应函数显式指定带 charset）
app.json.ensure_ascii = False
# 全局请求体兜底上限（512MB = 导入接口的独立上限；普通接口 16MB 在 before_request 拦截）
app.config['MAX_CONTENT_LENGTH'] = IMPORT_LIMIT


class ApiError(Exception):
    """业务类异常：统一转为 {"ok":false,"error":{...}} 响应"""

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class PoolEmptyError(Exception):
    """8.1 抽题算法：候选池为空（如按分类过滤后该分类无题可抽）"""


# ─────────────────────────── 数据库连接（§5.0 强制约定） ───────────────────────────
def get_conn():
    """全项目唯一 sqlite3.connect 入口。
    PRAGMA foreign_keys 是连接级设置，必须每连接开启，否则 ON DELETE CASCADE 静默失效；
    WAL 支撑 waitress 多线程并发写，避免 database is locked。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")   # 每连接必开，否则级联删除失效
    conn.execute("PRAGMA journal_mode = WAL")  # 多线程并发写，避免 database is locked
    return conn


def req_conn():
    """每请求一个连接（复用 get_conn），请求结束时由 teardown 统一关闭"""
    if 'conn' not in g:
        g.conn = get_conn()
    return g.conn


@app.teardown_appcontext
def _close_conn(exc):
    """请求结束关闭连接；未提交的事务由 sqlite3 自动回滚"""
    conn = g.pop('conn', None)
    if conn is not None:
        conn.close()


# ─────────────────────────── 建表 DDL（§五原样） ───────────────────────────
SCHEMA_SQL = """
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
"""


def init_schema(conn):
    """在建库连接上执行完整 DDL（幂等，IF NOT EXISTS）"""
    conn.executescript(SCHEMA_SQL)


def seed_topics(conn):
    """topics 表为空时从 数据-话题库-topics.json 导入 48 条内置话题 + 96 条追问"""
    if TOPICS_SEED is None:
        print(f'[警告] 话题种子文件缺失或不可解析：{TOPICS_JSON_PATH}')
        return
    if conn.execute("SELECT COUNT(*) AS c FROM topics").fetchone()['c'] > 0:
        return  # 已有数据（含自定义话题），不重复导入
    for cat in TOPICS_SEED['categories']:
        for t in cat['topics']:
            cur = conn.execute(
                "INSERT INTO topics(category, text, is_builtin) VALUES (?, ?, 1)",
                (cat['name'], t['text']))
            topic_id = cur.lastrowid
            for order_no, fu in enumerate(t.get('follow_ups', []), start=1):
                conn.execute(
                    "INSERT INTO topic_followups(topic_id, order_no, text) VALUES (?, ?, ?)",
                    (topic_id, order_no, fu))


def init_db():
    """启动初始化：建表 → 写 schema_version → 导入种子 → 预建上传目录"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)  # 不预建的话首次上传会直接 500
    conn = get_conn()
    try:
        init_schema(conn)
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,))
        seed_topics(conn)
        conn.commit()
    finally:
        conn.close()


def purge_photos_of_story(conn, story_id):
    """只删文件；photos 行由 ON DELETE CASCADE 处理。FileNotFoundError 静默忽略。
    「删成员 / 删话题 / 删故事」三条路径都必须调用，否则残留孤儿文件。"""
    for p in conn.execute("SELECT filename FROM photos WHERE story_id=?", (story_id,)):
        try:
            os.remove(os.path.join(UPLOAD_DIR, p["filename"]))
        except FileNotFoundError:
            pass


# ─────────────────────────── 统一响应与错误处理 ───────────────────────────
def jresp(payload, status=200):
    """统一 JSON 响应：Content-Type 带 charset，中文不转义"""
    return app.response_class(
        json.dumps(payload, ensure_ascii=False) + "\n",
        status=status,
        content_type="application/json; charset=utf-8")


def ok(data, status=200):
    return jresp({"ok": True, "data": data}, status)


def err(code, message, status=400):
    return jresp({"ok": False, "error": {"code": code, "message": message}}, status)


# HTTPException 状态码 → 错误码表映射（Flask/werkzeug 抛出的框架级错误）
_HTTP_CODE_MAP = {
    400: 'BAD_REQUEST',
    404: 'NOT_FOUND',
    405: 'BAD_REQUEST',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_TYPE',
}


@app.errorhandler(ApiError)
def _handle_api_error(e):
    return err(e.code, e.message, e.status)


@app.errorhandler(HTTPException)
def _handle_http_exception(e):
    code = _HTTP_CODE_MAP.get(e.code, 'INTERNAL')
    return err(code, e.description or e.name, e.code or 500)


@app.errorhandler(Exception)
def _handle_unexpected(e):
    # 事务内任何异常已由调用点 ROLLBACK；这里只兜底，message 不暴露堆栈
    app.logger.exception('未处理异常：%s', e)
    return err('INTERNAL', '服务器内部错误', 500)


@app.before_request
def _limit_body_size():
    """普通接口统一 16MB 上限；导入接口（/api/import/json）豁免，路由内自查 512MB"""
    if request.path == '/api/import/json':
        return None
    if request.content_length and request.content_length > BODY_LIMIT:
        return err('PAYLOAD_TOO_LARGE', '请求体超过 16MB 上限', 413)
    return None


# ─────────────────────────── 通用校验与序列化辅助 ───────────────────────────
def _json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError('BAD_REQUEST', '请求体须为 JSON 对象')
    return data


def _clean_str(v):
    """去空白；非字符串返回 None"""
    return v.strip() if isinstance(v, str) else None


def _member_dict(row):
    """§6.1 Member 响应对象"""
    return {
        'id': row['id'],
        'name': row['name'],
        'relation': row['relation'],
        'avatar_color': row['avatar_color'],
        'sort_order': row['sort_order'],
        'created_at': row['created_at'],
    }


def _topic_dict(conn, row):
    """§6.1 Topic 响应对象（含追问链 follow_ups，按 order_no 排序）"""
    follow_ups = [r['text'] for r in conn.execute(
        "SELECT text FROM topic_followups WHERE topic_id=? ORDER BY order_no", (row['id'],))]
    return {
        'id': row['id'],
        'category': row['category'],
        'text': row['text'],
        'is_builtin': row['is_builtin'],
        'follow_ups': follow_ups,
    }


# Story 对外字段（§6.1 契约冻结，不得增删）
STORY_PUBLIC_KEYS = ['id', 'topic_id', 'member_id', 'topic_text', 'relation', 'name',
                     'content', 'story_date', 'followups', 'photos', 'created_at', 'updated_at']


def _public_story(d):
    """把内部故事 dict（含分组用的内部字段）裁剪为 §6.1 契约字段，并解析 followups JSON"""
    out = {k: d[k] for k in STORY_PUBLIC_KEYS if k in d}
    try:
        fu = json.loads(d.get('followups') or '[]')
        out['followups'] = fu if isinstance(fu, list) else []
    except (ValueError, TypeError):
        out['followups'] = []
    return out


def _stories_full(conn, where_sql='', params=()):
    """查询故事全量视图：JOIN 话题/成员 + 附带照片列表；
    额外携带 topic_category / member_sort_order 内部字段（分组用，输出前由 _public_story 裁剪）"""
    rows = conn.execute(
        f"""SELECT s.*,
                   t.text AS topic_text, t.category AS topic_category,
                   m.name AS name, m.relation AS relation, m.sort_order AS member_sort_order
            FROM stories s
            JOIN topics t  ON t.id = s.topic_id
            JOIN members m ON m.id = s.member_id
            {where_sql}
            ORDER BY s.created_at DESC, s.id DESC""", params).fetchall()
    photos_by_story = {}
    for p in conn.execute("SELECT * FROM photos ORDER BY id"):
        photos_by_story.setdefault(p['story_id'], []).append(dict(p))
    out = []
    for r in rows:
        d = dict(r)
        d['photos'] = photos_by_story.get(r['id'], [])
        out.append(d)
    return out


def _story_by_id(conn, story_id):
    rows = _stories_full(conn, "WHERE s.id=?", (story_id,))
    return rows[0] if rows else None


# 备份导入导出用的表列清单（列名白名单，防注入）
TABLE_COLS = {
    'members': ['id', 'name', 'relation', 'avatar_color', 'sort_order', 'created_at'],
    'topics': ['id', 'category', 'text', 'is_builtin', 'created_at'],
    'topic_followups': ['id', 'topic_id', 'order_no', 'text'],
    'draws': ['id', 'member_id', 'topic_id', 'round_no', 'drawn_at'],
    'stories': ['id', 'topic_id', 'member_id', 'content', 'story_date',
                'followups', 'created_at', 'updated_at'],
    'photos': ['id', 'story_id', 'filename', 'original_name', 'caption', 'created_at'],
    'time_capsules': ['id', 'member_id', 'title', 'content', 'open_date',
                      'is_opened', 'created_at'],
}
# 清空/重灌顺序：先删子表再删父表，满足外键约束
CLEAR_ORDER = ['photos', 'stories', 'draws', 'topic_followups', 'topics', 'members', 'time_capsules']
LOAD_ORDER = ['members', 'topics', 'topic_followups', 'draws', 'stories', 'photos', 'time_capsules']


# ─────────────────────────── 8.1 抽题算法（纯函数，可独立测试） ───────────────────────────
def _candidate_pool(conn, category, member_id, round_no):
    """候选池 = 全部话题（或指定分类）- 该成员该轮已抽话题"""
    used = {r['topic_id'] for r in conn.execute(
        "SELECT topic_id FROM draws WHERE member_id=? AND round_no=?", (member_id, round_no))}
    if category:
        rows = conn.execute("SELECT * FROM topics WHERE category=?", (category,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM topics").fetchall()
    return [r for r in rows if r['id'] not in used]


def draw_topic(conn, member_id, category=None):
    """8.1 抽题算法步骤 1–7：BEGIN IMMEDIATE → 查当前轮 → 排除已抽 → 空池进下一轮
    → random.choice → INSERT draws → COMMIT。
    返回 (topic_dict, round_no, is_new_round)；候选池为空抛 PoolEmptyError；
    任何异常统一 ROLLBACK，保证连接状态干净（commit 或 rollback 二选一）。"""
    try:
        conn.execute("BEGIN IMMEDIATE")
        # 步骤 1：当前轮 = 该成员最大轮次（无记录则第 1 轮）
        row = conn.execute(
            "SELECT MAX(round_no) AS m FROM draws WHERE member_id=?", (member_id,)).fetchone()
        round_no = row['m'] or 1
        is_new_round = False
        # 步骤 2–4：候选池（分类过滤后排除已抽）
        pool = _candidate_pool(conn, category, member_id, round_no)
        # 步骤 5：本轮抽完 → 轮次 +1，重建候选池
        if not pool:
            round_no += 1
            is_new_round = True
            pool = _candidate_pool(conn, category, member_id, round_no)
        if not pool:
            raise PoolEmptyError('候选池为空（分类无话题或全部已抽且无法进入下一轮）')
        # 步骤 6：随机抽一题
        topic_row = random.choice(pool)
        # 步骤 7：写入抽题记录
        conn.execute(
            "INSERT INTO draws(member_id, topic_id, round_no) VALUES (?, ?, ?)",
            (member_id, topic_row['id'], round_no))
        conn.commit()
        # 步骤 8：返回（话题附 follow_ups）
        return _topic_dict(conn, topic_row), round_no, is_new_round
    except Exception:
        conn.rollback()
        raise


# ─────────────────────────── #1 健康检查 ───────────────────────────
@app.get('/api/health')
def api_health():
    """Docker healthcheck 端点：只读、无副作用"""
    conn = req_conn()
    sv = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    counts = {
        'members': conn.execute("SELECT COUNT(*) AS c FROM members").fetchone()['c'],
        'topics': conn.execute("SELECT COUNT(*) AS c FROM topics").fetchone()['c'],
        'stories': conn.execute("SELECT COUNT(*) AS c FROM stories").fetchone()['c'],
        'photos': conn.execute("SELECT COUNT(*) AS c FROM photos").fetchone()['c'],
        'capsules': conn.execute("SELECT COUNT(*) AS c FROM time_capsules").fetchone()['c'],
    }
    return ok({'status': 'ok',
               'schema_version': sv['value'] if sv else SCHEMA_VERSION,
               'counts': counts})


# ─────────────────────────── #2 全量状态 ───────────────────────────
@app.get('/api/state')
def api_state():
    """前端启动一次性拉全量：members / topics / followups / stories / photos / capsules"""
    conn = req_conn()
    members = [_member_dict(r) for r in
               conn.execute("SELECT * FROM members ORDER BY sort_order, id")]
    topics = [_topic_dict(conn, r) for r in
              conn.execute("SELECT * FROM topics ORDER BY id")]
    # followups：以话题 id 为键的追问数组 Map（键为字符串，便于前端对象索引）
    followups = {}
    for r in conn.execute(
            "SELECT topic_id, text FROM topic_followups ORDER BY topic_id, order_no"):
        followups.setdefault(str(r['topic_id']), []).append(r['text'])
    stories = [_public_story(d) for d in _stories_full(conn)]
    photos = [dict(p) for p in conn.execute("SELECT * FROM photos ORDER BY id")]
    capsules = [dict(r) for r in conn.execute(
        "SELECT * FROM time_capsules ORDER BY created_at DESC, id DESC")]
    return ok({'members': members, 'topics': topics, 'followups': followups,
               'stories': stories, 'photos': photos, 'capsules': capsules})


# ─────────────────────────── #3–#6 家庭成员 ───────────────────────────
def _validate_member_fields(payload, partial):
    """校验 members 请求字段：name 1..20 字、relation 1..10 字（去空白，重名允许）；
    partial=True 时仅校验出现的字段（PUT），否则 name/relation 必填（POST）"""
    out = {}
    if not partial or 'name' in payload:
        name = _clean_str(payload.get('name')) or ''
        if not (1 <= len(name) <= 20):
            raise ApiError('BAD_REQUEST', 'name 长度须为 1–20')
        out['name'] = name
    if not partial or 'relation' in payload:
        relation = _clean_str(payload.get('relation')) or ''
        if not (1 <= len(relation) <= 10):
            raise ApiError('BAD_REQUEST', 'relation 长度须为 1–10')
        out['relation'] = relation
    if 'avatar_color' in payload:
        color = _clean_str(payload.get('avatar_color'))
        out['avatar_color'] = color or '#C0392B'
    return out


@app.get('/api/members')
def api_members_list():
    conn = req_conn()
    rows = conn.execute("SELECT * FROM members ORDER BY sort_order, id").fetchall()
    return ok([_member_dict(r) for r in rows])


@app.post('/api/members')
def api_members_create():
    payload = _json_body()
    fields = _validate_member_fields(payload, partial=False)
    conn = req_conn()
    cols = list(fields.keys())
    cur = conn.execute(
        f"INSERT INTO members ({', '.join(cols)}) VALUES ({', '.join(['?'] * len(cols))})",
        tuple(fields.values()))
    conn.commit()
    row = conn.execute("SELECT * FROM members WHERE id=?", (cur.lastrowid,)).fetchone()
    return ok(_member_dict(row))


@app.put('/api/members/<int:member_id>')
def api_members_update(member_id):
    payload = _json_body()
    fields = _validate_member_fields(payload, partial=True)
    if not fields:
        raise ApiError('BAD_REQUEST', '无可更新字段')
    conn = req_conn()
    if not conn.execute("SELECT 1 FROM members WHERE id=?", (member_id,)).fetchone():
        return err('NOT_FOUND', f'member_id={member_id} 不存在', 404)
    sets = ', '.join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE members SET {sets} WHERE id=?", (*fields.values(), member_id))
    conn.commit()
    row = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
    return ok(_member_dict(row))


@app.delete('/api/members/<int:member_id>')
def api_members_delete(member_id):
    conn = req_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM members WHERE id=?", (member_id,)).fetchone():
            conn.rollback()
            return err('NOT_FOUND', f'member_id={member_id} 不存在', 404)
        # 先查出该成员全部故事，逐个清理照片文件（此时 photos 行尚未被级联删除，查询可得文件名）
        story_ids = [r['id'] for r in conn.execute(
            "SELECT id FROM stories WHERE member_id=?", (member_id,))]
        for sid in story_ids:
            purge_photos_of_story(conn, sid)
        # 行级联：stories / draws / photos 行由 FK ON DELETE CASCADE 清除
        conn.execute("DELETE FROM members WHERE id=?", (member_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return ok({'deleted': 1})


# ─────────────────────────── #7–#9 话题 ───────────────────────────
@app.get('/api/topics')
def api_topics_list():
    conn = req_conn()
    category = request.args.get('category')
    if category:
        rows = conn.execute("SELECT * FROM topics WHERE category=? ORDER BY id",
                            (category,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM topics ORDER BY id").fetchall()
    return ok([_topic_dict(conn, r) for r in rows])


@app.post('/api/topics')
def api_topics_create():
    payload = _json_body()
    category = _clean_str(payload.get('category'))
    if not category:
        raise ApiError('BAD_REQUEST', 'category 必填')
    text = _clean_str(payload.get('text'))
    if text is None or not (1 <= len(text) <= 60):
        raise ApiError('BAD_REQUEST', 'text 长度须为 1–60')
    follow_ups = payload.get('follow_ups')
    if follow_ups is None:
        fu_list = []
    elif isinstance(follow_ups, list) and all(isinstance(x, str) for x in follow_ups):
        fu_list = [x.strip() for x in follow_ups if x.strip()]
    else:
        raise ApiError('BAD_REQUEST', 'follow_ups 须为字符串数组')
    conn = req_conn()
    cur = conn.execute("INSERT INTO topics(category, text, is_builtin) VALUES (?, ?, 0)",
                       (category, text))
    topic_id = cur.lastrowid
    for order_no, fu in enumerate(fu_list, start=1):
        conn.execute("INSERT INTO topic_followups(topic_id, order_no, text) VALUES (?, ?, ?)",
                     (topic_id, order_no, fu))
    conn.commit()
    row = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    return ok(_topic_dict(conn, row))


@app.delete('/api/topics/<int:topic_id>')
def api_topics_delete(topic_id):
    conn = req_conn()
    row = conn.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
    if not row:
        return err('NOT_FOUND', f'topic_id={topic_id} 不存在', 404)
    if row['is_builtin']:
        return err('BAD_REQUEST', '内置话题不可删除', 400)
    try:
        conn.execute("BEGIN IMMEDIATE")
        # 先查出该话题下全部故事，逐个清理照片文件（此时 photos 行尚未被级联删除）
        story_ids = [r['id'] for r in conn.execute(
            "SELECT id FROM stories WHERE topic_id=?", (topic_id,))]
        for sid in story_ids:
            purge_photos_of_story(conn, sid)
        # 行级联：topic_followups / draws / stories / photos 行由 FK 清除
        conn.execute("DELETE FROM topics WHERE id=?", (topic_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return ok({'deleted': 1})


# ─────────────────────────── #10 抽题 ───────────────────────────
@app.post('/api/draw')
def api_draw():
    payload = _json_body()
    member_id = payload.get('member_id')
    if not isinstance(member_id, int):
        raise ApiError('BAD_REQUEST', 'member_id 必填且须为整数')
    category = _clean_str(payload.get('category'))
    conn = req_conn()
    if not conn.execute("SELECT 1 FROM members WHERE id=?", (member_id,)).fetchone():
        return err('NOT_FOUND', f'member_id={member_id} 不存在', 404)
    try:
        topic, round_no, is_new_round = draw_topic(conn, member_id, category)
    except PoolEmptyError:
        return err('BAD_REQUEST', '该分类下暂无可抽的话题', 400)
    return ok({'topic': topic, 'round_no': round_no, 'is_new_round': is_new_round})


# ─────────────────────────── #11–#13 故事 ───────────────────────────
STORY_DATE_RE = re.compile(r'^(\d{4}|\d{4}-\d{2}-\d{2})$')


def _validate_story_fields(payload, conn, is_create):
    """校验 stories 请求字段；is_create=True 时 topic_id/member_id/content 必填。
    content 去空白允许空串占位；story_date 正则校验；followups 序列化为 JSON 字符串存储。"""
    out = {}
    if is_create or 'topic_id' in payload:
        tid = payload.get('topic_id')
        if not isinstance(tid, int) or not conn.execute(
                "SELECT 1 FROM topics WHERE id=?", (tid,)).fetchone():
            raise ApiError('NOT_FOUND', f'topic_id={tid} 不存在', 404)
        out['topic_id'] = tid
    if is_create or 'member_id' in payload:
        mid = payload.get('member_id')
        if not isinstance(mid, int) or not conn.execute(
                "SELECT 1 FROM members WHERE id=?", (mid,)).fetchone():
            raise ApiError('NOT_FOUND', f'member_id={mid} 不存在', 404)
        out['member_id'] = mid
    if is_create or 'content' in payload:
        content = payload.get('content')
        if content is None and is_create:
            raise ApiError('BAD_REQUEST', 'content 必填（可为空串占位）')
        out['content'] = content.strip() if isinstance(content, str) else ''
    if 'story_date' in payload or (is_create and payload.get('story_date') is not None):
        sd = payload.get('story_date')
        if sd is None or (isinstance(sd, str) and not sd.strip()):
            out['story_date'] = None
        elif isinstance(sd, str) and STORY_DATE_RE.match(sd.strip()):
            out['story_date'] = sd.strip()
        else:
            raise ApiError('BAD_REQUEST', 'story_date 格式须为 YYYY 或 YYYY-MM-DD')
    if 'followups' in payload or (is_create and payload.get('followups') is not None):
        fu = payload.get('followups')
        if fu is None:
            out['followups'] = '[]'
        else:
            if not isinstance(fu, list):
                raise ApiError('BAD_REQUEST', 'followups 须为 [{"q":...,"a":...}] 数组')
            cleaned = []
            for item in fu:
                if not isinstance(item, dict) or not isinstance(item.get('q'), str):
                    raise ApiError('BAD_REQUEST', 'followups 每项须为含 q/a 字符串的对象')
                cleaned.append({'q': item['q'], 'a': item.get('a') if isinstance(item.get('a'), str) else ''})
            out['followups'] = json.dumps(cleaned, ensure_ascii=False)
    return out


@app.post('/api/stories')
def api_stories_create():
    payload = _json_body()
    conn = req_conn()
    fields = _validate_story_fields(payload, conn, is_create=True)
    cur = conn.execute(
        """INSERT INTO stories(topic_id, member_id, content, story_date, followups)
           VALUES (?, ?, ?, ?, ?)""",
        (fields['topic_id'], fields['member_id'], fields['content'],
         fields.get('story_date'), fields.get('followups', '[]')))
    conn.commit()
    return ok(_public_story(_story_by_id(conn, cur.lastrowid)))


@app.put('/api/stories/<int:story_id>')
def api_stories_update(story_id):
    payload = _json_body()
    conn = req_conn()
    if not conn.execute("SELECT 1 FROM stories WHERE id=?", (story_id,)).fetchone():
        return err('NOT_FOUND', f'story_id={story_id} 不存在', 404)
    fields = _validate_story_fields(payload, conn, is_create=False)
    if not fields:
        raise ApiError('BAD_REQUEST', '无可更新字段')
    sets = ', '.join(f"{k}=?" for k in fields)
    # PUT 自动更新 updated_at
    conn.execute(f"UPDATE stories SET {sets}, updated_at = datetime('now','localtime') WHERE id=?",
                 (*fields.values(), story_id))
    conn.commit()
    return ok(_public_story(_story_by_id(conn, story_id)))


@app.delete('/api/stories/<int:story_id>')
def api_stories_delete(story_id):
    conn = req_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM stories WHERE id=?", (story_id,)).fetchone():
            conn.rollback()
            return err('NOT_FOUND', f'story_id={story_id} 不存在', 404)
        # DELETE 前调用统一清理函数：只删照片文件（photos 行由 ON DELETE CASCADE 处理）
        purge_photos_of_story(conn, story_id)
        conn.execute("DELETE FROM stories WHERE id=?", (story_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return ok({'deleted': 1})


# ─────────────────────────── #14–#16 照片 ───────────────────────────
def _magic_ok(ext, head):
    """魔数校验：读文件前 12 字节与扩展名比对（防伪装扩展名）"""
    if ext in ('jpg', 'jpeg'):
        return head[:3] == b'\xff\xd8\xff'
    if ext == 'png':
        return head[:8] == b'\x89PNG\r\n\x1a\n'
    if ext == 'gif':
        return head[:6] in (b'GIF87a', b'GIF89a')
    if ext == 'webp':
        return head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    return False


@app.post('/api/stories/<int:story_id>/photos')
def api_photos_upload(story_id):
    conn = req_conn()
    if not conn.execute("SELECT 1 FROM stories WHERE id=?", (story_id,)).fetchone():
        return err('NOT_FOUND', f'story_id={story_id} 不存在', 404)
    files = request.files.getlist('files[]')
    if not files:
        raise ApiError('BAD_REQUEST', '缺少上传文件字段 files[]')
    caption = (request.form.get('caption') or '').strip()
    # 第一遍：逐文件校验（大小 → 扩展名 → 魔数），任一失败整体拒绝，不留半截数据
    validated = []
    for f in files:
        f.stream.seek(0, os.SEEK_END)
        size = f.stream.tell()
        f.stream.seek(0)
        if size > PHOTO_MAX_SIZE:
            return err('PAYLOAD_TOO_LARGE', f'文件 {f.filename} 超过 10MB 上限', 413)
        orig = f.filename or ''
        ext = orig.rsplit('.', 1)[-1].lower() if '.' in orig else ''
        if ext not in PHOTO_EXTS:
            return err('UNSUPPORTED_TYPE', f'文件 {orig} 的扩展名不在白名单（jpg/jpeg/png/webp/gif）', 415)
        head = f.stream.read(12)
        f.stream.seek(0)
        if not _magic_ok(ext, head):
            return err('UNSUPPORTED_TYPE', f'文件 {orig} 的内容与扩展名不符（疑似伪装文件）', 415)
        validated.append((f, ext))
    # 第二遍：全部校验通过后再落盘 + 写库（文件名 uuid 重写，防穿越/乱码/重名）
    saved_ids = []
    for f, ext in validated:
        new_name = uuid.uuid4().hex + '.' + ext
        f.save(os.path.join(UPLOAD_DIR, new_name))
        cur = conn.execute(
            """INSERT INTO photos(story_id, filename, original_name, caption)
               VALUES (?, ?, ?, ?)""",
            (story_id, new_name, f.filename or '', caption))
        saved_ids.append(cur.lastrowid)
    conn.commit()
    rows = [dict(conn.execute("SELECT * FROM photos WHERE id=?", (pid,)).fetchone())
            for pid in saved_ids]
    return ok(rows)


@app.delete('/api/photos/<int:photo_id>')
def api_photos_delete(photo_id):
    conn = req_conn()
    row = conn.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if not row:
        return err('NOT_FOUND', f'photo_id={photo_id} 不存在', 404)
    conn.execute("DELETE FROM photos WHERE id=?", (photo_id,))
    conn.commit()
    try:
        os.remove(os.path.join(UPLOAD_DIR, row['filename']))
    except FileNotFoundError:
        pass
    return ok({'deleted': 1})


@app.get('/uploads/<filename>')
def api_uploads(filename):
    """照片静态访问：send_from_directory 自带路径穿越防护"""
    return send_from_directory(UPLOAD_DIR, filename)


# ─────────────────────────── #17 回忆录三视图（8.2） ───────────────────────────
def _group(key, label, items):
    """8.2 分组结构：{key, label, meta:{count, photoCount}, items:[Story]}"""
    return {
        'key': str(key),
        'label': label,
        'meta': {'count': len(items),
                 'photoCount': sum(len(s['photos']) for s in items)},
        'items': [_public_story(s) for s in items],
    }


def _sort_by_created_desc(items):
    """组内统一按 created_at 降序（同秒再按 id 降序，保证稳定）"""
    return sorted(items, key=lambda s: (s['created_at'], s['id']), reverse=True)


@app.get('/api/memoir')
def api_memoir():
    view = request.args.get('view', 'timeline')
    if view not in ('timeline', 'member', 'topic'):
        raise ApiError('BAD_REQUEST', 'view 须为 timeline / member / topic 之一')
    conn = req_conn()
    stories = _stories_full(conn)
    groups = []
    if view == 'timeline':
        # 分组键 = story_date 年份；无 story_date 归「年份未详」；年份升序，未详组置末
        by_year = {}
        for s in stories:
            key = s['story_date'][:4] if s['story_date'] else '年份未详'
            by_year.setdefault(key, []).append(s)

        def year_sort_key(k):
            return (1, 0) if k == '年份未详' else (0, int(k))

        for key in sorted(by_year, key=year_sort_key):
            groups.append(_group(key, key, _sort_by_created_desc(by_year[key])))
    elif view == 'member':
        # 组按成员 sort_order 升序（同值按 id），组内 created_at 降序；成员已删则该组不出现
        by_member = {}
        for s in stories:
            by_member.setdefault(s['member_id'], []).append(s)
        for mid in sorted(by_member,
                          key=lambda x: (by_member[x][0]['member_sort_order'], x)):
            items = by_member[mid]
            groups.append(_group(mid, items[0]['name'], _sort_by_created_desc(items)))
    else:  # topic
        # 组按分类固定顺序（内置 6 分类，未知分类排后），组内 created_at 降序
        by_topic = {}
        for s in stories:
            by_topic.setdefault(s['topic_id'], []).append(s)
        cat_rank = {name: i for i, name in enumerate(CATEGORY_ORDER)}
        for tid in sorted(by_topic,
                          key=lambda x: (cat_rank.get(by_topic[x][0]['topic_category'], len(CATEGORY_ORDER)), x)):
            items = by_topic[tid]
            label = f"{items[0]['topic_category']} · {items[0]['topic_text']}"
            groups.append(_group(tid, label, _sort_by_created_desc(items)))
    return ok({'groups': groups})


# ─────────────────────────── #18 JSON 备份导出 ───────────────────────────
@app.get('/api/export/json')
def api_export_json():
    """全量备份：meta + 7 张业务表 + 照片 base64（?with_photos=0 排除照片）"""
    with_photos = request.args.get('with_photos', '1') != '0'
    conn = req_conn()
    sv = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    payload = {
        'meta': {'schema_version': sv['value'] if sv else SCHEMA_VERSION,
                 'exported_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')},
        'members': [dict(r) for r in conn.execute("SELECT * FROM members ORDER BY id")],
        'topics': [dict(r) for r in conn.execute("SELECT * FROM topics ORDER BY id")],
        'topic_followups': [dict(r) for r in conn.execute("SELECT * FROM topic_followups ORDER BY id")],
        'draws': [dict(r) for r in conn.execute("SELECT * FROM draws ORDER BY id")],
        'stories': [dict(r) for r in conn.execute("SELECT * FROM stories ORDER BY id")],
        'photos': [dict(r) for r in conn.execute("SELECT * FROM photos ORDER BY id")],
        'time_capsules': [dict(r) for r in conn.execute("SELECT * FROM time_capsules ORDER BY id")],
        'photo_files': {},
    }
    if with_photos:
        for p in conn.execute("SELECT filename FROM photos"):
            try:
                with open(os.path.join(UPLOAD_DIR, p['filename']), 'rb') as fh:
                    payload['photo_files'][p['filename']] = base64.b64encode(fh.read()).decode('ascii')
            except FileNotFoundError:
                pass  # 文件缺失不阻断导出（库中有行、磁盘无文件的场景）
    body = json.dumps(payload, ensure_ascii=False)
    resp = app.response_class(body, content_type='application/json; charset=utf-8')
    filename = f'family-memory-backup-{datetime.date.today():%Y%m%d}.json'
    resp.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


# ─────────────────────────── #19 JSON 备份导入（覆盖式，危险操作） ───────────────────────────
@app.post('/api/import/json')
def api_import_json():
    # 导入接口独立 512MB 上限，不与全局 MAX_CONTENT_LENGTH 共用（在路由内自查）
    if request.content_length and request.content_length > IMPORT_LIMIT:
        return err('PAYLOAD_TOO_LARGE', '备份文件超过 512MB 上限', 413)
    f = request.files.get('file')
    if f is None:
        raise ApiError('BAD_REQUEST', '缺少上传文件字段 file')
    raw = f.read()
    if len(raw) > IMPORT_LIMIT:
        return err('PAYLOAD_TOO_LARGE', '备份文件超过 512MB 上限', 413)
    try:
        backup = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        raise ApiError('BAD_REQUEST', '备份文件不是合法的 JSON')
    if not isinstance(backup, dict):
        raise ApiError('BAD_REQUEST', '备份文件结构不合法')
    need_keys = {'meta', 'members', 'topics', 'topic_followups', 'draws',
                 'stories', 'photos', 'time_capsules', 'photo_files'}
    missing = need_keys - set(backup.keys())
    if missing:
        raise ApiError('BAD_REQUEST', f'备份缺少必要字段：{", ".join(sorted(missing))}')
    # 版本校验：不一致直接拒绝（VERSION_MISMATCH），原库不动
    backup_version = backup['meta'].get('schema_version') if isinstance(backup['meta'], dict) else None
    if str(backup_version) != SCHEMA_VERSION:
        return err('VERSION_MISMATCH',
                   f'备份 schema_version={backup_version} 与当前库 {SCHEMA_VERSION} 不一致，已取消导入', 400)
    for t in LOAD_ORDER:
        if not isinstance(backup[t], list):
            raise ApiError('BAD_REQUEST', f'备份中 {t} 须为数组')
        for row in backup[t]:
            if not isinstance(row, dict):
                raise ApiError('BAD_REQUEST', f'备份中 {t} 的每行须为对象')
    if not isinstance(backup['photo_files'], dict):
        raise ApiError('BAD_REQUEST', '备份中 photo_files 须为对象')
    # 照片先全部解码到内存（校验合法性），通过后再统一落盘，避免写一半失败
    decoded = {}
    for fn, b64 in backup['photo_files'].items():
        if (not isinstance(b64, str) or not fn or os.path.basename(fn) != fn
                or fn in ('.', '..')):
            raise ApiError('BAD_REQUEST', 'photo_files 内存在不合法的文件名或数据')
        try:
            decoded[fn] = base64.b64decode(b64)
        except (ValueError, TypeError):
            raise ApiError('BAD_REQUEST', 'photo_files 内存在不合法的 base64 数据')
    conn = req_conn()
    imported = {}
    try:
        # 覆盖式导入整体包在 BEGIN IMMEDIATE 中：任一步失败回滚，原库原样
        conn.execute("BEGIN IMMEDIATE")
        for t in CLEAR_ORDER:
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM meta")
        conn.execute("INSERT INTO meta(key, value) VALUES ('schema_version', ?)",
                     (str(backup_version),))
        for t in LOAD_ORDER:
            cols = TABLE_COLS[t]
            rows = [tuple(row.get(c) for c in cols) for row in backup[t]]
            if rows:
                conn.executemany(
                    f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join(['?'] * len(cols))})",
                    rows)
            imported[t] = len(rows)
        for fn, blob in decoded.items():
            with open(os.path.join(UPLOAD_DIR, fn), 'wb') as fh:  # 覆盖同名
                fh.write(blob)
        conn.commit()
    except (sqlite3.Error, ValueError, KeyError, TypeError):
        conn.rollback()
        raise ApiError('BAD_REQUEST', '备份文件数据不合法，导入已整体回滚，原库未改动')
    except Exception:
        conn.rollback()
        raise
    return ok({'imported': imported})


# ─────────────────────────── #20–#22 时间胶囊（N3 / F17） ───────────────────────────
CAPSULE_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


@app.get('/api/capsules')
def api_capsules_list():
    conn = req_conn()
    rows = conn.execute(
        "SELECT * FROM time_capsules ORDER BY created_at DESC, id DESC").fetchall()
    return ok([dict(r) for r in rows])


@app.post('/api/capsules')
def api_capsules_create():
    payload = _json_body()
    title = _clean_str(payload.get('title'))
    if not title:
        raise ApiError('BAD_REQUEST', 'title 必填')
    content = payload.get('content')
    content = content if isinstance(content, str) else ''
    open_date = _clean_str(payload.get('open_date'))
    if not open_date or not CAPSULE_DATE_RE.match(open_date):
        raise ApiError('BAD_REQUEST', 'open_date 必填且格式须为 YYYY-MM-DD')
    try:
        datetime.date.fromisoformat(open_date)
    except ValueError:
        raise ApiError('BAD_REQUEST', 'open_date 不是合法日期')
    member_id = payload.get('member_id')  # 可空 = 家庭共享胶囊
    conn = req_conn()
    if member_id is not None:
        if not isinstance(member_id, int) or not conn.execute(
                "SELECT 1 FROM members WHERE id=?", (member_id,)).fetchone():
            raise ApiError('NOT_FOUND', f'member_id={member_id} 不存在', 404)
    cur = conn.execute(
        """INSERT INTO time_capsules(member_id, title, content, open_date)
           VALUES (?, ?, ?, ?)""", (member_id, title, content, open_date))
    conn.commit()
    row = conn.execute("SELECT * FROM time_capsules WHERE id=?", (cur.lastrowid,)).fetchone()
    return ok(dict(row))


@app.post('/api/capsules/<int:capsule_id>/open')
def api_capsules_open(capsule_id):
    conn = req_conn()
    row = conn.execute("SELECT * FROM time_capsules WHERE id=?", (capsule_id,)).fetchone()
    if not row:
        return err('NOT_FOUND', f'capsule_id={capsule_id} 不存在', 404)
    if not row['is_opened']:
        # 后端二次校验：用 Python datetime.date 比较，不用 SQLite date('now')（避免时区歧义）
        due = datetime.date.fromisoformat(row['open_date'])
        if due > datetime.date.today():
            return err('BAD_REQUEST', f'胶囊未到期，开启日期为 {row["open_date"]}', 400)
        conn.execute("UPDATE time_capsules SET is_opened=1 WHERE id=?", (capsule_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM time_capsules WHERE id=?", (capsule_id,)).fetchone()
    return ok(dict(row))


# ─────────────────────────── 前端入口 ───────────────────────────
@app.get('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


# ─────────────────────────── 启动入口 ───────────────────────────
if __name__ == '__main__':
    init_db()
    # 统一使用 waitress 生产服务器（threads=4），开发与生产同路径，避免双服务器行为差异
    print(f'家庭回忆话题盒子 · 后端已启动：http://0.0.0.0:5000 （数据目录：{os.path.abspath(DATA_DIR)}）')
    serve(app, host='0.0.0.0', port=5000, threads=4)
