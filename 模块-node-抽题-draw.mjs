// 模块-node-抽题-draw.mjs
// 8.1 抽题算法（对照 app.py _candidate_pool / draw_topic / PoolEmptyError）
import { topicDict } from './模块-node-查询-query.mjs';
import { withTx } from './模块-node-数据库-db.mjs';

/** 候选池为空（分类无话题，或全部已抽且无法进入下一轮） */
export class PoolEmptyError extends Error {
  constructor(message) {
    super(message || '候选池为空（分类无话题或全部已抽且无法进入下一轮）');
    this.name = 'PoolEmptyError';
  }
}

/** 候选池 = 全部话题（或指定分类）- 该成员该轮已抽话题（对照 _candidate_pool） */
export function candidatePool(conn, category, memberId, roundNo) {
  const used = new Set(
    conn
      .prepare('SELECT topic_id FROM draws WHERE member_id=? AND round_no=?')
      .all(memberId, roundNo)
      .map((r) => r.topic_id)
  );
  const rows = category
    ? conn.prepare('SELECT * FROM topics WHERE category=?').all(category)
    : conn.prepare('SELECT * FROM topics').all();
  return rows.filter((r) => !used.has(r.id));
}

/**
 * 抽题算法步骤 1–8（对照 draw_topic）：BEGIN IMMEDIATE → 查当前轮 → 排除已抽
 * → 空池进下一轮 → 随机抽一题 → INSERT draws → COMMIT → 返回话题。
 * 返回 {topic, roundNo, isNewRound}；候选池为空抛 PoolEmptyError；任何异常统一 ROLLBACK。
 */
export function drawTopic(conn, memberId, category = null) {
  return withTx(conn, (tx) => {
    const row = conn.prepare('SELECT MAX(round_no) AS m FROM draws WHERE member_id=?').get(memberId);
    let roundNo = row.m ?? 1;
    let isNewRound = false;
    let pool = candidatePool(conn, category, memberId, roundNo);
    if (pool.length === 0) {
      roundNo += 1;
      isNewRound = true;
      pool = candidatePool(conn, category, memberId, roundNo);
    }
    if (pool.length === 0) throw new PoolEmptyError();
    const topicRow = pool[Math.floor(Math.random() * pool.length)];
    conn
      .prepare('INSERT INTO draws(member_id, topic_id, round_no) VALUES (?, ?, ?)')
      .run(memberId, topicRow.id, roundNo);
    tx.commit();
    return { topic: topicDict(conn, topicRow), roundNo, isNewRound };
  });
}