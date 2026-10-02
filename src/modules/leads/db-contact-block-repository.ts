import { desc, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { contactBlocks } from '../../db/schema.js';
import { digitsOnly, whatsappNumberVariants } from '../phone/whatsapp-number.js';
import type { ContactBlockRepository } from './contact-block-repository.js';

export function createDbContactBlockRepository(): ContactBlockRepository {
  return {
    async add(input) {
      const values = { whatsappNumber: digitsOnly(input.whatsappNumber), reason: input.reason, source: input.source };
      const [block] = await db
        .insert(contactBlocks)
        .values(values)
        .onConflictDoUpdate({ target: contactBlocks.whatsappNumber, set: { reason: values.reason, source: values.source } })
        .returning();
      if (!block) throw new Error('Failed to block contact');
      return block;
    },

    async findBlocked(whatsappNumber) {
      const variants = whatsappNumberVariants(whatsappNumber);
      if (variants.length === 0) return null;
      const [block] = await db.select().from(contactBlocks).where(inArray(contactBlocks.whatsappNumber, variants)).limit(1);
      return block ?? null;
    },

    async list() {
      return db.select().from(contactBlocks).orderBy(desc(contactBlocks.createdAt));
    },

    async remove(id) {
      await db.delete(contactBlocks).where(eq(contactBlocks.id, id));
    },
  };
}
