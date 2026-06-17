import bcrypt from 'bcryptjs';
import { pool, query } from '../src/db';

async function main() {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const hash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO users (username, password_hash, role, force_password_change, daily_limit, monthly_limit)
     VALUES ($1, $2, 'admin', true, 1000000, 30000000)
     ON CONFLICT (username) DO NOTHING`,
    [username, hash]
  );
  console.log(`✓ admin user '${username}' ensured (password: ${password})`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
