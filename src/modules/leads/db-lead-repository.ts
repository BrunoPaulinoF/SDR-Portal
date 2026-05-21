import { and, count, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { leadImports, leads } from '../../db/schema.js';
import type { LeadRepository } from './lead-repository.js';

export function createDbLeadRepository(): LeadRepository {
  return {
    async countFollowupSentForSdrSince(sdrAgentId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), gte(leads.followupSentAt, since)));
      return row?.value ?? 0;
    },

    async countInitialSentForSdrSince(sdrAgentId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), gte(leads.firstMessageSentAt, since)));
      return row?.value ?? 0;
    },

    async create(input) {
      const [lead] = await db.insert(leads).values(input).returning();
      if (!lead) {
        throw new Error('Failed to create lead');
      }
      return lead;
    },

    async createImport(input) {
      const [leadImport] = await db.insert(leadImports).values(input).returning();
      if (!leadImport) {
        throw new Error('Failed to create lead import');
      }
      return leadImport;
    },

    async delete(id) {
      await db.delete(leads).where(eq(leads.id, id));
    },

    async findById(id) {
      const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      return lead ?? null;
    },

    async findLastFollowupSentForSdr(sdrAgentId) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), isNotNull(leads.followupSentAt)))
        .orderBy(desc(leads.followupSentAt))
        .limit(1);
      return lead ?? null;
    },

    async findLastInitialSentForSdr(sdrAgentId) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), isNotNull(leads.firstMessageSentAt)))
        .orderBy(desc(leads.firstMessageSentAt))
        .limit(1);
      return lead ?? null;
    },

    async findNextFollowupDueForSdr(sdrAgentId, now) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.sdrAgentId, sdrAgentId),
            eq(leads.status, 'initial_sent'),
            lte(leads.followupDueAt, now),
            isNull(leads.followupSentAt),
            isNull(leads.followupDisabledAt),
          ),
        )
        .orderBy(leads.followupDueAt)
        .limit(1);
      return lead ?? null;
    },

    async findNextPendingForSdr(sdrAgentId) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), eq(leads.status, 'pending')))
        .orderBy(leads.createdAt)
        .limit(1);
      return lead ?? null;
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), eq(leads.whatsappNumber, whatsappNumber)))
        .limit(1);
      return lead ?? null;
    },

    async list() {
      return db.select().from(leads).orderBy(desc(leads.createdAt));
    },

    async listImports() {
      return db.select().from(leadImports).orderBy(desc(leadImports.createdAt));
    },

    async markHumanPaused(id, pausedAt, pausedUntil, reason) {
      const [lead] = await db
        .update(leads)
        .set({
          status: 'human_paused',
          lastOutboundAt: pausedAt,
          followupDisabledAt: pausedAt,
          humanPausedUntil: pausedUntil,
          aiPausedAt: pausedAt,
          aiPauseReason: reason,
          updatedAt: pausedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markInboundReceived(id, receivedAt) {
      const [current] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      const [lead] = await db
        .update(leads)
        .set({
          status: current?.status === 'transferred' ? 'transferred' : 'in_conversation',
          lastInboundAt: receivedAt,
          followupDisabledAt: receivedAt,
          updatedAt: receivedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markFollowupSent(id, sentAt) {
      const [lead] = await db
        .update(leads)
        .set({ status: 'followup_sent', followupSentAt: sentAt, followupDisabledAt: sentAt, lastOutboundAt: sentAt, updatedAt: sentAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markTransferred(id, transferredAt, summary) {
      const [lead] = await db
        .update(leads)
        .set({
          status: 'transferred',
          handoffRequestedAt: transferredAt,
          handoffSummary: summary,
          followupDisabledAt: transferredAt,
          aiPausedAt: transferredAt,
          aiPauseReason: 'handoff_requested_by_ai',
          updatedAt: transferredAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markInitialSent(id, sentAt, followupDueAt = null) {
      const [lead] = await db
        .update(leads)
        .set({ status: 'initial_sent', firstMessageSentAt: sentAt, followupDueAt, lastOutboundAt: sentAt, updatedAt: sentAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async update(id, input) {
      const [lead] = await db.update(leads).set({ ...input, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
      return lead ?? null;
    },
  };
}
