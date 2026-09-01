import { randomUUID } from 'node:crypto';

import type { MonitorSettings, SdrConnectionState } from '../../db/schema.js';

/** Os dois estados que o alerta enxerga: o `status` cru da UAZAPI vai separado. */
export type ConnectionStatus = 'connected' | 'disconnected';

export interface MonitorSettingsInput {
  isEnabled: boolean;
  uazapiBaseUrl: string | null;
  uazapiInstanceId: string | null;
  uazapiInstanceTokenEncrypted: string | null;
  alertRecipients: string | null;
  alertTemplate: string | null;
  recoveryTemplate: string | null;
  notifyOnRecovery: boolean;
  repeatAlertMinutes: number;
  onlyActiveAgents: boolean;
}

export interface ConnectionStateInput {
  sdrAgentId: string;
  status: ConnectionStatus;
  instanceStatus: string | null;
  disconnectReason: string | null;
  lastCheckedAt: Date;
  lastConnectedAt: Date | null;
  disconnectedAt: Date | null;
  lastAlertAt: Date | null;
}

export interface ConnectionMonitorRepository {
  getSettings(): Promise<MonitorSettings | null>;
  saveSettings(input: MonitorSettingsInput): Promise<MonitorSettings>;
  findState(sdrAgentId: string): Promise<SdrConnectionState | null>;
  listStates(): Promise<SdrConnectionState[]>;
  /** Uma linha por SDR: grava o estado novo por cima do anterior. */
  saveState(input: ConnectionStateInput): Promise<SdrConnectionState>;
}

export const DEFAULT_REPEAT_ALERT_MINUTES = 60;

/** Padrao usado enquanto ninguem salvou a tela: monitor desligado e sem instancia. */
export function defaultMonitorSettings(): MonitorSettingsInput {
  return {
    isEnabled: false,
    uazapiBaseUrl: null,
    uazapiInstanceId: null,
    uazapiInstanceTokenEncrypted: null,
    alertRecipients: null,
    alertTemplate: null,
    recoveryTemplate: null,
    notifyOnRecovery: true,
    repeatAlertMinutes: DEFAULT_REPEAT_ALERT_MINUTES,
    onlyActiveAgents: true,
  };
}

export function createMemoryConnectionMonitorRepository(
  seedSettings: MonitorSettings | null = null,
  seedStates: SdrConnectionState[] = [],
): ConnectionMonitorRepository {
  let settings = seedSettings;
  const states = new Map<string, SdrConnectionState>();

  for (const state of seedStates) {
    states.set(state.sdrAgentId, state);
  }

  return {
    async getSettings() {
      return settings;
    },

    async saveSettings(input) {
      const now = new Date();
      settings = {
        id: settings?.id ?? randomUUID(),
        singleton: 'default',
        ...input,
        createdAt: settings?.createdAt ?? now,
        updatedAt: now,
      };
      return settings;
    },

    async findState(sdrAgentId) {
      return states.get(sdrAgentId) ?? null;
    },

    async listStates() {
      return [...states.values()];
    },

    async saveState(input) {
      const current = states.get(input.sdrAgentId);
      const now = new Date();
      const state: SdrConnectionState = {
        id: current?.id ?? randomUUID(),
        ...input,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };

      states.set(input.sdrAgentId, state);
      return state;
    },
  };
}
