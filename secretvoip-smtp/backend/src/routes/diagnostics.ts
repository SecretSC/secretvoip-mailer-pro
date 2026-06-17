import { Router } from 'express';
import { query, pool } from '../db';
import { redis, bullConnection } from '../redis';
import { campaignQueue } from '../queue';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';

export const diagnosticsRouter = Router();
diagnosticsRouter.use(requireAuth, requirePasswordOk, requireRole('admin'));

type Health = { status: 'green' | 'yellow' | 'red'; message: string; detail?: any };

async function checkDb(): Promise<Health> {
  try {
    const t0 = Date.now();
    await query('SELECT 1');
    const ms = Date.now() - t0;
    return { status: ms < 250 ? 'green' : 'yellow', message: `OK (${ms}ms)`, detail: { latency_ms: ms, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } } };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'database unreachable' };
  }
}

async function checkRedis(): Promise<Health> {
  try {
    const t0 = Date.now();
    const pong = await redis.ping();
    const ms = Date.now() - t0;
    if (pong !== 'PONG') return { status: 'yellow', message: `unexpected reply: ${pong}` };
    return { status: ms < 100 ? 'green' : 'yellow', message: `OK (${ms}ms)`, detail: { latency_ms: ms } };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'redis unreachable' };
  }
}

async function checkWorker(): Promise<Health> {
  try {
    const workers = await campaignQueue.getWorkers();
    const counts = await campaignQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    if (!workers || workers.length === 0) {
      return { status: 'red', message: 'No worker processes connected', detail: counts };
    }
    return { status: 'green', message: `${workers.length} worker(s) online`, detail: { workers: workers.length, ...counts } };
  } catch (e: any) {
    return { status: 'red', message: e?.message ?? 'worker check failed' };
  }
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

diagnosticsRouter.get('/', async (_req, res) => {
  const [db, redisH, worker, smtp] = await Promise.all([checkDb(), checkRedis(), checkWorker(), checkSmtp()]);
  res.json({
    api:       { status: 'green', message: 'OK' },
    database:  db,
    redis:     redisH,
    worker:    worker,
    smtp:      smtp,
    ts: Date.now(),
  });
});
