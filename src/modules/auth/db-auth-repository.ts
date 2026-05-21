import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import type { AuthRepository } from './auth-repository.js';

export function createDbAuthRepository(): AuthRepository {
  return {
    async createUser(user) {
      const [createdUser] = await db.insert(users).values(user).returning({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        role: users.role,
      });

      if (!createdUser) {
        throw new Error('Failed to create user');
      }

      return createdUser;
    },

    async findByEmail(email) {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          role: users.role,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      return user ?? null;
    },

    async findById(id) {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      return user ?? null;
    },
  };
}
