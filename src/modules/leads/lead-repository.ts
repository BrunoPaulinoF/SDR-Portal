import { randomUUID } from 'node:crypto';

import type { Lead, LeadImport, NewLead, NewLeadImport } from '../../db/schema.js';
import { statusAfterAiResume } from './ai-pause.js';

export type LeadInput = Pick<
  NewLead,
  | 'companyId'
  | 'sdrAgentId'
  | 'whatsappNumber'
  | 'cnpj'
  | 'companyName'
  | 'tradeName'
  | 'segment'
  | 'city'
  | 'state'
  | 'contactName'
  | 'extraData'
  | 'status'
  | 'source'
> & Partial<Pick<NewLead, 'whatsappJid' | 'whatsappLid'>>;

export type LeadImportInput = Pick<
  NewLeadImport,
  'companyId' | 'sdrAgentId' | 'fileName' | 'totalRows' | 'successRows' | 'errorRows' | 'mapping' | 'errors'
>;

/**
 * `quietSince`: so devolve lead cujo chat esta em silencio desde essa data. Bloqueia
 * follow-up quando o proprio lead — ou qualquer outro lead do mesmo numero/JID — teve
 * mensagem depois dela, e quando existe um lead mais novo para o mesmo chat (ex.: `/reset`).
 */
export interface FollowupDueOptions {
  quietSince?: Date | null;
}

export interface LeadRepository {
  countFollowupSentForSdrSince(sdrAgentId: string, since: Date): Promise<number>;
  countInitialSentForSdrSince(sdrAgentId: string, since: Date): Promise<number>;
  create(input: LeadInput): Promise<Lead>;
  createImport(input: LeadImportInput): Promise<LeadImport>;
  delete(id: string): Promise<void>;
  deleteBySdrAndStatuses(sdrAgentId: string, statuses: string[]): Promise<number>;
  findById(id: string): Promise<Lead | null>;
  findBySdrAndWhatsappIdentity(sdrAgentId: string, identity: { jid?: string | null; lid?: string | null }): Promise<Lead | null>;
  findLastFollowupSentForSdr(sdrAgentId: string): Promise<Lead | null>;
  findLastInitialSentForSdr(sdrAgentId: string): Promise<Lead | null>;
  findNextFollowupDueForSdr(sdrAgentId: string, now: Date, options?: FollowupDueOptions): Promise<Lead | null>;
  findNextPendingForSdr(sdrAgentId: string): Promise<Lead | null>;
  findBySdrAndWhatsapp(sdrAgentId: string, whatsappNumber: string): Promise<Lead | null>;
  list(): Promise<Lead[]>;
  /** Leads de um conjunto conhecido de ids (ex.: os donos das conversas de um SDR). */
  listByIds(ids: string[]): Promise<Lead[]>;
  listImports(): Promise<LeadImport[]>;
  /** Pausa a IA nesta conversa ate alguem liberar no portal: nao expira sozinha. */
  pauseAi(id: string, pausedAt: Date, reason: string): Promise<Lead | null>;
  /** Libera a IA e devolve o lead ao status que a conversa tinha antes da pausa. */
  resumeAi(id: string, resumedAt: Date): Promise<Lead | null>;
  markInboundReceived(id: string, receivedAt: Date, followupDueAt?: Date | null): Promise<Lead | null>;
  markOutboundSent(id: string, sentAt: Date): Promise<Lead | null>;
  markFollowupSent(id: string, sentAt: Date): Promise<Lead | null>;
  rescheduleFollowup(id: string, followupDueAt: Date, updatedAt: Date): Promise<Lead | null>;
  markDiscarded(id: string, discardedAt: Date): Promise<Lead | null>;
  markInvalidPhone(id: string, markedAt: Date): Promise<Lead | null>;
  markNotInterested(id: string, markedAt: Date): Promise<Lead | null>;
  markTransferred(id: string, transferredAt: Date, summary: string): Promise<Lead | null>;
  markInitialSent(id: string, sentAt: Date, followupDueAt?: Date | null): Promise<Lead | null>;
  updateWhatsappIdentity(id: string, identity: { jid?: string | null; lid?: string | null }, updatedAt: Date): Promise<Lead | null>;
  disableFollowup(id: string, disabledAt: Date): Promise<Lead | null>;
  updateStage(id: string, stage: string, updatedAt: Date): Promise<Lead | null>;
  setFirstMessageVariant(id: string, variantId: string): Promise<Lead | null>;
  update(id: string, input: LeadInput): Promise<Lead | null>;
}

function normalize(input: LeadInput): Omit<Lead, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    companyId: input.companyId,
    sdrAgentId: input.sdrAgentId,
    whatsappNumber: input.whatsappNumber,
    whatsappJid: input.whatsappJid ?? null,
    whatsappLid: input.whatsappLid ?? null,
    cnpj: input.cnpj ?? null,
    companyName: input.companyName,
    tradeName: input.tradeName ?? null,
    segment: input.segment ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    contactName: input.contactName ?? null,
    extraData: input.extraData ?? null,
    status: input.status ?? 'pending',
    conversationStage: 'permission',
    source: input.source ?? 'manual',
    firstMessageVariantId: null,
    firstMessageSentAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    followupDueAt: null,
    followupSentAt: null,
    followupDisabledAt: null,
    humanPausedUntil: null,
    aiPausedAt: null,
    aiPauseReason: null,
    handoffRequestedAt: null,
    handoffSummary: null,
    notInterestedAt: null,
  };
}

/** Mesmo interlocutor no WhatsApp: JID, LID ou numero identico. */
function isSameChat(lead: Lead, other: Lead): boolean {
  if (lead.whatsappJid && other.whatsappJid === lead.whatsappJid) return true;
  if (lead.whatsappLid && other.whatsappLid === lead.whatsappLid) return true;
  return other.whatsappNumber === lead.whatsappNumber;
}

function hasActivityAfter(lead: Lead, since: Date): boolean {
  return (
    (lead.lastInboundAt !== null && lead.lastInboundAt > since) || (lead.lastOutboundAt !== null && lead.lastOutboundAt > since)
  );
}

export function createMemoryLeadRepository(seedLeads: Lead[] = []): LeadRepository {
  const rows = new Map<string, Lead>();
  const imports = new Map<string, LeadImport>();

  for (const lead of seedLeads) {
    rows.set(lead.id, lead);
  }

  return {
    async countFollowupSentForSdrSince(sdrAgentId, since) {
      return [...rows.values()].filter(
        (lead) => lead.sdrAgentId === sdrAgentId && lead.followupSentAt !== null && lead.followupSentAt >= since,
      ).length;
    },

    async countInitialSentForSdrSince(sdrAgentId, since) {
      return [...rows.values()].filter(
        (lead) => lead.sdrAgentId === sdrAgentId && lead.firstMessageSentAt !== null && lead.firstMessageSentAt >= since,
      ).length;
    },

    async create(input) {
      const now = new Date();
      const lead: Lead = { id: randomUUID(), ...normalize(input), createdAt: now, updatedAt: now };
      rows.set(lead.id, lead);
      return lead;
    },

    async createImport(input) {
      const leadImport: LeadImport = {
        id: randomUUID(),
        companyId: input.companyId,
        sdrAgentId: input.sdrAgentId,
        fileName: input.fileName,
        totalRows: input.totalRows ?? 0,
        successRows: input.successRows ?? 0,
        errorRows: input.errorRows ?? 0,
        mapping: input.mapping ?? null,
        errors: input.errors ?? null,
        createdAt: new Date(),
      };

      imports.set(leadImport.id, leadImport);
      return leadImport;
    },

    async delete(id) {
      rows.delete(id);
    },

    async deleteBySdrAndStatuses(sdrAgentId, statuses) {
      if (statuses.length === 0) return 0;
      const doomed = [...rows.values()].filter((lead) => lead.sdrAgentId === sdrAgentId && statuses.includes(lead.status));
      for (const lead of doomed) rows.delete(lead.id);
      return doomed.length;
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },

    async findBySdrAndWhatsappIdentity(sdrAgentId, identity) {
      const matches = [...rows.values()].filter(
        (lead) =>
          lead.sdrAgentId === sdrAgentId &&
          ((identity.jid && lead.whatsappJid === identity.jid) || (identity.lid && lead.whatsappLid === identity.lid)),
      );
      return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    },

    async findLastFollowupSentForSdr(sdrAgentId) {
      return (
        [...rows.values()]
          .filter((lead) => lead.sdrAgentId === sdrAgentId && lead.followupSentAt !== null)
          .sort((a, b) => (b.followupSentAt?.getTime() ?? 0) - (a.followupSentAt?.getTime() ?? 0))[0] ?? null
      );
    },

    async findLastInitialSentForSdr(sdrAgentId) {
      return (
        [...rows.values()]
          .filter((lead) => lead.sdrAgentId === sdrAgentId && lead.firstMessageSentAt !== null)
          .sort((a, b) => (b.firstMessageSentAt?.getTime() ?? 0) - (a.firstMessageSentAt?.getTime() ?? 0))[0] ?? null
      );
    },

    async findNextFollowupDueForSdr(sdrAgentId, now, options) {
      const quietSince = options?.quietSince ?? null;
      const all = [...rows.values()];

      return (
        all
          .filter(
            (lead) =>
              lead.sdrAgentId === sdrAgentId &&
              lead.status === 'in_conversation' &&
              lead.lastInboundAt !== null &&
              lead.followupDueAt !== null &&
              lead.followupDueAt <= now &&
              lead.followupSentAt === null &&
              lead.followupDisabledAt === null &&
              (quietSince === null || !hasActivityAfter(lead, quietSince)) &&
              !all.some(
                (other) =>
                  other.id !== lead.id &&
                  other.sdrAgentId === sdrAgentId &&
                  isSameChat(lead, other) &&
                  // thread substituida (ex.: /reset criou um lead novo) ou chat ainda quente
                  (other.createdAt > lead.createdAt || (quietSince !== null && hasActivityAfter(other, quietSince))),
              ),
          )
          .sort((a, b) => (a.followupDueAt?.getTime() ?? 0) - (b.followupDueAt?.getTime() ?? 0))[0] ?? null
      );
    },

    async findNextPendingForSdr(sdrAgentId) {
      return (
        [...rows.values()]
          .filter((lead) => lead.sdrAgentId === sdrAgentId && lead.status === 'pending')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null
      );
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      return (
        [...rows.values()]
          .filter((lead) => lead.sdrAgentId === sdrAgentId && lead.whatsappNumber === whatsappNumber)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },

    async list() {
      return [...rows.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
    },

    async listByIds(ids) {
      const wanted = new Set(ids);
      return [...rows.values()].filter((lead) => wanted.has(lead.id));
    },

    async listImports() {
      return [...imports.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async pauseAi(id, pausedAt, reason) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: 'human_paused',
        followupDisabledAt: current.followupDisabledAt ?? pausedAt,
        humanPausedUntil: null,
        aiPausedAt: pausedAt,
        aiPauseReason: reason,
        updatedAt: pausedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async resumeAi(id, resumedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: statusAfterAiResume(current),
        humanPausedUntil: null,
        aiPausedAt: null,
        aiPauseReason: null,
        updatedAt: resumedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markInboundReceived(id, receivedAt, followupDueAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: current.status === 'transferred' || current.status === 'not_interested' ? current.status : 'in_conversation',
        lastInboundAt: receivedAt,
        // reancora o follow-up na ultima interacao real, nao na primeira mensagem
        followupDueAt: followupDueAt === undefined ? current.followupDueAt : followupDueAt,
        updatedAt: receivedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markOutboundSent(id, sentAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = { ...current, lastOutboundAt: sentAt, updatedAt: sentAt };
      rows.set(id, lead);
      return lead;
    },

    async rescheduleFollowup(id, followupDueAt, updatedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = { ...current, followupDueAt, updatedAt };
      rows.set(id, lead);
      return lead;
    },

    async markFollowupSent(id, sentAt) {
      const current = rows.get(id);
      if (!current) {
        return null;
      }

      const lead: Lead = {
        ...current,
        status: 'followup_sent',
        followupSentAt: sentAt,
        followupDisabledAt: sentAt,
        lastOutboundAt: sentAt,
        updatedAt: sentAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markDiscarded(id, discardedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: 'discarded',
        conversationStage: 'discarded',
        followupDisabledAt: current.followupDisabledAt ?? discardedAt,
        updatedAt: discardedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markInvalidPhone(id, markedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: 'invalid_phone',
        conversationStage: 'discarded',
        followupDisabledAt: current.followupDisabledAt ?? markedAt,
        updatedAt: markedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markNotInterested(id, markedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: 'not_interested',
        conversationStage: 'not_interested',
        notInterestedAt: markedAt,
        followupDisabledAt: current.followupDisabledAt ?? markedAt,
        updatedAt: markedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markTransferred(id, transferredAt, summary) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        status: 'transferred',
        conversationStage: 'handoff_done',
        handoffRequestedAt: transferredAt,
        handoffSummary: summary,
        followupDisabledAt: current.followupDisabledAt ?? transferredAt,
        updatedAt: transferredAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async markInitialSent(id, sentAt, followupDueAt = null) {
      const current = rows.get(id);
      if (!current) {
        return null;
      }

      const lead: Lead = {
        ...current,
        status: 'initial_sent',
        firstMessageSentAt: sentAt,
        followupDueAt,
        lastOutboundAt: sentAt,
        updatedAt: sentAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async updateWhatsappIdentity(id, identity, updatedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = {
        ...current,
        whatsappJid: identity.jid ?? current.whatsappJid,
        whatsappLid: identity.lid ?? current.whatsappLid,
        updatedAt,
      };
      rows.set(id, lead);
      return lead;
    },

    async disableFollowup(id, disabledAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = { ...current, followupDisabledAt: current.followupDisabledAt ?? disabledAt, updatedAt: disabledAt };
      rows.set(id, lead);
      return lead;
    },

    async updateStage(id, stage, updatedAt) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = { ...current, conversationStage: stage, updatedAt };
      rows.set(id, lead);
      return lead;
    },

    async setFirstMessageVariant(id, variantId) {
      const current = rows.get(id);
      if (!current) return null;
      const lead: Lead = { ...current, firstMessageVariantId: variantId, updatedAt: new Date() };
      rows.set(id, lead);
      return lead;
    },

    async update(id, input) {
      const current = rows.get(id);
      if (!current) {
        return null;
      }

      const lead: Lead = { ...current, ...normalize(input), updatedAt: new Date() };
      rows.set(id, lead);
      return lead;
    },
  };
}
