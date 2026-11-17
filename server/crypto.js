// AES-256-GCM encryption for secrets stored in db.json (plugin config values and access tokens).
// ENCRYPTION_KEY: 32 random bytes, base64. Create with: openssl rand -base64 32
import crypto from 'node:crypto';

const KEY = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'base64') : null;

export const encryptionReady = () => Boolean(KEY && KEY.length === 32);

export function encrypt(text) {
  if (!encryptionReady()) throw new Error('ENCRYPTION_KEY is not set on the server.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(value) {
  const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
