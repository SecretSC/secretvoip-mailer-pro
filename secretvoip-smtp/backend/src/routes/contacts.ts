import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';

export const contactsRouter = Router();
contactsRouter.use(requireAuth, requirePasswordOk);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- lists ---
contactsRouter.get('/lists', async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.name, l.description, l.created_at,
            (SELECT COUNT(*) FROM contacts c WHERE c.list_id = l.id) AS count
       FROM contact_lists l WHERE l.user_id=$1 ORDER BY l.created_at DESC`,
    [req.user!.sub]
  );
  res.json({ lists: rows });
});

const listSchema = z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional() });
contactsRouter.post('/lists', async (req, res) => {
  const v = listSchema.parse(req.body);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO contact_lists (user_id, name, description) VALUES ($1,$2,$3) RETURNING id`,
    [req.user!.sub, v.name, v.description ?? null]
  );
  await audit(req, 'contacts.list.create', rows[0].id, { name: v.name });
  res.status(201).json({ id: rows[0].id });
});

contactsRouter.delete('/lists/:id', async (req, res) => {
  await query(`DELETE FROM contact_lists WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]);
  await audit(req, 'contacts.list.delete', req.params.id);
  res.json({ ok: true });
});

// --- contacts ---
contactsRouter.get('/', async (req, res) => {
  const listId = req.query.list_id as string | undefined;
  const search = (req.query.search as string | undefined) ?? '';
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, company, list_id, created_at
       FROM contacts
      WHERE user_id=$1
        AND ($2::uuid IS NULL OR list_id=$2)
        AND ($3 = '' OR email ILIKE '%' || $3 || '%')
      ORDER BY created_at DESC LIMIT 1000`,
    [req.user!.sub, listId ?? null, search]
  );
  res.json({ contacts: rows });
});

const contactSchema = z.object({
  list_id: z.string().uuid().optional(),
  email: z.string().email(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  company: z.string().max(255).optional(),
});

contactsRouter.post('/', async (req, res) => {
  const v = contactSchema.parse(req.body);
  await query(
    `INSERT INTO contacts (user_id, list_id, email, first_name, last_name, company)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, COALESCE(list_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(email)) DO NOTHING`,
    [req.user!.sub, v.list_id ?? null, v.email, v.first_name ?? null, v.last_name ?? null, v.company ?? null]
  );
  res.status(201).json({ ok: true });
});

contactsRouter.delete('/:id', async (req, res) => {
  await query(`DELETE FROM contacts WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]);
  res.json({ ok: true });
});

// --- CSV import ---
contactsRouter.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  const listId = req.body.list_id || null;

  const records: Array<Record<string, string>> = [];
  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: (h: string[]) => h.map(c => c.trim().toLowerCase()), skip_empty_lines: true, trim: true });
    parser.on('readable', () => {
      let r; while ((r = parser.read())) records.push(r as any);
    });
    parser.on('error', reject);
    parser.on('end', resolve);
    parser.write(req.file!.buffer);
    parser.end();
  });

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  let imported = 0, skipped = 0;

  for (const r of records) {
    const email = (r.email || r['e-mail'] || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { skipped++; continue; }
    try {
      await query(
        `INSERT INTO contacts (user_id, list_id, email, first_name, last_name, company)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, COALESCE(list_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(email)) DO NOTHING`,
        [req.user!.sub, listId, email, r.first_name || null, r.last_name || null, r.company || null]
      );
      imported++;
    } catch { skipped++; }
  }

  await audit(req, 'contacts.import', listId, { imported, skipped, total: records.length });
  res.json({ imported, skipped, total: records.length });
});
