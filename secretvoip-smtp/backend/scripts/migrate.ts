import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db';

async function main() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`→ applying ${f}`);
    await pool.query(sql);
  }
  console.log('✓ migrations complete');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
