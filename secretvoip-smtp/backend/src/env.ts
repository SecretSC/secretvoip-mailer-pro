import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  PORT: parseInt(process.env.PORT ?? '4010', 10),
  HOST: process.env.HOST ?? '127.0.0.1',
  API_BASE_PATH: process.env.API_BASE_PATH ?? '/api',
  TRUST_PROXY: parseInt(process.env.TRUST_PROXY ?? '1', 10),
  CORS_ORIGINS: (process.env.CORS_ORIGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean),

  JWT_SECRET: req('JWT_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '30d',
  ENCRYPTION_KEY: req('ENCRYPTION_KEY'),

  DATABASE_URL: req('DATABASE_URL'),
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/3',

  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY ?? '10', 10),
  WORKER_RATE_PER_SECOND: parseInt(process.env.WORKER_RATE_PER_SECOND ?? '20', 10),

  DEFAULT_DAILY_LIMIT: parseInt(process.env.DEFAULT_DAILY_LIMIT ?? '1000000', 10),
  DEFAULT_MONTHLY_LIMIT: parseInt(process.env.DEFAULT_MONTHLY_LIMIT ?? '30000000', 10),

  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
};

if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes). Use: openssl rand -hex 32');
}
