import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { closeDb, db } from './client.js';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

async function runMigrations(): Promise<void> {
  const hasMigrations = existsSync(migrationsFolder) && readdirSync(migrationsFolder).some((file) => file.endsWith('.sql'));

  if (!hasMigrations) {
    process.stdout.write('No migrations found. Skipping database migration.\n');
    return;
  }

  await migrate(db, { migrationsFolder });
  process.stdout.write('Database migrations completed.\n');
}

try {
  await runMigrations();
} finally {
  await closeDb();
}
