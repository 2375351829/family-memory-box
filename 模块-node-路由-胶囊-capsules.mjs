// 模块-node-路由-胶囊-capsules.mjs
// 时间胶囊：列表 / 创建 / 开启（对照 app.py 端点 #20–#22）
import { ok, err, requireIntId } from './模块-node-响应-response.mjs';
import { jsonBody, validateCapsuleFields, todayLocal } from './模块-node-校验-validate.mjs';

export function registerCapsuleRoutes(app) {
  // #20 列表（created_at 降序，同秒 id 降序）
  app.get('/api/capsules', (req, res) => {
    const rows = req.db
      .prepare('SELECT * FROM time_capsules ORDER BY created_at DESC, id DESC')
      .all()
      .map((r) => ({ ...r }));
    return ok(res, rows);
  });

  // #21 创建
  app.post('/api/capsules', (req, res) => {
    const payload = jsonBody(req);
    const conn = req.db;
    const fields = validateCapsuleFields(payload, conn);
    const result = conn
      .prepare(
        `INSERT INTO time_capsules(member_id, title, content, open_date)
         VALUES (?, ?, ?, ?)`
      )
      .run(fields.member_id, fields.title, fields.content, fields.open_date);
    const row = conn.prepare('SELECT * FROM time_capsules WHERE id=?').get(Number(result.lastInsertRowid));
    return ok(res, { ...row });
  });

  // #22 开启（后端二次校验到期，用本地日期比较，避免时区歧义）
  app.post('/api/capsules/:id/open', requireIntId, (req, res) => {
    const conn = req.db;
    const capsuleId = req.intId;
    let row = conn.prepare('SELECT * FROM time_capsules WHERE id=?').get(capsuleId);
    if (!row) return err(res, 'NOT_FOUND', `capsule_id=${capsuleId} 不存在`, 404);
    if (!row.is_opened) {
      if (row.open_date > todayLocal()) {
        return err(res, 'BAD_REQUEST', `胶囊未到期，开启日期为 ${row.open_date}`, 400);
      }
      conn.prepare('UPDATE time_capsules SET is_opened=1 WHERE id=?').run(capsuleId);
      row = conn.prepare('SELECT * FROM time_capsules WHERE id=?').get(capsuleId);
    }
    return ok(res, { ...row });
  });
}