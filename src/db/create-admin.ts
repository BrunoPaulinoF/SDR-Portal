import { closeDb } from './client.js';
import { createDbAuthRepository } from '../modules/auth/db-auth-repository.js';
import { hashPassword } from '../modules/auth/password.js';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function createAdmin(): Promise<void> {
  const name = process.env.ADMIN_NAME ?? 'Admin';
  const email = requiredEnv('ADMIN_EMAIL').toLowerCase();
  const password = requiredEnv('ADMIN_PASSWORD');

  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must have at least 8 characters');
  }

  const repository = createDbAuthRepository();
  const existingUser = await repository.findByEmail(email);

  if (existingUser) {
    process.stdout.write(`Admin user already exists: ${email}\n`);
    return;
  }

  await repository.createUser({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });

  process.stdout.write(`Admin user created: ${email}\n`);
}

try {
  await createAdmin();
} finally {
  await closeDb();
}
