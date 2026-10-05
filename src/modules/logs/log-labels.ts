/**
 * Nomes em portugues para o que as tabelas de registro guardam em codigo. A tela Registros
 * mostra estes; o valor cru continua nos "Detalhes tecnicos" de cada linha. Nome que nao esta
 * aqui aparece como esta gravado — melhor do que sumir.
 */

export const JOB_LABELS: Record<string, string> = {
  'initial-outreach': 'Primeira mensagem',
  'followup-outreach': 'Follow-up',
  'pending-reply': 'Resposta pendente',
  'handoff-notify': 'Aviso de handoff',
  'channel-limits': 'Limites do WhatsApp',
  'connection-monitor': 'Monitor de conexao',
  'lead-queue-monitor': 'Fila de leads',
  'daily-report': 'Relatorio diario',
  'reset-conversation': 'Conversa reiniciada',
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  completed: 'Concluido',
  failed: 'Falhou',
  skipped: 'Pulado',
  running: 'Rodando',
};

export const AI_PURPOSE_LABELS: Record<string, string> = {
  reply_generation: 'Resposta ao lead',
  first_message_generation: 'Primeira mensagem',
  followup_message_generation: 'Follow-up',
  bump_message_generation: 'Segundo toque',
  lead_fit_assessment: 'Qualificacao do lead',
  lead_research: 'Pesquisa do lead',
  prompt_generation: 'IA auxiliar de prompt',
  audio_generation: 'Audio (voz)',
};

export const WEBHOOK_STATUS_LABELS: Record<string, string> = {
  received: 'Recebido',
  processed: 'Processado',
  ignored: 'Ignorado',
  failed: 'Falhou',
};

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  messages: 'Mensagem',
  messages_update: 'Atualizacao de mensagem',
  connection: 'Conexao',
  presence: 'Digitando',
  chats: 'Conversa',
  contacts: 'Contato',
};

export function labelOf(labels: Record<string, string>, value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  return labels[value] ?? value;
}

/** Padroes de erro que aparecem de verdade nos registros, do mais especifico para o mais geral. */
const ERROR_PATTERNS: Array<{ test: RegExp; text: string }> = [
  { test: /\b463\b|REACHOUT_TIMELOCK|reachout/i, text: 'O WhatsApp bloqueou novas conversas deste numero por um tempo.' },
  { test: /library voices|payment_required|HTTP 402|insufficient_quota|credit/i, text: 'Sem credito ou sem permissao no servico (IA ou voz).' },
  { test: /HTTP 401|unauthorized|invalid api key|logged out/i, text: 'Acesso recusado: chave ou token invalido, ou WhatsApp deslogado.' },
  { test: /HTTP 429|rate limit|too many requests/i, text: 'Muitas chamadas em pouco tempo: o servico pediu para esperar.' },
  { test: /not on whatsapp|not exists on whatsapp|chat not found|invalid number/i, text: 'O numero nao existe no WhatsApp.' },
  { test: /timeout|timed out|ETIMEDOUT|aborted/i, text: 'O servico demorou demais para responder.' },
  { test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|socket hang up/i, text: 'Nao deu para falar com o servico (fora do ar ou endereco errado).' },
  { test: /HTTP 5\d\d|returned 5\d\d|status 5\d\d/i, text: 'O servico externo falhou do lado dele. Costuma passar sozinho.' },
  { test: /disconnected|not connected/i, text: 'O WhatsApp do SDR esta desconectado.' },
  { test: /JSON|Unexpected token|parse/i, text: 'A IA respondeu fora do formato esperado.' },
  { test: /Cannot read propert|is not a function|is not defined|TypeError/i, text: 'Erro interno do portal ao processar. Os detalhes tecnicos ajudam quem cuida do sistema.' },
];

/**
 * O erro em uma frase que qualquer pessoa entende. Erro que o portal ja grava em portugues
 * ("consulta de limites falhou: ...") passa como esta; o texto cru fica nos detalhes.
 */
export function friendlyError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = ERROR_PATTERNS.find((pattern) => pattern.test.test(raw));
  if (match) return match.text;
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
}
