import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { InstanceShareLink } from '../../db/schema.js';

/** Janela de validade do link publico de conexao. */
export const shareLinkTtlMinutes = 15;

export interface CreateInstanceShareLinkInput {
  sdrAgentId: string;
  createdByUserId: string | null;
  expiresAt: Date;
  tokenHash: string;
}

export interface InstanceShareLinkRepository {
  create(input: CreateInstanceShareLinkInput): Promise<InstanceShareLink>;
  findByTokenHash(tokenHash: string): Promise<InstanceShareLink | null>;
  markConnected(id: string, connectedAt: Date): Promise<void>;
  revokeActiveForAgent(sdrAgentId: string, revokedAt: Date): Promise<void>;
}

/** O token cru so existe na URL entregue ao usuario; o banco guarda apenas o hash. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function shareLinkExpiresAt(now: Date): Date {
  return new Date(now.getTime() + shareLinkTtlMinutes * 60 * 1000);
}

export function isShareLinkUsable(link: InstanceShareLink, now: Date): boolean {
  return !link.revokedAt && link.expiresAt > now;
}

export function createMemoryInstanceShareLinkRepository(): InstanceShareLinkRepository {
  const rows = new Map<string, InstanceShareLink>();

  return {
    async create(input) {
      const now = new Date();
      const link: InstanceShareLink = {
        id: randomUUID(),
        sdrAgentId: input.sdrAgentId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        connectedAt: null,
        createdByUserId: input.createdByUserId,
        createdAt: now,
      };
      rows.set(link.id, link);
      return link;
    },

    async findByTokenHash(tokenHash) {
      return [...rows.values()].find((link) => link.tokenHash === tokenHash) ?? null;
    },

    async markConnected(id, connectedAt) {
      const link = rows.get(id);
      if (link) rows.set(id, { ...link, connectedAt });
    },

    async revokeActiveForAgent(sdrAgentId, revokedAt) {
      for (const [id, link] of rows) {
        if (link.sdrAgentId === sdrAgentId && !link.revokedAt) rows.set(id, { ...link, revokedAt });
      }
    },
  };
}
