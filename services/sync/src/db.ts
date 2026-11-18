/**
 * db.ts — 同步服务的 SQLite 层（用 Node 26 内建 node:sqlite，零依赖）
 *
 * 表结构刻意保持极简：事件表 append-only，日报表由事件聚合而来。
 * 这样老人端离线攒的事件可以随时补传，不会因为乱序或重复而算错。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredEvent {
  id: string;
  deviceId: string;
  kind: string;
  at: number;
  payload: string;
}

export interface DayAggregate {
  deviceId: string;
  date: string;
  newLearned: number;
  reviewed: number;
  correct: number;
  total: number;
  mathDone: number;
  scienceDone: number;
  durationSec: number;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS events (
      id        TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      at        INTEGER NOT NULL,
      payload   TEXT NOT NULL,
      received  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_device_at ON events(device_id, at);

    CREATE TABLE IF NOT EXISTS pairing (
      code       TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      monitor_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      learner_id TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message (
      learner_id TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

export type Db = ReturnType<typeof openDb>;

/** 幂等写入：同一个事件 id 重复上传不会重复计数 */
export function insertEvents(db: Db, deviceId: string, events: StoredEvent[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (id, device_id, kind, at, payload, received)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const e of events) {
      const r = stmt.run(e.id, deviceId, e.kind, e.at, e.payload, now);
      if (Number(r.changes) > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

/** 按天聚合。日期从事件 payload 里取本地日期，缺失时按 UTC 时间戳换算 */
export function dailyAggregates(db: Db, deviceId: string, days: number): DayAggregate[] {
  const rows = db
    .prepare(
      `SELECT kind, at, payload FROM events
       WHERE device_id = ? AND at >= ?
       ORDER BY at ASC`,
    )
    .all(deviceId, Date.now() - days * 86_400_000) as {
    kind: string;
    at: number;
    payload: string;
  }[];

  const byDate = new Map<string, DayAggregate>();

  const get = (date: string): DayAggregate => {
    let a = byDate.get(date);
    if (!a) {
      a = {
        deviceId,
        date,
        newLearned: 0,
        reviewed: 0,
        correct: 0,
        total: 0,
        mathDone: 0,
        scienceDone: 0,
        durationSec: 0,
      };
      byDate.set(date, a);
    }
    return a;
  };

  for (const r of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const date = String(payload.date ?? new Date(r.at).toISOString().slice(0, 10));
    const a = get(date);

    if (r.kind === 'answer') {
      a.total += 1;
      if (payload.result === 'correct') a.correct += 1;
      a.reviewed += 1;
    } else if (r.kind === 'newchar') {
      a.newLearned += 1;
    } else if (r.kind === 'math') {
      a.mathDone = 1;
    } else if (r.kind === 'science') {
      a.scienceDone = 1;
    } else if (r.kind === 'session') {
      a.durationSec += Number(payload.durationSec ?? 0);
      a.newLearned = Math.max(a.newLearned, Number(payload.newLearned ?? 0));
    }
  }

  return [...byDate.values()].sort((x, y) => (x.date < y.date ? 1 : -1));
}