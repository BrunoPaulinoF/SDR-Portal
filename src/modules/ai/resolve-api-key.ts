import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { decryptSecret } from '../security/secrets.js';

export function resolveAiApiKey(agent: Pick<SdrAgent, 'aiProvider' | 'openaiApiKeyEncrypted' | 'openrouterApiKeyEncrypted' | 'deepseekApiKeyEncrypted'>): string | null {
  if (agent.aiProvider === 'openrouter') {
    return agent.openrouterApiKeyEncrypted ? decryptSecret(agent.openrouterApiKeyEncrypted) : (env.OPENROUTER_API_KEY ?? null);
  }
  if (agent.aiProvider === 'deepseek') {
    return agent.deepseekApiKeyEncrypted ? decryptSecret(agent.deepseekApiKeyEncrypted) : (env.DEEPSEEK_API_KEY ?? null);
  }
  return agent.openaiApiKeyEncrypted ? decryptSecret(agent.openaiApiKeyEncrypted) : (env.OPENAI_API_KEY ?? null);
}
