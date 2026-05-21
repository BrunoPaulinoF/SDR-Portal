import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema.js';

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to initialize the database client');
}

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });

export async function closeDb(): Promise<void> {
  await queryClient.end();
}
