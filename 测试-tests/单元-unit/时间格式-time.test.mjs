// 时间格式单元测试：todayLocal / SQLite datetime('now','localtime') 均为本地当天 YYYY-MM-DD [HH:MM:SS]
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { todayLocal } from '../../模块-node-校验-validate.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function localExpectedDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('本地日期/时间格式', () => {
  it('todayLocal 匹配 YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(DATE_RE);
  });

  it('todayLocal 与本地 now 同一天（防 UTC 退化）', () => {
    expect(todayLocal()).toBe(localExpectedDate());
  });

  it('SQLite datetime(\'now\',\'localtime\') 匹配 YYYY-MM-DD HH:MM:SS 且为本地当天', () => {
    const conn = new DatabaseSync(':memory:');
    try {
      conn.exec("CREATE TABLE members(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))");
      const r = conn.prepare('INSERT INTO members DEFAULT VALUES').run();
      const row = conn.prepare('SELECT created_at FROM members WHERE id=?').get(Number(r.lastInsertRowid));
      expect(row.created_at).toMatch(DATETIME_RE);
      expect(row.created_at.slice(0, 10)).toBe(todayLocal());
      expect(row.created_at.slice(0, 10)).toBe(localExpectedDate());
    } finally {
      conn.close();
    }
  });
});