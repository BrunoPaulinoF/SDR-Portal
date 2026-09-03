import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { monitorSettings, sdrConnectionStates } from '../../db/schema.js';
import type { ConnectionMonitorRepository } from './connection-monitor-repository.js';

const SINGLETON = 'default';

export function createDbConnectionMonitorRepository(): ConnectionMonitorRepository {
  return {
    async getSettings() {
      const [row] = await db.select().from(monitorSettings).where(eq(monitorSettings.singleton, SINGLETON)).limit(1);
      return row ?? null;
    },

    async saveSettings(input) {
      const [row] = await db
        .insert(monitorSettings)
        .values({ singleton: SINGLETON, ...input })
        .onConflictDoUpdate({
          target: monitorSettings.singleton,
          set: { ...input, updatedAt: new Date() },
        })
        .returning();

      if (!row) throw new Error('Failed to save monitor settings');
      return row;
    },

    async findState(sdrAgentId) {
      const [row] = await db.select().from(sdrConnectionStates).where(eq(sdrConnectionStates.sdrAgentId, sdrAgentId)).limit(1);
      return row ?? null;
    },

    async listStates() {
      return db.select().from(sdrConnectionStates);
    },

    async saveLeadQueueState(input) {
      await db
        .insert(sdrConnectionStates)
        .values({
          sdrAgentId: input.sdrAgentId,
          // Linha nova criada pela fila: o estado da conexao ainda nao foi lido.
          status: 'unknown',
          pendingLeads: input.pendingLeads,
          leadsAlertAt: input.leadsAlertAt,
        })
        .onConflictDoUpdate({
          target: sdrConnectionStates.sdrAgentId,
          set: { pendingLeads: input.pendingLeads, leadsAlertAt: input.leadsAlertAt, updatedAt: new Date() },
        });
    },

    async markDailyReportSent(dayKey) {
      await db.update(monitorSettings).set({ lastDailyReportOn: dayKey, updatedAt: new Date() }).where(eq(monitorSettings.singleton, SINGLETON));
    },

    async saveState(input) {
      const [row] = await db
        .insert(sdrConnectionStates)
        .values(input)
        .onConflictDoUpdate({
          target: sdrConnectionStates.sdrAgentId,
          set: {
            status: input.status,
            instanceStatus: input.instanceStatus,
            disconnectReason: input.disconnectReason,
            lastCheckedAt: input.lastCheckedAt,
            lastConnectedAt: input.lastConnectedAt,
            disconnectedAt: input.disconnectedAt,
            lastAlertAt: input.lastAlertAt,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!row) throw new Error('Failed to save SDR connection state');
      return row;
    },
  };
}
