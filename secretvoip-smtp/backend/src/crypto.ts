import crypto from 'crypto';
import { env } from './env';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');
const ALGO = 'aes-256-gcm';

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(enc: string): string {
  const [ivHex, tagHex, ctHex] = enc.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Bad ciphertext format');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}
