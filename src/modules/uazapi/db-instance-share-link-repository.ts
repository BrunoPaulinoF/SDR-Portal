import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { instanceShareLinks } from '../../db/schema.js';
import type { InstanceShareLinkRepository } from './instance-share-link-repository.js';

export function createDbInstanceShareLinkRepository(): InstanceShareLinkRepository {
  return {
    async create(input) {
      const [link] = await db
        .insert(instanceShareLinks)
        .values({
          sdrAgentId: input.sdrAgentId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdByUserId: input.createdByUserId,
        })
        .returning();

      if (!link) throw new Error('Failed to create instance share link');
      return link;
    },

    async findByTokenHash(tokenHash) {
      const [link] = await db.select().from(instanceShareLinks).where(eq(instanceShareLinks.tokenHash, tokenHash)).limit(1);
      return link ?? null;
    },

    async markConnected(id, connectedAt) {
      await db.update(instanceShareLinks).set({ connectedAt }).where(eq(instanceShareLinks.id, id));
    },

    async revokeActiveForAgent(sdrAgentId, revokedAt) {
      await db
        .update(instanceShareLinks)
        .set({ revokedAt })
        .where(and(eq(instanceShareLinks.sdrAgentId, sdrAgentId), isNull(instanceShareLinks.revokedAt)));
    },
  };
}
