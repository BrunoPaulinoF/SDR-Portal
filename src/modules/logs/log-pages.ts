import type { JobLog, SdrAgent, WebhookEvent } from '../../db/schema.js';
import type { AiRunListItem } from '../ai/ai-run-repository.js';
import { formatWhatsappNumber } from '../phone/whatsapp-number.js';
import { formatDateTimeInTimeZone } from '../timezone.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import {
  AI_PURPOSE_LABELS,
  JOB_LABELS,
  JOB_STATUS_LABELS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_STATUS_LABELS,
  friendlyError,
  labelOf,
} from './log-labels.js';

/**
 * Tela Registros: junta os tres registros tecnicos (tarefas, chamadas de IA, webhooks) numa
 * pagina so, que abre nos erros. Antes eram tres itens de menu em ingles, cada um lendo a tabela
 * inteira e mostrando UUID, nome de job e JSON cru na primeira linha.
 */
export const LOG_TABS = ['erros', 'tarefas', 'ia', 'webhooks'] as const;
export type LogTab = (typeof LOG_TABS)[number];
export const LOGS_PAGE_SIZE = 50;

const TAB_LABELS: Record<LogTab, string> = { erros: 'Erros', tarefas: 'Tarefas', ia: 'IA', webhooks: 'Webhooks' };
const TAB_HELP: Record<LogTab, string> = {
  erros: 'Tudo o que deu errado nas tarefas, na IA e nos webhooks, do mais novo para o mais velho.',
  tarefas: 'Disparos, follow-ups, avisos de handoff e verificacoes automaticas.',
  ia: 'Cada chamada a IA: respostas, primeiras mensagens, follow-ups e qualificacao de leads.',
  webhooks: 'O que a UAZAPI mandou para o portal: mensagens recebidas e mudancas de conexao.',
};

export function resolveLogTab(value: unknown): LogTab {
  return typeof value === 'string' && (LOG_TABS as readonly string[]).includes(value) ? (value as LogTab) : 'erros';
}

export interface LogRow {
  id: string;
  at: Date;
  source: 'Tarefa' | 'IA' | 'Webhook';
  what: string;
  sdrName: string | null;
  leadId: string | null;
  tone: 'ok' | 'muted' | 'failed';
  statusLabel: string;
  summary: string;
  /** Tudo o que esta gravado, para quem precisa investigar. Fica recolhido. */
  technical: string;
}

type SdrNames = ReadonlyMap<string, string>;

function lines(entries: Array<[string, string | number | null | undefined]>): string {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function prettyJson(raw: string, max = 20000): string {
  let text = raw;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Nao e JSON: fica como veio.
  }
  return text.length > max ? `${text.slice(0, max)}\n… (cortado)` : text;
}

export function jobLogRow(log: JobLog, sdrNames: SdrNames): LogRow {
  const failed = log.status === 'failed';
  const statusLabel = labelOf(JOB_STATUS_LABELS, log.status);
  // Pulado com motivo e informacao (canal fora, limite do dia): o motivo e o resumo.
  const summary = friendlyError(log.error) ?? statusLabel;
  // A tela antiga mostrava `payload ?? result` e escondia o `result`, que e onde fica a resposta
  // da UAZAPI numa falha. Os dois vao para os detalhes.
  const technical = [
    lines([
      ['tarefa', log.jobName],
      ['chave', log.jobKey],
      ['tentativa', log.attempt],
      ['situacao', log.status],
      ['erro', log.error],
    ]),
    log.payload ? `payload: ${prettyJson(log.payload)}` : null,
    log.result ? `resultado: ${prettyJson(log.result)}` : null,
  ]
    .filter((block): block is string => Boolean(block))
    .join('\n\n');
  return {
    id: log.id,
    at: log.createdAt,
    source: 'Tarefa',
    what: labelOf(JOB_LABELS, log.jobName),
    sdrName: log.sdrAgentId ? (sdrNames.get(log.sdrAgentId) ?? null) : null,
    leadId: log.leadId,
    tone: failed ? 'failed' : log.status === 'completed' ? 'ok' : 'muted',
    statusLabel,
    summary,
    technical,
  };
}

export function aiRunRow(run: AiRunListItem, sdrNames: SdrNames): LogRow {
  const failed = run.error !== null;
  const seconds = run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1).replace('.', ',')}s` : null;
  const cache = run.promptCacheHitTokens && run.promptTokens ? `${Math.round((run.promptCacheHitTokens / run.promptTokens) * 100)}%` : null;
  return {
    id: run.id,
    at: run.createdAt,
    source: 'IA',
    what: labelOf(AI_PURPOSE_LABELS, run.purpose),
    sdrName: run.sdrAgentId ? (sdrNames.get(run.sdrAgentId) ?? null) : null,
    leadId: run.leadId,
    tone: failed ? 'failed' : 'ok',
    statusLabel: failed ? 'Falhou' : 'OK',
    summary: failed ? (friendlyError(run.error) ?? 'Falhou') : seconds ? `Respondeu em ${seconds}` : 'Respondeu',
    technical: [
      lines([
        ['finalidade', run.purpose],
        ['provedor', run.provider],
        ['modelo', run.model],
        ['tokens (entrada / saida)', run.promptTokens !== null || run.completionTokens !== null ? `${run.promptTokens ?? '-'} / ${run.completionTokens ?? '-'}` : null],
        ['cache do prompt', cache],
        ['tempo', run.latencyMs !== null ? `${run.latencyMs}ms` : null],
        ['erro', run.error],
      ]),
      run.outputText ? `resposta: ${prettyJson(run.outputText)}` : null,
    ]
      .filter((block): block is string => Boolean(block))
      .join('\n\n'),
  };
}

export function webhookRow(event: WebhookEvent, sdrNames: SdrNames): LogRow {
  const failed = event.processingStatus === 'failed';
  const from = event.fromNumber ? formatWhatsappNumber(event.fromNumber) || event.fromNumber : null;
  const summary =
    friendlyError(event.processingError) ?? (event.fromMe ? 'Enviada pelo numero do SDR' : from ? `De ${from}` : labelOf(WEBHOOK_STATUS_LABELS, event.processingStatus));
  return {
    id: event.id,
    at: event.createdAt,
    source: 'Webhook',
    what: labelOf(WEBHOOK_EVENT_LABELS, event.eventType, 'Evento'),
    sdrName: event.sdrAgentId ? (sdrNames.get(event.sdrAgentId) ?? null) : null,
    leadId: null,
    tone: failed ? 'failed' : event.processingStatus === 'processed' ? 'ok' : 'muted',
    statusLabel: labelOf(WEBHOOK_STATUS_LABELS, event.processingStatus),
    summary,
    technical: [
      lines([
        ['evento', event.eventType],
        ['tipo de mensagem', event.messageType],
        ['situacao', event.processingStatus],
        ['erro', event.processingError],
        ['de', event.fromNumber],
        ['para', event.toNumber],
      ]),
      `corpo recebido: ${prettyJson(event.rawBody)}`,
    ].join('\n\n'),
  };
}

export interface LogsView {
  tab: LogTab;
  rows: LogRow[];
  page: number;
  hasNext: boolean;
  sdrAgentId: string;
  onlyErrors: boolean;
  agents: SdrAgent[];
  timeZone: string;
}

function queryString(view: LogsView, overrides: Partial<{ page: number; tab: LogTab }>): string {
  const params = new URLSearchParams();
  const tab = overrides.tab ?? view.tab;
  if (tab !== 'erros') params.set('aba', tab);
  if (view.sdrAgentId) params.set('sdr', view.sdrAgentId);
  if (view.onlyErrors && tab !== 'erros' && overrides.tab === undefined) params.set('erros', '1');
  const page = overrides.page ?? 1;
  if (page > 1) params.set('pagina', String(page));
  const query = params.toString();
  return `/registros${query ? `?${query}` : ''}`;
}

function toneClass(tone: LogRow['tone']): string {
  return tone === 'failed' ? 'status-danger' : tone === 'ok' ? 'status-on' : 'status-off';
}

function renderRow(row: LogRow, view: LogsView): string {
  return `<tr>
    <td>${escapeHtml(formatDateTimeInTimeZone(row.at, view.timeZone))}</td>
    <td>${escapeHtml(row.what)}${view.tab === 'erros' ? `<br><span class="muted">${row.source}</span>` : ''}</td>
    <td>${escapeHtml(row.sdrName ?? '-')}</td>
    <td><span class="status-pill ${toneClass(row.tone)}">${escapeHtml(row.statusLabel)}</span></td>
    <td>${escapeHtml(row.summary)}${row.leadId ? `<br><a href="/leads/${escapeHtml(row.leadId)}">Abrir lead</a>` : ''}</td>
    <td><details><summary>Detalhes tecnicos</summary><pre class="log-technical">${escapeHtml(row.technical)}</pre></details></td>
  </tr>`;
}

export function renderLogsPage(view: LogsView): string {
  const tabs = LOG_TABS.map(
    (tab) =>
      `<a class="tab${tab === view.tab ? ' tab-active' : ''}" href="${escapeHtml(queryString(view, { tab }))}"${tab === view.tab ? ' aria-current="page"' : ''}>${TAB_LABELS[tab]}</a>`,
  ).join('');
  const sdrOptions = [`<option value="">Todos os SDRs</option>`]
    .concat(
      view.agents.map(
        (agent) =>
          `<option value="${escapeHtml(agent.id)}"${agent.id === view.sdrAgentId ? ' selected' : ''}>${escapeHtml(agent.displayName || agent.name)}</option>`,
      ),
    )
    .join('');
  const onlyErrors =
    view.tab === 'erros'
      ? ''
      : `<label class="check-item"><input type="checkbox" name="erros" value="1"${view.onlyErrors ? ' checked' : ''}> So o que deu errado</label>`;
  const filters = `<form method="get" action="/registros" class="filter-bar filter-bar-logs">
    ${view.tab === 'erros' ? '' : `<input type="hidden" name="aba" value="${view.tab}">`}
    <div class="field"><label for="sdr">SDR</label><select id="sdr" name="sdr">${sdrOptions}</select></div>
    ${onlyErrors}
    <div class="actions"><button type="submit">Filtrar</button></div>
  </form>`;

  const empty =
    view.tab === 'erros'
      ? '<section class="panel needs-you-ok"><p>✓ Nenhum erro registrado com esses filtros.</p></section>'
      : '<section class="empty-state"><h2>Nada registrado</h2><p class="muted">Nenhum registro com esses filtros.</p></section>';
  const table = view.rows.length
    ? `<div class="table-wrap"><table class="log-table">
      <thead><tr><th>Quando</th><th>O que</th><th>SDR</th><th>Situacao</th><th>Resumo</th><th>Detalhes</th></tr></thead>
      <tbody>${view.rows.map((row) => renderRow(row, view)).join('')}</tbody>
    </table></div>`
    : empty;
  const pagination =
    view.page > 1 || view.hasNext
      ? `<nav class="pagination">
      ${view.page > 1 ? `<a class="button button-secondary" href="${escapeHtml(queryString(view, { page: view.page - 1 }))}">Mais novos</a>` : ''}
      <span class="muted">Pagina ${view.page}</span>
      ${view.hasNext ? `<a class="button button-secondary" href="${escapeHtml(queryString(view, { page: view.page + 1 }))}">Mais antigos</a>` : ''}
    </nav>`
      : '';

  return renderLayout({
    title: 'Registros - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Registros</h1>
      <p class="muted">O que o sistema fez por tras, do mais novo para o mais velho. Serve para investigar quando algo nao saiu como esperado.</p>
    </div>
  </header>
  <nav class="tabs" aria-label="Tipo de registro">${tabs}</nav>
  <p class="muted tab-intro">${escapeHtml(TAB_HELP[view.tab])}</p>
  ${filters}
  ${table}
  ${pagination}
</main>`,
  });
}
