// Live-refreshed performance settings shared by API + worker.
// Values are stored on the singleton `settings` row and re-read from DB
// every REFRESH_MS so admin changes apply without a restart.

import { query } from '../db';

export interface PerfSettings {
  worker_concurrency: number;
  emails_per_second: number;
  max_smtp_connections: number;
  queue_batch_size: number;
}

const DEFAULTS: PerfSettings = {
  worker_concurrency: 50,
  emails_per_second: 100,
  max_smtp_connections: 50,
  queue_batch_size: 500,
};

let cache: PerfSettings = { ...DEFAULTS };
let lastLoaded = 0;
const REFRESH_MS = 5_000;

export async function loadPerfSettings(force = false): Promise<PerfSettings> {
  const now = Date.now();
  if (!force && now - lastLoaded < REFRESH_MS) return cache;
  try {
    const { rows } = await query<Partial<PerfSettings>>(
      `SELECT worker_concurrency, emails_per_second, max_smtp_connections, queue_batch_size
         FROM settings WHERE id=1`
    );
    if (rows[0]) {
      cache = {
        worker_concurrency:   clamp(rows[0].worker_concurrency,   1, 2000, DEFAULTS.worker_concurrency),
        emails_per_second:    clamp(rows[0].emails_per_second,    1, 10000, DEFAULTS.emails_per_second),
        max_smtp_connections: clamp(rows[0].max_smtp_connections, 1, 1000, DEFAULTS.max_smtp_connections),
        queue_batch_size:     clamp(rows[0].queue_batch_size,     50, 5000, DEFAULTS.queue_batch_size),
      };
    }
    lastLoaded = now;
  } catch {
    // keep last good cache
  }
  return cache;
}

export function getPerfSettingsSync(): PerfSettings { return cache; }

function clamp(v: any, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(max, Math.max(min, n));
}
