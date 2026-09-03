import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';

import { db } from '../../db/client.js';
import { leadImports, leads } from '../../db/schema.js';
import { statusAfterAiResume } from './ai-pause.js';
import type { LeadRepository } from './lead-repository.js';

type LeadActivityColumns = Pick<typeof leads, 'lastInboundAt' | 'lastOutboundAt'>;

/** Nenhuma mensagem (entrada ou saida) nesse lead depois de `since`. */
function quietSinceCondition(table: LeadActivityColumns, since: Date): SQL {
  return and(
    or(isNull(table.lastInboundAt), lte(table.lastInboundAt, since)),
    or(isNull(table.lastOutboundAt), lte(table.lastOutboundAt, since)),
  ) as SQL;
}

export function createDbLeadRepository(): LeadRepository {
  return {
    async countDailyActivityForSdr(sdrAgentId, start, end) {
      const contar = async (coluna: PgColumn): Promise<number> => {
        const [row] = await db
          .select({ value: count() })
          .from(leads)
          .where(and(eq(leads.sdrAgentId, sdrAgentId), gte(coluna, start), lte(coluna, end)));
        return row?.value ?? 0;
      };

      const [prospected, responded, handoffs] = await Promise.all([
        contar(leads.firstMessageSentAt),
        contar(leads.lastInboundAt),
        contar(leads.handoffRequestedAt),
      ]);

      return { prospected, responded, handoffs };
    },

    async countPendingForSdr(sdrAgentId) {
      const [row] = await db
        .select({ value: count() })
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), eq(leads.status, 'pending')));
      return row?.value ?? 0;
    },

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

    async deleteBySdrAndStatuses(sdrAgentId, statuses) {
      if (statuses.length === 0) return 0;
      // O cascade do schema leva junto conversas, mensagens e pesquisa do lead.
      const deleted = await db
        .delete(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), inArray(leads.status, statuses)))
        .returning({ id: leads.id });
      return deleted.length;
    },

    async delete(id) {
      await db.delete(leads).where(eq(leads.id, id));
    },

    async findById(id) {
      const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      return lead ?? null;
    },

    async findBySdrAndWhatsappIdentity(sdrAgentId, identity) {
      const conditions: SQL[] = [];
      if (identity.jid) conditions.push(eq(leads.whatsappJid, identity.jid));
      if (identity.lid) conditions.push(eq(leads.whatsappLid, identity.lid));

      if (conditions.length === 0) return null;

      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), or(...conditions)))
        .orderBy(desc(leads.createdAt))
        .limit(1);
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

    async findNextFollowupDueForSdr(sdrAgentId, now, options) {
      const quietSince = options?.quietSince ?? null;
      const other = alias(leads, 'other_lead');
      const sameChat = or(
        and(isNotNull(leads.whatsappJid), eq(other.whatsappJid, leads.whatsappJid)),
        and(isNotNull(leads.whatsappLid), eq(other.whatsappLid, leads.whatsappLid)),
        eq(other.whatsappNumber, leads.whatsappNumber),
      );
      // Outro lead do mesmo chat invalida o follow-up quando e mais novo (thread
      // substituida, ex.: /reset) ou quando o chat ainda esta quente.
      const blockingOther: SQL[] = [gt(other.createdAt, leads.createdAt)];
      if (quietSince) {
        blockingOther.push(gt(other.lastInboundAt, quietSince), gt(other.lastOutboundAt, quietSince));
      }

      // Duas populacoes recebem follow-up: quem respondeu e esfriou (retomada) e quem nunca
      // respondeu a abordagem (segundo toque). A segunda ficava de fora e nunca era tocada.
      const target = or(
        and(eq(leads.status, 'in_conversation'), isNotNull(leads.lastInboundAt)),
        and(eq(leads.status, 'initial_sent'), isNull(leads.lastInboundAt)),
      );

      const conditions: SQL[] = [
        eq(leads.sdrAgentId, sdrAgentId),
        lte(leads.followupDueAt, now),
        isNull(leads.followupSentAt),
        isNull(leads.followupDisabledAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(other)
            .where(and(eq(other.sdrAgentId, sdrAgentId), ne(other.id, leads.id), sameChat, or(...blockingOther))),
        ),
      ];
      if (target) conditions.push(target);
      if (quietSince) conditions.push(quietSinceCondition(leads, quietSince));

      const [lead] = await db
        .select()
        .from(leads)
        .where(and(...conditions))
        .orderBy(leads.followupDueAt)
        .limit(1);
      return lead ?? null;
    },

    async findNextPendingForSdr(sdrAgentId, options) {
      const skipLeadIds = options?.skipLeadIds ?? [];
      const [lead] = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.sdrAgentId, sdrAgentId),
            eq(leads.status, 'pending'),
            ...(skipLeadIds.length > 0 ? [notInArray(leads.id, [...skipLeadIds])] : []),
          ),
        )
        .orderBy(leads.createdAt)
        .limit(1);
      return lead ?? null;
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.sdrAgentId, sdrAgentId), eq(leads.whatsappNumber, whatsappNumber)))
        .orderBy(desc(leads.createdAt))
        .limit(1);
      return lead ?? null;
    },

    async list() {
      return db.select().from(leads).orderBy(desc(leads.createdAt));
    },

    async listByIds(ids) {
      if (ids.length === 0) return [];
      return db.select().from(leads).where(inArray(leads.id, ids));
    },

    async listImports() {
      return db.select().from(leadImports).orderBy(desc(leadImports.createdAt));
    },

    async pauseAi(id, pausedAt, reason) {
      const [current] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      const [lead] = await db
        .update(leads)
        .set({
          status: 'human_paused',
          followupDisabledAt: current?.followupDisabledAt ?? pausedAt,
          // pausa sem prazo: quem devolve a conversa para a IA e o botao do portal
          humanPausedUntil: null,
          aiPausedAt: pausedAt,
          aiPauseReason: reason,
          updatedAt: pausedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async resumeAi(id, resumedAt) {
      const [current] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      if (!current) return null;
      const [lead] = await db
        .update(leads)
        .set({
          status: statusAfterAiResume(current),
          humanPausedUntil: null,
          aiPausedAt: null,
          aiPauseReason: null,
          updatedAt: resumedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markInboundReceived(id, receivedAt, followupDueAt) {
      const [current] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
      const values: Partial<typeof leads.$inferInsert> = {
        status: current?.status === 'transferred' || current?.status === 'not_interested' ? current.status : 'in_conversation',
        lastInboundAt: receivedAt,
        // O lead voltou a falar: as tentativas gastas antes disso nao contam mais.
        followupAttempts: 0,
        updatedAt: receivedAt,
      };
      // reancora o follow-up na ultima interacao real, nao na primeira mensagem
      if (followupDueAt !== undefined) values.followupDueAt = followupDueAt;

      const [lead] = await db.update(leads).set(values).where(eq(leads.id, id)).returning();
      return lead ?? null;
    },

    async markOutboundSent(id, sentAt) {
      const [lead] = await db
        .update(leads)
        .set({ lastOutboundAt: sentAt, updatedAt: sentAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async rescheduleFollowup(id, followupDueAt, updatedAt) {
      // Todo reagendamento e uma tentativa que falhou: o contador e o que impede o loop eterno.
      const [lead] = await db
        .update(leads)
        .set({ followupDueAt, followupAttempts: sql`${leads.followupAttempts} + 1`, updatedAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markNotInterested(id, markedAt) {
      const [lead] = await db
        .update(leads)
        .set({
          status: 'not_interested',
          conversationStage: 'not_interested',
          notInterestedAt: markedAt,
          followupDisabledAt: markedAt,
          updatedAt: markedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markDiscarded(id, discardedAt) {
      const [lead] = await db
        .update(leads)
        .set({
          status: 'discarded',
          conversationStage: 'discarded',
          followupDisabledAt: discardedAt,
          updatedAt: discardedAt,
        })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async markInvalidPhone(id, markedAt) {
      const [lead] = await db
        .update(leads)
        .set({
          status: 'invalid_phone',
          conversationStage: 'discarded',
          followupDisabledAt: markedAt,
          updatedAt: markedAt,
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
          conversationStage: 'handoff_done',
          handoffRequestedAt: transferredAt,
          handoffSummary: summary,
          followupDisabledAt: transferredAt,
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

    async updateWhatsappIdentity(id, identity, updatedAt) {
      const values: Partial<typeof leads.$inferInsert> = { updatedAt };
      if (identity.jid) values.whatsappJid = identity.jid;
      if (identity.lid) values.whatsappLid = identity.lid;

      const [lead] = await db.update(leads).set(values).where(eq(leads.id, id)).returning();
      return lead ?? null;
    },

    async disableFollowup(id, disabledAt) {
      const [lead] = await db
        .update(leads)
        .set({ followupDisabledAt: disabledAt, updatedAt: disabledAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async updateStage(id, stage, updatedAt) {
      const [lead] = await db
        .update(leads)
        .set({ conversationStage: stage, updatedAt })
        .where(eq(leads.id, id))
        .returning();
      return lead ?? null;
    },

    async setFirstMessageVariant(id, variantId) {
      const [lead] = await db
        .update(leads)
        .set({ firstMessageVariantId: variantId, updatedAt: new Date() })
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
