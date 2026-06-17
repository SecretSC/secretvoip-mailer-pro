import { Router } from 'express';
import { query, pool } from '../db';
import { redis, bullConnection } from '../redis';
import { campaignQueue, queueEventsState } from '../queue';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';

export const diagnosticsRouter = Router();
diagnosticsRouter.use(requireAuth, requirePasswordOk, requireRole('admin'));

type Health = { status: 'green' | 'yellow' | 'red'; message: string; detail?: any };

async function checkDb(): Promise<Health> {
  try {
    const t0 = Date.now();
    await query('SELECT 1');
    const ms = Date.now() - t0;
    return {
      status: ms < 250 ? 'green' : 'yellow',
      message: `OK (${ms}ms)`,
      detail: { latency_ms: ms, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
    };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'database unreachable' };
  }
}

async function checkRedis(): Promise<Health> {
  try {
    const t0 = Date.now();
    const pong = await redis.ping();
    const ms = Date.now() - t0;
    const bullPong = await bullConnection.ping().catch((e: any) => 'ERR:' + (e?.message ?? e));
    if (pong !== 'PONG') return { status: 'yellow', message: `unexpected reply: ${pong}` };
    return {
      status: ms < 100 ? 'green' : 'yellow',
      message: `OK (${ms}ms)`,
      detail: { latency_ms: ms, bull_ping: bullPong },
    };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'redis unreachable' };
  }
}

async function getQueueCounts() {
  try {
    return await campaignQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused');
  } catch (e: any) {
    return { error: e?.message ?? String(e) } as any;
  }
}

async function checkQueue(): Promise<Health> {
  try {
    const counts = await getQueueCounts();
    return { status: 'green', message: 'Queue reachable', detail: counts };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'queue check failed' };
  }
}

async function readWorkerHeartbeat() {
  try {
    const raw = await redis.get('smtp:worker:heartbeat');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function checkWorker(): Promise<Health> {
  try {
    const workers = await campaignQueue.getWorkers();
    const counts = await getQueueCounts();
    const hb = await readWorkerHeartbeat();
    const detail: any = {
      bull_workers_connected: workers?.length ?? 0,
      heartbeat: hb,
      ...counts,
    };
    if (!workers || workers.length === 0) {
      return {
        status: 'red',
        message: hb
          ? 'Worker heartbeat present but no BullMQ workers visible — check connection/queue name'
          : 'No worker process connected (heartbeat missing). Run: systemctl start secretvoip-smtp-worker',
        detail,
      };
    }
    return { status: 'green', message: `${workers.length} worker(s) online`, detail };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'worker check failed' };
  }
}

function checkQueueEvents(): Health {
  if (queueEventsState.ready) {
    return { status: 'green', message: 'Connected', detail: { ready: true } };
  }
  return {
    status: 'red',
    message: queueEventsState.lastError ?? 'QueueEvents not ready',
    detail: queueEventsState,
  };
}

async function checkSmtp(): Promise<Health> {
  try {
    const { rows } = await query<{ total: string; failed: string; never: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE last_test_status='error' OR last_test_status='failed')::text AS failed,
         COUNT(*) FILTER (WHERE last_test_at IS NULL)::text AS never
       FROM smtp_configs WHERE status='active'`
    );
    const total = parseInt(rows[0]?.total || '0', 10);
    const failed = parseInt(rows[0]?.failed || '0', 10);
    const never = parseInt(rows[0]?.never || '0', 10);
    if (total === 0) return { status: 'yellow', message: 'No active SMTP configured' };
    if (failed > 0) return { status: 'yellow', message: `${failed}/${total} active SMTP failed last test`, detail: { total, failed, untested: never } };
    return { status: 'green', message: `${total} active SMTP`, detail: { total, failed, untested: never } };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'smtp check failed' };
  }
}

async function readLastInsert() {
  try {
    const raw = await redis.get('smtp:queue:last_insert');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

diagnosticsRouter.get('/', async (_req, res) => {
  const [db, redisH, queue, worker, smtp, lastInsert] = await Promise.all([
    checkDb(), checkRedis(), checkQueue(), checkWorker(), checkSmtp(), readLastInsert(),
  ]);
  const queueEvents = checkQueueEvents();
  res.json({
    api:          { status: 'green', message: 'OK', detail: { pid: process.pid, uptime_s: Math.round(process.uptime()) } },
    database:     db,
    redis:        redisH,
    queue:        queue,
    queue_events: queueEvents,
    worker:       worker,
    smtp:         smtp,
    last_queue_insert: lastInsert,
    ts: Date.now(),
  });
});
