import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';

export const templatesRouter = Router();
templatesRouter.use(requireAuth, requirePasswordOk);

templatesRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, subject, html, text, created_at, updated_at
       FROM email_templates WHERE user_id=$1 ORDER BY lower(name) ASC`,
    [req.user!.sub]
  );
  res.json({ templates: rows });
});

templatesRouter.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, subject, html, text, created_at, updated_at
       FROM email_templates WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ template: rows[0] });
});

const upsertSchema = z.object({
  name:    z.string().trim().min(1).max(200),
  subject: z.string().max(500).default(''),
  html:    z.string().max(500_000).default(''),
  text:    z.string().max(200_000).default(''),
});

templatesRouter.post('/', async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', detail: parsed.error.format() });
  const v = parsed.data;
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO email_templates (user_id, name, subject, html, text)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user!.sub, v.name, v.subject, v.html, v.text]
    );
    await audit(req, 'templates.create', rows[0].id, { name: v.name });
    res.status(201).json({ id: rows[0].id });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'name_taken' });
    throw e;
  }
});

templatesRouter.patch('/:id', async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const v = parsed.data;
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    vals.push(val); fields.push(`${k}=$${vals.length}`);
  }
  if (!fields.length) return res.json({ ok: true });
  vals.push(req.params.id, req.user!.sub);
  try {
    await query(
      `UPDATE email_templates SET ${fields.join(',')}, updated_at=now()
        WHERE id=$${vals.length - 1} AND user_id=$${vals.length}`,
      vals
    );
    await audit(req, 'templates.update', req.params.id, v);
    res.json({ ok: true });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'name_taken' });
    throw e;
  }
});

templatesRouter.delete('/:id', async (req, res) => {
  await query(`DELETE FROM email_templates WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]);
  await audit(req, 'templates.delete', req.params.id);
  res.json({ ok: true });
});
