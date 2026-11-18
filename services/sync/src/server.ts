/**
 * server.ts — 同步服务
 *
 * 职责极窄，只做三件事：
 *   1. 收老人端的事件（离线攒着，联网补传，幂等）
 *   2. 按天聚合成日报给家属端
 *   3. 让家属端下发配置（每日目标/提醒时间）和留言
 *
 * 刻意不做：不做账号体系、不做云存储、不存任何内容资产。
 * 部署目标是一台家里常开的旧电脑/树莓派，一条命令起。
 */

import Fastify from 'fastify';
import { join } from 'node:path';
import { openDb, insertEvents, dailyAggregates } from './db.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'sync.db');

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const db = openDb(DB_PATH);

/**
 * CORS：监护端（另一个端口/另一台设备）、老人端 Capacitor（file:// 或
 * capacitor://localhost）都会跨源请求。手写 header 而不是引 cors 包，
 * 因为这个服务只有 6 个路由，且部署目标是极简的一台机器。
 */
fastify.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
  reply.header('Access-Control-Max-Age', '86400');
});

fastify.options('/*', async (_req, reply) => reply.code(204).send());

// ---------------------------------------------------------------- 健康检查

fastify.get('/health', async () => ({ ok: true, at: Date.now() }));

// ---------------------------------------------------------------- 配对

/** 生成 6 位配对码，家属端和老人端各输一次即可绑定 */
fastify.post('/api/pairing', async (req, reply) => {
  const body = req.body as { learnerId?: string };
  const learnerId = body?.learnerId;
  if (!learnerId) return reply.code(400).send({ error: 'learnerId 必填' });

  // 6 位数字，避开容易读错的重复
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare(
    'INSERT OR REPLACE INTO pairing (code, learner_id, monitor_id, created_at) VALUES (?, ?, NULL, ?)',
  ).run(code, learnerId, Date.now());

  return { code, learnerId };
});

fastify.post('/api/pairing/:code/claim', async (req, reply) => {
  const { code } = req.params as { code: string };
  const body = req.body as { monitorId?: string };
  if (!body?.monitorId) return reply.code(400).send({ error: 'monitorId 必填' });

  const row = db.prepare('SELECT learner_id FROM pairing WHERE code = ?').get(code) as
    | { learner_id: string }
    | undefined;
  if (!row) return reply.code(404).send({ error: '配对码不对' });

  db.prepare('UPDATE pairing SET monitor_id = ? WHERE code = ?').run(body.monitorId, code);
  return { learnerId: row.learner_id };
});

fastify.get('/api/pairing/:code', async (req, reply) => {
  const { code } = req.params as { code: string };
  const row = db
    .prepare('SELECT learner_id, monitor_id FROM pairing WHERE code = ?')
    .get(code) as { learner_id: string; monitor_id: string | null } | undefined;
  if (!row) return reply.code(404).send({ error: '配对码不对' });
  return { learnerId: row.learner_id, paired: Boolean(row.monitor_id) };
});

// ---------------------------------------------------------------- 事件上传

interface EventBody {
  deviceId: string;
  events: { id: string; kind: string; at: number; payload: unknown }[];
}

fastify.post('/api/events', async (req, reply) => {
  const body = req.body as EventBody;
  if (!body?.deviceId || !Array.isArray(body.events)) {
    return reply.code(400).send({ error: 'deviceId 与 events 必填' });
  }

  const rows = body.events.map((e) => ({
    id: String(e.id),
    deviceId: body.deviceId,
    kind: String(e.kind),
    at: Number(e.at),
    payload: JSON.stringify(e.payload ?? {}),
  }));

  const inserted = insertEvents(db, body.deviceId, rows);
  return { received: rows.length, inserted };
});

// ---------------------------------------------------------------- 日报

fastify.get('/api/report/:learnerId', async (req, reply) => {
  const { learnerId } = req.params as { learnerId: string };
  const q = req.query as { days?: string };
  const days = Math.min(90, Math.max(1, Number(q?.days ?? 30)));

  const aggregates = dailyAggregates(db, learnerId, days);

  // 连续学习天数：从今天或昨天往前数
  const activeDates = new Set(aggregates.filter((a) => a.total > 0).map((a) => a.date));
  const todayKey = new Date().toISOString().slice(0, 10);
  let streak = 0;
  const d = new Date();
  if (!activeDates.has(todayKey)) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    const k = d.toISOString().slice(0, 10);
    if (!activeDates.has(k)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }

  const msg = db
    .prepare('SELECT text, created_at FROM message WHERE learner_id = ?')
    .get(learnerId) as { text: string; created_at: number } | undefined;

  return {
    learnerId,
    days: aggregates,
    streak,
    today: aggregates.find((a) => a.date === todayKey) ?? null,
    message: msg ? { text: msg.text, at: msg.created_at } : null,
  };
});

// ---------------------------------------------------------------- 配置

fastify.get('/api/config/:learnerId', async (req, reply) => {
  const { learnerId } = req.params as { learnerId: string };
  const row = db.prepare('SELECT json FROM config WHERE learner_id = ?').get(learnerId) as
    | { json: string }
    | undefined;
  if (!row) return { learnerId, config: null };
  return { learnerId, config: JSON.parse(row.json) };
});

fastify.post('/api/config/:learnerId', async (req, reply) => {
  const { learnerId } = req.params as { learnerId: string };
  const body = req.body as Record<string, unknown>;
  db.prepare(
    'INSERT OR REPLACE INTO config (learner_id, json, updated_at) VALUES (?, ?, ?)',
  ).run(learnerId, JSON.stringify(body ?? {}), Date.now());
  return { ok: true };
});

// ---------------------------------------------------------------- 留言

fastify.post('/api/message/:learnerId', async (req, reply) => {
  const { learnerId } = req.params as { learnerId: string };
  const body = req.body as { text?: string };
  const text = String(body?.text ?? '').trim().slice(0, 200);
  if (!text) return reply.code(400).send({ error: '留言不能为空' });
  db.prepare(
    'INSERT OR REPLACE INTO message (learner_id, text, created_at) VALUES (?, ?, ?)',
  ).run(learnerId, text, Date.now());
  return { ok: true };
});

// ---------------------------------------------------------------- 启动

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`同步服务已启动 http://${HOST}:${PORT}  DB=${DB_PATH}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}