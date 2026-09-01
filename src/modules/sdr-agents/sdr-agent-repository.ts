import { randomUUID } from 'node:crypto';

import type { NewSdrAgent, SdrAgent } from '../../db/schema.js';
import { DEFAULT_SDR_PLAYBOOK } from '../ai/sdr-playbooks.js';

export type SdrAgentInput = Omit<NewSdrAgent, 'id' | 'createdAt' | 'updatedAt'>;

export interface UazapiInstanceInput {
  baseUrl: string;
  instanceId: string | null;
  tokenEncrypted: string;
}

export interface SdrAgentRepository {
  create(input: SdrAgentInput): Promise<SdrAgent>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<SdrAgent | null>;
  list(): Promise<SdrAgent[]>;
  setActive(id: string, isActive: boolean): Promise<SdrAgent | null>;
  setFirstMessageMode(id: string, mode: string): Promise<SdrAgent | null>;
  /** Troca so as credenciais UAZAPI, sem passar pelo formulario inteiro do SDR. */
  setUazapiInstance(id: string, input: UazapiInstanceInput): Promise<SdrAgent | null>;
  update(id: string, input: SdrAgentInput): Promise<SdrAgent | null>;
}

function nullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function withDefaults(input: SdrAgentInput): Omit<SdrAgent, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    companyId: input.companyId,
    name: input.name,
    displayName: input.displayName,
    isActive: input.isActive ?? false,
    productName: nullable(input.productName),
    productDescription: nullable(input.productDescription),
    offerDescription: nullable(input.offerDescription),
    prompt: nullable(input.prompt),
    firstMessagePrompt: nullable(input.firstMessagePrompt),
    leadQualificationPrompt: nullable(input.leadQualificationPrompt),
    followupPrompt: nullable(input.followupPrompt),
    bumpPrompt: nullable(input.bumpPrompt),
    firstMessageMode: input.firstMessageMode ?? 'ai',
    playbook: input.playbook ?? DEFAULT_SDR_PLAYBOOK,
    aiProvider: input.aiProvider ?? 'deepseek',
    aiModel: input.aiModel ?? 'deepseek-v4-pro',
    aiTemperature: input.aiTemperature ?? 0.4,
    aiMaxOutputTokens: input.aiMaxOutputTokens ?? 800,
    aiReasoningEffort: input.aiReasoningEffort ?? 'default',
    openaiApiKeyEncrypted: nullable(input.openaiApiKeyEncrypted),
    openrouterApiKeyEncrypted: nullable(input.openrouterApiKeyEncrypted),
    deepseekApiKeyEncrypted: nullable(input.deepseekApiKeyEncrypted),
    uazapiBaseUrl: nullable(input.uazapiBaseUrl),
    uazapiInstanceId: nullable(input.uazapiInstanceId),
    uazapiInstanceTokenEncrypted: nullable(input.uazapiInstanceTokenEncrypted),
    uazapiAdminTokenEncrypted: nullable(input.uazapiAdminTokenEncrypted),
    whatsappNumber: nullable(input.whatsappNumber),
    timezone: input.timezone ?? 'America/Sao_Paulo',
    sendWindowStart: input.sendWindowStart ?? '08:00',
    sendWindowEnd: input.sendWindowEnd ?? '18:00',
    sendDaysOfWeek: input.sendDaysOfWeek ?? '1,2,3,4,5',
    initialCooldownMinMinutes: input.initialCooldownMinMinutes ?? 5,
    initialCooldownMaxMinutes: input.initialCooldownMaxMinutes ?? 15,
    followupEnabled: input.followupEnabled ?? true,
    followupAfterHours: input.followupAfterHours ?? 24,
    followupCooldownMinMinutes: input.followupCooldownMinMinutes ?? 10,
    followupCooldownMaxMinutes: input.followupCooldownMaxMinutes ?? 30,
    dailyInitialSendLimit: input.dailyInitialSendLimit ?? 25,
    dailyFollowupSendLimit: input.dailyFollowupSendLimit ?? 50,
    responseDelayBaseMs: input.responseDelayBaseMs ?? 1200,
    responseDelayPerCharMs: input.responseDelayPerCharMs ?? 35,
    responseDelayMaxMs: input.responseDelayMaxMs ?? 12000,
    messageSplitMaxChars: input.messageSplitMaxChars ?? 450,
    humanPauseHours: input.humanPauseHours ?? 24,
    handoffName: nullable(input.handoffName),
    handoffPhone: nullable(input.handoffPhone),
    handoffMessageTemplate: nullable(input.handoffMessageTemplate),
    demoContactName: nullable(input.demoContactName),
    demoContactPhone: nullable(input.demoContactPhone),
  };
}

export function createMemorySdrAgentRepository(seedAgents: SdrAgent[] = []): SdrAgentRepository {
  const rows = new Map<string, SdrAgent>();

  for (const agent of seedAgents) {
    rows.set(agent.id, agent);
  }

  return {
    async create(input) {
      const now = new Date();
      const agent: SdrAgent = {
        id: randomUUID(),
        ...withDefaults(input),
        createdAt: now,
        updatedAt: now,
      };

      rows.set(agent.id, agent);
      return agent;
    },

    async delete(id) {
      rows.delete(id);
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },

    async list() {
      return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    async setActive(id, isActive) {
      const current = rows.get(id);

      if (!current) {
        return null;
      }

      const updated: SdrAgent = { ...current, isActive, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },

    async setFirstMessageMode(id, mode) {
      const current = rows.get(id);

      if (!current) {
        return null;
      }

      const updated: SdrAgent = { ...current, firstMessageMode: mode, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },

    async setUazapiInstance(id, input) {
      const current = rows.get(id);

      if (!current) {
        return null;
      }

      const updated: SdrAgent = {
        ...current,
        uazapiBaseUrl: input.baseUrl,
        uazapiInstanceId: input.instanceId,
        uazapiInstanceTokenEncrypted: input.tokenEncrypted,
        updatedAt: new Date(),
      };
      rows.set(id, updated);
      return updated;
    },

    async update(id, input) {
      const current = rows.get(id);

      if (!current) {
        return null;
      }

      const updated: SdrAgent = {
        ...current,
        ...withDefaults(input),
        updatedAt: new Date(),
      };

      rows.set(id, updated);
      return updated;
    },
  };
}
