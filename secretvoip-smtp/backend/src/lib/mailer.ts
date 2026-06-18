import nodemailer, { Transporter } from 'nodemailer';
import { decryptSecret } from '../crypto';

export interface SmtpRow {
  id: string;
  host: string;
  port: number;
  username: string;
  password_enc: string;
  secure: boolean;
  starttls: boolean;
  from_name: string;
  from_email: string;
}

interface CachedTransport { t: Transporter; maxConnections: number }
const cache = new Map<string, CachedTransport>();

export function buildTransport(smtp: SmtpRow, opts: { maxConnections?: number } = {}): Transporter {
  const maxConnections = Math.max(1, Math.min(1000, opts.maxConnections ?? 50));
  const key = `${smtp.id}:${smtp.host}:${smtp.port}:${smtp.username}`;
  const cached = cache.get(key);
  if (cached && cached.maxConnections === maxConnections) return cached.t;
  if (cached) { try { cached.t.close(); } catch {} cache.delete(key); }
  const t = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.starttls && !smtp.secure,
    auth: { user: smtp.username, pass: decryptSecret(smtp.password_enc) },
    pool: true,
    maxConnections,
    maxMessages: 500,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  cache.set(key, { t, maxConnections });
  return t;
}

export function invalidateTransport(smtpId: string) {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(`${smtpId}:`)) {
      const c = cache.get(k); try { c?.t.close(); } catch {}
      cache.delete(k);
    }
  }
}

export async function verifyTransport(smtp: SmtpRow): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.starttls && !smtp.secure,
      auth: { user: smtp.username, pass: decryptSecret(smtp.password_enc) },
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    });
    await t.verify();
    t.close();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// Simple template substitution: {{first_name}}, {{last_name}}, {{company}}, {{email}}
export function renderTemplate(body: string, vars: Record<string, string | undefined | null>): string {
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => (vars[k] ?? '').toString());
}
