import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './env';
import { logger } from './logger';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { smtpRouter } from './routes/smtp';
import { contactsRouter } from './routes/contacts';
import { campaignsRouter } from './routes/campaigns';
import { logsRouter } from './routes/logs';
import { dashboardRouter } from './routes/dashboard';
import { settingsRouter } from './routes/settings';

const app = express();

app.set('trust proxy', env.TRUST_PROXY);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/api/health' } }));

if (env.CORS_ORIGINS.length) {
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
}

// All routes are mounted under API_BASE_PATH (default /api).
// Behind Apache, requests come in as /smtp/api/* and are rewritten to /api/*.
const base = env.API_BASE_PATH;
const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
api.use('/auth', authRouter);
api.use('/users', usersRouter);
api.use('/smtp', smtpRouter);
api.use('/contacts', contactsRouter);
api.use('/campaigns', campaignsRouter);
api.use('/logs', logsRouter);
api.use('/dashboard', dashboardRouter);
api.use('/settings', settingsRouter);

app.use(base, api);

// 404 for unknown api paths
app.use(base, (_req, res) => res.status(404).json({ error: 'not_found' }));

// global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'unhandled_error');
  res.status(err?.status ?? 500).json({ error: err?.code ?? 'internal_error', message: err?.message ?? 'unexpected' });
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT, base }, 'secretvoip-smtp api listening');
});

const shutdown = (sig: string) => {
  logger.info({ sig }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
