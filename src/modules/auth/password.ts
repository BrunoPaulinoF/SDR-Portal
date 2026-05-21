import { hash, verify } from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}
