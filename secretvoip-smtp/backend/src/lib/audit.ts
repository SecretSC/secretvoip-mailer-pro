import { Request } from 'express';
import { query } from '../db';

export async function audit(req: Request, action: string, target?: string, meta: Record<string, unknown> = {}) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, target, ip, user_agent, meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user?.sub ?? null, action, target ?? null, req.ip, req.headers['user-agent'] ?? null, meta]
    );
  } catch {
    // never let audit break the request
  }
}
