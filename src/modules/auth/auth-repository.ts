import { randomUUID } from 'node:crypto';

import { type NewUser, type User } from '../../db/schema.js';

export type AuthUser = Pick<User, 'id' | 'name' | 'email' | 'passwordHash' | 'role'>;

export interface AuthRepository {
  createUser(user: NewUser): Promise<AuthUser>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
}

export function createMemoryAuthRepository(seedUsers: AuthUser[] = []): AuthRepository {
  const rows = new Map<string, AuthUser>();

  for (const user of seedUsers) {
    rows.set(user.id, user);
  }

  return {
    async createUser(user) {
      const createdUser: AuthUser = {
        id: user.id ?? randomUUID(),
        name: user.name,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role ?? 'admin',
      };

      rows.set(createdUser.id, createdUser);
      return createdUser;
    },

    async findByEmail(email) {
      const normalizedEmail = email.toLowerCase();
      return [...rows.values()].find((user) => user.email === normalizedEmail) ?? null;
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}
