/**
 * Isola a suite do ambiente da maquina. Quem roda os testes costuma ter o `.env` de
 * producao carregado no shell — e ai o app monta repositorios de banco em vez dos de
 * memoria e, pior, `resolveAiApiKey` acha uma chave de provedor e faz chamada de verdade
 * (paga, lenta, contra a API real). Os testes ficam vermelhos por motivo nenhum.
 *
 * Este arquivo roda antes de qualquer import de `src/`, entao o singleton de `env.ts`
 * ja nasce com o ambiente limpo.
 */

process.env.NODE_ENV = 'test';

const REMOVED_KEYS = [
  'ADMIN_EMAIL',
  'ADMIN_NAME',
  'ADMIN_PASSWORD',
  'DATABASE_URL',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SCHEDULER_ENABLED',
  'UAZAPI_ADMIN_TOKEN',
  'UAZAPI_BASE_URL',
  'WEBHOOK_SHARED_SECRET',
  'WEB_RESEARCH_API_KEY',
  'WEB_RESEARCH_ENDPOINT',
];

for (const key of REMOVED_KEYS) {
  delete process.env[key];
}
