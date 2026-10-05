// 模块-node-路由-核心-core.mjs
// 健康检查 / 全量状态 / 成员 CRUD / 话题 / 抽题（对照 app.py 端点 #1–#10）
import { ok, err, ApiError, requireIntId } from './模块-node-响应-response.mjs';
import { SCHEMA_VERSION } from './模块-node-配置-config.mjs';
import { jsonBody, cleanStr, validateMemberFields, validateTopicFields, pyInt, pyIntBind } from './模块-node-校验-validate.mjs';
import { memberDict, topicDict, storiesFull, publicStory } from './模块-node-查询-query.mjs';
import { drawTopic, PoolEmptyError } from './模块-node-抽题-draw.mjs';
import { withTx, purgePhotosOfStory } from './模块-node-数据库-db.mjs';
import os from 'node:os';

function fmtPy(v) {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  return String(v);
}

// 本机局域网可访问地址（非回环 IPv4，带真实端口）：供首页「手机上看」同步真实地址，
// 而不是写死示例 IP。私有网段优先、APIPA(169.254) 垫底。
function _lanScore(ip) {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  if (/^169\.254\./.test(ip)) return 9;
  return 5;
}
export function lanUrls(port) {
  const found = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      found.push(ni.address);
    }
  }
  found.sort((a, b) => _lanScore(a) - _lanScore(b) || a.localeCompare(b));
  const seen = new Set();
  return found
    .filter((ip) => (seen.has(ip) ? false : (seen.add(ip), true)))
    .map((ip) => `http://${ip}:${port}`);
}

export function registerCoreRoutes(app, ctx) {
  const { uploadDir } = ctx.config;

  // #1 健康检查（只读、无副作用）
  app.get('/api/health', (req, res) => {
    const conn = req.db;
    const sv = conn.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    const count = (t) => conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    return ok(res, {
      status: 'ok',
      schema_version: sv ? sv.value : SCHEMA_VERSION,
      counts: {
        members: count('members'),
        topics: count('topics'),
        stories: count('stories'),
        photos: count('photos'),
        capsules: count('time_capsules'),
      },
      // 本机局域网可访问地址（供首页「手机上看」同步真实地址；无外部网卡时为空数组）
      // 端口取法与入口 loadConfig 一致：PORT 环境变量，默认 5000（ctx.config 是 normalizeConfig 结果，不含 port）
      lan_urls: lanUrls(Number(process.env.PORT ?? 5000)),
    });
  });

  // #2 全量状态
  app.get('/api/state', (req, res) => {
    const conn = req.db;
    // members 附加抽题轮转字段：
    //   last_draw_id —— 该成员最近一次抽题记录的 id（从未抽过为 null）
    //   draw_count   —— 该成员累计抽题数
    // 「本轮轮到谁」取 last_draw_id 最小的成员（从未抽过者最优先）：
    // 用自增 id 而非时间戳做轮转键 —— 秒级时间戳会在同秒内打平，导致刚抽过的人又被选中（轮转卡住）；
    // 且与历史累计无关：抽过几十次的人不会被永久排在队尾，新成员天然先轮到。
    const drawnAgg = new Map(
      conn.prepare('SELECT member_id, MAX(id) AS last_id, COUNT(*) AS c FROM draws GROUP BY member_id').all()
        .map((r) => [r.member_id, r])
    );
    const members = conn
      .prepare('SELECT * FROM members ORDER BY sort_order, id')
      .all()
      .map((row) => {
        const agg = drawnAgg.get(row.id);
        return { ...memberDict(row), last_draw_id: agg ? agg.last_id : null, draw_count: agg ? agg.c : 0 };
      });
    const topics = conn.prepare('SELECT * FROM topics ORDER BY id').all().map((row) => topicDict(conn, row));
    // followups：以话题 id 为键的追问数组 Map（键为字符串）
    const followups = {};
    for (const row of conn.prepare('SELECT topic_id, text FROM topic_followups ORDER BY topic_id, order_no').all()) {
      const key = String(row.topic_id);
      if (!followups[key]) followups[key] = [];
      followups[key].push(row.text);
    }
    const stories = storiesFull(conn).map(publicStory);
    const photos = conn.prepare('SELECT * FROM photos ORDER BY id').all().map((p) => ({ ...p }));
    const capsules = conn
      .prepare('SELECT * FROM time_capsules ORDER BY created_at DESC, id DESC')
      .all()
      .map((r) => ({ ...r }));
    return ok(res, { members, topics, followups, stories, photos, capsules });
  });

  // #3 成员列表
  app.get('/api/members', (req, res) => {
    const rows = req.db.prepare('SELECT * FROM members ORDER BY sort_order, id').all();
    return ok(res, rows.map(memberDict));
  });

  // #4 新建成员（称谓唯一：同一称谓只能有一位家人，否则「本轮轮到：X」会歧义）
  app.post('/api/members', (req, res) => {
    const payload = jsonBody(req);
    const fields = validateMemberFields(payload, false);
    const conn = req.db;
    if (conn.prepare('SELECT 1 FROM members WHERE relation=?').get(fields.relation)) {
      return err(res, 'CONFLICT', `称谓「${fields.relation}」已存在，不可重复添加`, 409);
    }
    const cols = Object.keys(fields);
    const stmt = conn.prepare(`INSERT INTO members (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    const result = stmt.run(...Object.values(fields));
    const row = conn.prepare('SELECT * FROM members WHERE id=?').get(Number(result.lastInsertRowid));
    return ok(res, memberDict(row));
  });

  // #5 更新成员（partial）
  app.put('/api/members/:id', requireIntId, (req, res) => {
    const payload = jsonBody(req);
    const fields = validateMemberFields(payload, true);
    if (Object.keys(fields).length === 0) throw new ApiError('BAD_REQUEST', '无可更新字段');
    const conn = req.db;
    const memberId = req.intId;
    if (!conn.prepare('SELECT 1 FROM members WHERE id=?').get(memberId)) {
      return err(res, 'NOT_FOUND', `member_id=${memberId} 不存在`, 404);
    }
    // 改称谓时同样判重（排除自身，保证「只改姓名」不受影响）
    if (fields.relation && conn.prepare('SELECT 1 FROM members WHERE relation=? AND id<>?').get(fields.relation, memberId)) {
      return err(res, 'CONFLICT', `称谓「${fields.relation}」已存在，不可重复添加`, 409);
    }
    const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    conn.prepare(`UPDATE members SET ${sets} WHERE id=?`).run(...Object.values(fields), memberId);
    const row = conn.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    return ok(res, memberDict(row));
  });

  // #6 删除成员（级联清 stories/draws/photos + 逐个删照片文件；capsules.member_id 置 NULL）
  app.delete('/api/members/:id', requireIntId, (req, res) => {
    const conn = req.db;
    const memberId = req.intId;
    return withTx(conn, (tx) => {
      if (!conn.prepare('SELECT 1 FROM members WHERE id=?').get(memberId)) {
        tx.rollback();
        return err(res, 'NOT_FOUND', `member_id=${memberId} 不存在`, 404);
      }
      const storyIds = conn.prepare('SELECT id FROM stories WHERE member_id=?').all(memberId).map((r) => r.id);
      for (const sid of storyIds) purgePhotosOfStory(conn, uploadDir, sid);
      conn.prepare('DELETE FROM members WHERE id=?').run(memberId);
      tx.commit();
      return ok(res, { deleted: 1 });
    });
  });

  // #7 话题列表（?category=）
  app.get('/api/topics', (req, res) => {
    const conn = req.db;
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const rows = category
      ? conn.prepare('SELECT * FROM topics WHERE category=? ORDER BY id').all(category)
      : conn.prepare('SELECT * FROM topics ORDER BY id').all();
    return ok(res, rows.map((row) => topicDict(conn, row)));
  });

  // #8 新建话题（含追问链，整体显式事务）
  app.post('/api/topics', (req, res) => {
    const payload = jsonBody(req);
    const { category, text, follow_ups: fuList } = validateTopicFields(payload);
    const conn = req.db;
    const topicId = withTx(conn, (tx) => {
      const result = conn.prepare('INSERT INTO topics(category, text, is_builtin) VALUES (?, ?, 0)').run(category, text);
      const id = Number(result.lastInsertRowid);
      const insFu = conn.prepare('INSERT INTO topic_followups(topic_id, order_no, text) VALUES (?, ?, ?)');
      fuList.forEach((fu, i) => insFu.run(id, i + 1, fu));
      tx.commit();
      return id;
    });
    const row = conn.prepare('SELECT * FROM topics WHERE id=?').get(topicId);
    return ok(res, topicDict(conn, row));
  });

  // #9 删除话题（is_builtin 拒绝；事务内先 purge 该话题全部故事的照片文件再删）
  app.delete('/api/topics/:id', requireIntId, (req, res) => {
    const conn = req.db;
    const topicId = req.intId;
    const row = conn.prepare('SELECT * FROM topics WHERE id=?').get(topicId);
    if (!row) return err(res, 'NOT_FOUND', `topic_id=${topicId} 不存在`, 404);
    if (row.is_builtin) return err(res, 'BAD_REQUEST', '内置话题不可删除', 400);
    return withTx(conn, (tx) => {
      const storyIds = conn.prepare('SELECT id FROM stories WHERE topic_id=?').all(topicId).map((r) => r.id);
      for (const sid of storyIds) purgePhotosOfStory(conn, uploadDir, sid);
      conn.prepare('DELETE FROM topics WHERE id=?').run(topicId);
      tx.commit();
      return ok(res, { deleted: 1 });
    });
  });

  // #10 抽题
  app.post('/api/draw', (req, res) => {
    const payload = jsonBody(req);
    const memberId = payload.member_id;
    if (!pyInt(memberId)) throw new ApiError('BAD_REQUEST', 'member_id 必填且须为整数');
    const category = cleanStr(payload.category);
    const conn = req.db;
    if (!conn.prepare('SELECT 1 FROM members WHERE id=?').get(pyIntBind(memberId))) {
      return err(res, 'NOT_FOUND', `member_id=${fmtPy(memberId)} 不存在`, 404);
    }
    try {
      const { topic, roundNo, isNewRound } = drawTopic(conn, pyIntBind(memberId), category);
      return ok(res, { topic, round_no: roundNo, is_new_round: isNewRound });
    } catch (e) {
      if (e instanceof PoolEmptyError) return err(res, 'BAD_REQUEST', '该分类下暂无可抽的话题', 400);
      throw e;
    }
  });
}