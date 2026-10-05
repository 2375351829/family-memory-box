// 抽题算法单元测试（对照 测试-抽题-draw-test.py 6 用例逐条移植）
// 直连临时 SQLite（node:sqlite），不连 Flask/Express、不起服务，不污染 data/。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { normalizeConfig } from '../../模块-node-配置-config.mjs';
import { initDb, openDb } from '../../模块-node-数据库-db.mjs';
import { drawTopic, candidatePool, PoolEmptyError } from '../../模块-node-抽题-draw.mjs';

let tmp;
let config;

// 夹具：新建一名成员，返回 id（独立连接，用完即关）
function addMember(name) {
  const conn = openDb(config.dbPath);
  try {
    const r = conn.prepare('INSERT INTO members(name, relation) VALUES (?, ?)').run(name, '测试');
    return Number(r.lastInsertRowid);
  } finally {
    conn.close();
  }
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmb-unit-draw-'));
  config = normalizeConfig({ dataDir: tmp });
  initDb(config); // 建表 + 写 schema_version + 导入 48 条内置话题
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('8.1 抽题算法', () => {
  it('用例1 · 同轮不重复：连抽 8 次 round 恒为 1、无重复、非新一轮、含 2 条追问', () => {
    const mid = addMember('甲');
    const conn = openDb(config.dbPath);
    try {
      const ids = [];
      const rounds = [];
      const news = [];
      let lastTopic = null;
      for (let i = 0; i < 8; i += 1) {
        const r = drawTopic(conn, mid, null);
        ids.push(r.topic.id);
        rounds.push(r.roundNo);
        news.push(r.isNewRound);
        lastTopic = r.topic;
      }
      expect(new Set(ids).size).toBe(8);
      expect(new Set(rounds)).toEqual(new Set([1]));
      expect(news.some(Boolean)).toBe(false);
      expect(lastTopic.follow_ups.length).toBe(2);
    } finally {
      conn.close();
    }
  });

  it('用例2 · 抽满自动进下一轮：48 条抽满后第 49 次 is_new_round=true 且 round=2', () => {
    const mid = addMember('乙');
    const conn = openDb(config.dbPath);
    try {
      const total = conn.prepare('SELECT COUNT(*) AS c FROM topics').get().c;
      expect(total).toBe(48);
      const firstRound = [];
      for (let i = 0; i < total; i += 1) {
        const r = drawTopic(conn, mid, null);
        expect(r.roundNo).toBe(1);
        expect(r.isNewRound).toBe(false);
        firstRound.push(r.topic.id);
      }
      expect(new Set(firstRound).size).toBe(total);
      const r49 = drawTopic(conn, mid, null);
      expect(r49.isNewRound).toBe(true);
      expect(r49.roundNo).toBe(2);
      expect(firstRound.includes(r49.topic.id)).toBe(true);
    } finally {
      conn.close();
    }
  });

  it('用例3 · 分类过滤后仍不重复：节日记忆 8 条抽满 → 第 9 次进第 2 轮', () => {
    const mid = addMember('丙');
    const conn = openDb(config.dbPath);
    try {
      const ids = [];
      for (let i = 0; i < 8; i += 1) {
        const r = drawTopic(conn, mid, '节日记忆');
        expect(r.topic.category).toBe('节日记忆');
        expect(r.roundNo).toBe(1);
        expect(r.isNewRound).toBe(false);
        ids.push(r.topic.id);
      }
      expect(new Set(ids).size).toBe(8);
      const r9 = drawTopic(conn, mid, '节日记忆');
      expect(r9.isNewRound).toBe(true);
      expect(r9.roundNo).toBe(2);
    } finally {
      conn.close();
    }
  });

  it('用例4 · 空分类抛 PoolEmptyError（接口层将转 400）', () => {
    const mid = addMember('丁');
    const conn = openDb(config.dbPath);
    try {
      expect(() => drawTopic(conn, mid, '不存在的分类')).toThrow(PoolEmptyError);
    } finally {
      conn.close();
    }
  });

  it('用例5 · 两连接并发抽题不命中同题（BEGIN IMMEDIATE 串行化）', async () => {
    const mid = addMember('戊');
    const dbUrl = new URL('../../模块-node-数据库-db.mjs', import.meta.url).href;
    const drawUrl = new URL('../../模块-node-抽题-draw.mjs', import.meta.url).href;

    const workerCode = `
      (async () => {
        const { workerData, parentPort } = await import('node:worker_threads');
        const { openDb } = await import(workerData.dbUrl);
        const { drawTopic } = await import(workerData.drawUrl);
        const gate = new Int32Array(workerData.gate);
        Atomics.add(gate, 0, 1);
        while (Atomics.load(gate, 1) === 0) { /* 自旋等待放行，制造真实竞争 */ }
        const conn = openDb(workerData.dbPath);
        try {
          const r = drawTopic(conn, workerData.memberId, null);
          parentPort.postMessage({ topicId: r.topic.id, roundNo: r.roundNo });
        } catch (e) {
          parentPort.postMessage({ error: String((e && e.message) || e) });
        } finally {
          conn.close();
        }
      })();
    `;

    const sab = new SharedArrayBuffer(8);
    const gate = new Int32Array(sab);
    const spawn = () =>
      new Worker(workerCode, {
        eval: true,
        workerData: { dbUrl, drawUrl, dbPath: config.dbPath, memberId: mid, gate: sab },
      });

    const workers = [spawn(), spawn()];
    const done = workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.on('message', resolve);
          w.on('error', reject);
        })
    );

    // 等两个 worker 都就绪后同时放行
    const deadline = Date.now() + 10000;
    while (Atomics.load(gate, 0) < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2));
    }
    Atomics.store(gate, 1, 1);

    const results = await Promise.all(done);
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.length).toBe(2);
    expect(results[0].topicId).not.toBe(results[1].topicId);
  });

  it('用例6 · 抽题写入 draws 表留痕（3 次抽题 → 3 条记录）', () => {
    const mid = addMember('己');
    const conn = openDb(config.dbPath);
    try {
      for (let i = 0; i < 3; i += 1) drawTopic(conn, mid, null);
      const n = conn.prepare('SELECT COUNT(*) AS c FROM draws WHERE member_id=?').get(mid).c;
      expect(n).toBe(3);
    } finally {
      conn.close();
    }
  });

  it('补充 · candidatePool 排除该成员该轮已抽话题', () => {
    const mid = addMember('庚');
    const conn = openDb(config.dbPath);
    try {
      expect(candidatePool(conn, null, mid, 1).length).toBe(48);
      drawTopic(conn, mid, null);
      expect(candidatePool(conn, null, mid, 1).length).toBe(47);
    } finally {
      conn.close();
    }
  });
});