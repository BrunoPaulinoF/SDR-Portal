import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from '../../config/env.js';

const secretPrefix = 'v1';

function getEncryptionKey(): Buffer {
  const key = env.ENCRYPTION_KEY ?? (env.NODE_ENV === 'test' ? 'test_encryption_key_for_sdr_portal_32_bytes' : undefined);

  if (!key) {
    throw new Error('ENCRYPTION_KEY is required to store secrets');
  }

  return createHash('sha256').update(key).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [secretPrefix, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(encryptedSecret: string): string {
  const [version, ivValue, tagValue, encryptedValue] = encryptedSecret.split(':');

  if (version !== secretPrefix || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted secret format');
  }

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}
