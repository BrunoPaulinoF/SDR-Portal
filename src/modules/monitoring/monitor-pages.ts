import type { MonitorSettings, SdrAgent, SdrConnectionState } from '../../db/schema.js';
import { formatWhatsappNumber } from '../phone/whatsapp-number.js';
import { formatDateTimeInTimeZone } from '../timezone.js';
import type { InstanceConnectionState } from '../uazapi/instance-provisioning.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import { defaultAlertTemplate, defaultRecoveryTemplate } from './alert-message.js';
import { parseAlertRecipients } from './alert-recipients.js';
import { DEFAULT_DAILY_REPORT_TIME, DEFAULT_REPEAT_ALERT_MINUTES } from './connection-monitor-repository.js';
import type { MonitorRunResult } from './connection-monitor-service.js';
import type { DailyReportResult } from './daily-report-service.js';
import { defaultDailyReportTemplate } from './daily-report-message.js';
import { defaultLeadQueueTemplate } from './lead-queue-message.js';
import type { LeadQueueResult } from './lead-queue-monitor-service.js';

/**
 * O Monitor faz tres coisas diferentes — avisar queda do WhatsApp, avisar fila de leads no fim e
 * mandar o relatorio do dia — e todas saem pelo mesmo numero para as mesmas pessoas. Antes era um
 * formulario so, com 16 campos misturados; agora cada aviso tem a sua aba e o numero e os
 * destinatarios ficam numa quarta, que vale para os tres.
 */
export const MONITOR_TABS = ['queda', 'fila', 'relatorio', 'numero'] as const;
export type MonitorTab = (typeof MONITOR_TABS)[number];

const MONITOR_TAB_LABELS: Record<MonitorTab, string> = {
  queda: 'Queda do WhatsApp',
  fila: 'Fila de leads',
  relatorio: 'Relatorio diario',
  numero: 'Numero e destinatarios',
};

/** Campos que cada aba salva. Os das outras abas ficam como estao gravados. */
export const MONITOR_TAB_FIELDS: Record<MonitorTab, readonly string[]> = {
  queda: ['repeatAlertMinutes', 'notifyOnRecovery', 'alertTemplate', 'recoveryTemplate'],
  fila: ['leadsAlertEnabled', 'leadsAlertThreshold', 'leadsAlertTemplate'],
  relatorio: ['dailyReportEnabled', 'dailyReportTime', 'dailyReportTemplate'],
  numero: ['isEnabled', 'onlyActiveAgents', 'uazapiBaseUrl', 'uazapiInstanceId', 'uazapiInstanceTokenEncrypted', 'alertRecipients'],
};

export const MONITOR_CHECKBOXES = new Set(['isEnabled', 'onlyActiveAgents', 'notifyOnRecovery', 'leadsAlertEnabled', 'dailyReportEnabled']);

export function resolveMonitorTab(value: unknown): MonitorTab {
  return typeof value === 'string' && (MONITOR_TABS as readonly string[]).includes(value) ? (value as MonitorTab) : 'queda';
}

export interface MonitorPageData {
  tab?: MonitorTab;
  settings: MonitorSettings | null;
  agents: SdrAgent[];
  states: SdrConnectionState[];
  timeZone: string;
  portalUrl: string | null;
  webhookUrlHint: string | null;
  /** Dia do ultimo relatorio enviado, so para a tela. */
  lastDailyReportOn?: string | null;
  error?: string;
  notice?: string;
  runResult?: MonitorRunResult;
  /** Preenchido so depois de alguem pedir o QR do numero do monitor. */
  qr?: InstanceConnectionState;
  /** Preenchido so depois de alguem pedir o relatorio na mao. */
  reportResult?: DailyReportResult;
  /** Preenchido so depois de alguem conferir a fila na mao. */
  leadQueueResult?: LeadQueueResult;
}

function pill(status: string | null, label: string): string {
  const tone = status === 'connected' ? 'status-on' : status === 'disconnected' ? 'status-danger' : 'status-off';
  return `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
}

function renderStatesTable(data: MonitorPageData): string {
  const byAgent = new Map(data.states.map((state) => [state.sdrAgentId, state]));
  const monitored = data.agents.filter((agent) => agent.uazapiBaseUrl && agent.uazapiInstanceTokenEncrypted);

  if (monitored.length === 0) {
    return '<p class="muted">Nenhum SDR com instancia UAZAPI cadastrada — nao ha o que vigiar ainda.</p>';
  }

  const rows = monitored
    .map((agent) => {
      const state = byAgent.get(agent.id) ?? null;
      const label = state?.status === 'connected' ? 'conectado' : state?.status === 'disconnected' ? 'desconectado' : 'sem leitura';
      const since = state?.status === 'disconnected' ? state.disconnectedAt : state?.lastConnectedAt;

      return `<tr>
        <td>${escapeHtml(agent.name)}${agent.isActive ? '' : ' <span class="status-pill status-off">SDR desligado</span>'}</td>
        <td>${escapeHtml(formatWhatsappNumber(agent.whatsappNumber) || '-')}</td>
        <td>${pill(state?.status ?? null, label)}${state?.instanceStatus ? `<br><span class="muted">${escapeHtml(state.instanceStatus)}</span>` : ''}</td>
        <td>${escapeHtml(formatDateTimeInTimeZone(since ?? null, data.timeZone))}</td>
        <td>${escapeHtml(formatDateTimeInTimeZone(state?.lastCheckedAt ?? null, data.timeZone))}</td>
        <td>${state?.pendingLeads === null || state?.pendingLeads === undefined ? '-' : String(state.pendingLeads)}</td>
        <td>${escapeHtml(state?.disconnectReason ?? '-')}</td>
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table>
    <thead>
      <tr>
        <th>SDR</th>
        <th>WhatsApp</th>
        <th>Estado</th>
        <th>Desde</th>
        <th>Ultima leitura</th>
        <th>Fila</th>
        <th>Motivo da queda</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderRunResult(result: MonitorRunResult | undefined): string {
  if (!result) return '';

  if (result.skipped) {
    return `<div class="alert-error">${escapeHtml(result.skipped)}</div>`;
  }

  const lines = [
    `SDRs verificados: ${result.checked}`,
    `Caiu agora: ${result.disconnected.length ? result.disconnected.join(', ') : 'nenhum'}`,
    `Voltou agora: ${result.recovered.length ? result.recovered.join(', ') : 'nenhum'}`,
    `Avisos entregues: ${result.alertsSent} de ${result.recipients} numero(s)`,
  ];
  const errors = result.errors.length ? `<div class="alert-error">${escapeHtml(result.errors.join(' | '))}</div>` : '';

  return `${errors}<section class="panel">
    <h2>Ultima verificacao</h2>
    <p>${lines.map((line) => escapeHtml(line)).join('<br>')}</p>
  </section>`;
}

/**
 * O QR do numero que envia os alertas. O SVG e gerado aqui dentro (biblioteca qrcode) ou e
 * um `<img>` com data URI montado a partir do que a UAZAPI devolveu — nao ha texto de
 * usuario dentro, por isso entra sem escape. Sem renovacao automatica: a UAZAPI expira o
 * codigo em segundos, entao quem perder o tempo clica no botao de novo.
 */
function renderMonitorQr(qr: InstanceConnectionState | undefined): string {
  if (!qr) return '';

  if (qr.connected) {
    return '<section class="panel"><h2>Numero do monitor</h2><p>WhatsApp do monitor conectado.</p></section>';
  }

  const body = qr.qrCodeSvg
    ? `${qr.qrCodeSvg}
      ${qr.pairCode ? `<p class="muted">Ou use o codigo de pareamento: <strong>${escapeHtml(qr.pairCode)}</strong></p>` : ''}
      <p class="muted">Leia com o celular que vai enviar os alertas. O codigo expira em segundos — se perder, gere outro.</p>`
    : `<p class="muted">Nao deu para gerar o QR code agora. Status atual: ${escapeHtml(qr.status ?? 'desconhecido')}</p>
      ${qr.detail ? `<p class="muted">${escapeHtml(qr.detail)}</p>` : ''}`;

  return `<section class="panel"><h2>Numero do monitor</h2>${body}</section>`;
}

function renderReportResult(result: DailyReportResult | undefined): string {
  if (!result) return '';

  if (result.skipped) return `<div class="alert-error">${escapeHtml(result.skipped)}</div>`;

  return `<section class="panel">
    <h2>Relatorio enviado</h2>
    <p>${escapeHtml(`Entregue para ${result.sent} de ${result.recipients} numero(s).`)}</p>
    ${result.message ? `<pre>${escapeHtml(result.message)}</pre>` : ''}
  </section>`;
}

function renderLeadQueueResult(result: LeadQueueResult | undefined): string {
  if (!result) return '';
  if (result.skipped) return `<div class="alert-error">${escapeHtml(result.skipped)}</div>`;

  const filas = result.queues.map((fila) => `${fila.name}: ${fila.pendingLeads} lead(s)`).join('<br>');

  return `<section class="panel">
    <h2>Fila de leads</h2>
    <p>${filas || 'Nenhum SDR vigiado.'}</p>
    <p class="muted">${escapeHtml(
      `Acabou agora: ${result.emptied.length ? result.emptied.map((sdr) => sdr.name).join(', ') : 'nenhum'} · ` +
        `Voltou a encher: ${result.refilled.length ? result.refilled.join(', ') : 'nenhum'} · ` +
        `Avisos entregues: ${result.alertsSent} de ${result.recipients} numero(s)`,
    )}</p>
  </section>`;
}

function renderTabForm(tab: MonitorTab, content: string): string {
  return `<form method="post" action="/monitoring/aba/${tab}" class="form-grid">
    ${content}
    <div class="actions field-full"><button type="submit">Salvar ${escapeHtml(MONITOR_TAB_LABELS[tab])}</button></div>
  </form>`;
}

/** Botao que roda na hora e mostra o resultado no quadro logo abaixo (`/app.js`). */
function inlineAction(action: string, label: string, target: string): string {
  return `<form method="post" action="${action}" data-inline-result="${target}"><button class="button button-secondary" type="submit">${escapeHtml(label)}</button></form>`;
}

function renderQuedaTab(data: MonitorPageData): string {
  const settings = data.settings;
  const webhookHint = data.webhookUrlHint
    ? `<p class="muted">Alem da verificacao a cada 5 minutos, a UAZAPI avisa a queda na hora pelo webhook de cada SDR (botao <em>Configurar webhook</em> na aba WhatsApp do SDR).</p>`
    : '<p class="muted">Sem APP_URL no ambiente a UAZAPI nao consegue avisar a queda na hora: vale so a verificacao a cada 5 minutos.</p>';
  return `<section class="panel tab-section">
    <h2>Como estao os WhatsApps</h2>
    <div class="actions">${inlineAction('/monitoring/run', 'Verificar agora', 'resultado-monitor')}</div>
    <div id="resultado-monitor" class="action-result" aria-live="polite"></div>
    ${renderStatesTable(data)}
  </section>
  <section class="panel tab-section">
    <h2>Aviso de queda</h2>
    <p class="muted">Quando o WhatsApp de um SDR cai, quem esta na aba Numero e destinatarios recebe uma mensagem.</p>
    ${webhookHint}
    ${renderTabForm(
      'queda',
      `<div class="field">
        <label for="repeatAlertMinutes">Repetir o aviso a cada (minutos, 0 = so na queda)</label>
        <input id="repeatAlertMinutes" name="repeatAlertMinutes" type="number" min="0" value="${settings?.repeatAlertMinutes ?? DEFAULT_REPEAT_ALERT_MINUTES}">
        ${settings?.repeatAlertMinutes === 0 ? '<p class="muted">Com 0, o aviso sai uma vez so: se ninguem vir, o SDR fica fora do ar em silencio. Foi assim que um SDR passou 30 dias desconectado em setembro.</p>' : ''}
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="notifyOnRecovery" ${settings?.notifyOnRecovery ?? true ? 'checked' : ''}> Avisar tambem quando o WhatsApp voltar</label>
      <div class="field field-full">
        <label for="alertTemplate">Mensagem de queda (vazio usa o padrao)</label>
        <textarea id="alertTemplate" name="alertTemplate" rows="7" placeholder="${escapeHtml(defaultAlertTemplate(data.portalUrl))}">${escapeHtml(settings?.alertTemplate ?? '')}</textarea>
        <p class="muted">Marcadores: <code>{sdrs}</code> (lista com nome, hora e motivo), <code>{total}</code>, <code>{data}</code>, <code>{hora}</code>, <code>{portal}</code>.</p>
      </div>
      <div class="field field-full">
        <label for="recoveryTemplate">Mensagem de volta (vazio usa o padrao)</label>
        <textarea id="recoveryTemplate" name="recoveryTemplate" rows="6" placeholder="${escapeHtml(defaultRecoveryTemplate())}">${escapeHtml(settings?.recoveryTemplate ?? '')}</textarea>
      </div>`,
    )}
  </section>`;
}

function renderFilaTab(data: MonitorPageData): string {
  const settings = data.settings;
  return `<section class="panel tab-section">
    <h2>Aviso de fila no fim</h2>
    <p class="muted">Avisa quando a fila de leads de um SDR chega no limite, para dar tempo de importar mais antes de a prospeccao parar.</p>
    <div class="actions">${inlineAction('/monitoring/leads', 'Conferir fila agora', 'resultado-fila')}</div>
    <div id="resultado-fila" class="action-result" aria-live="polite"></div>
    ${renderTabForm(
      'fila',
      `<label class="checkbox-field field-full"><input type="checkbox" name="leadsAlertEnabled" ${settings?.leadsAlertEnabled ? 'checked' : ''}> Avisar quando a fila de um SDR acabar</label>
      <div class="field">
        <label for="leadsAlertThreshold">Avisar quando a fila chegar a (leads)</label>
        <input id="leadsAlertThreshold" name="leadsAlertThreshold" type="number" min="0" value="${settings?.leadsAlertThreshold ?? 0}">
        <p class="muted">0 avisa so quando zerar. Um numero maior avisa antes de acabar, dando tempo de importar.</p>
      </div>
      <div class="field field-full">
        <label for="leadsAlertTemplate">Mensagem da fila (vazio usa o padrao)</label>
        <textarea id="leadsAlertTemplate" name="leadsAlertTemplate" rows="5" placeholder="${escapeHtml(defaultLeadQueueTemplate(data.portalUrl))}">${escapeHtml(settings?.leadsAlertTemplate ?? '')}</textarea>
        <p class="muted">Marcadores: <code>{sdrs}</code>, <code>{data}</code>, <code>{hora}</code>, <code>{portal}</code>.</p>
      </div>`,
    )}
  </section>`;
}

function renderRelatorioTab(data: MonitorPageData): string {
  const settings = data.settings;
  return `<section class="panel tab-section">
    <h2>Relatorio do fim do dia</h2>
    <p class="muted">Uma mensagem por dia com o que cada SDR ativo fez: prospectados, responderam, passados para o time, reunioes e clientes.</p>
    <div class="actions">${inlineAction('/monitoring/report', 'Enviar relatorio agora', 'resultado-relatorio')}</div>
    <div id="resultado-relatorio" class="action-result" aria-live="polite"></div>
    ${renderTabForm(
      'relatorio',
      `<label class="checkbox-field field-full"><input type="checkbox" name="dailyReportEnabled" ${settings?.dailyReportEnabled ? 'checked' : ''}> Enviar o relatorio todo dia</label>
      <div class="field">
        <label for="dailyReportTime">Hora do relatorio</label>
        <input id="dailyReportTime" name="dailyReportTime" type="time" value="${escapeHtml(settings?.dailyReportTime ?? DEFAULT_DAILY_REPORT_TIME)}">
        <p class="muted">Fuso do portal (${escapeHtml(data.timeZone)}). Sai na primeira verificacao depois dessa hora, uma vez por dia.${data.lastDailyReportOn ? ` Ultimo envio: ${escapeHtml(data.lastDailyReportOn)}.` : ''}</p>
      </div>
      <div class="field field-full">
        <label for="dailyReportTemplate">Texto do relatorio (vazio usa o padrao)</label>
        <textarea id="dailyReportTemplate" name="dailyReportTemplate" rows="6" placeholder="${escapeHtml(defaultDailyReportTemplate())}">${escapeHtml(settings?.dailyReportTemplate ?? '')}</textarea>
        <p class="muted">Marcadores: <code>{sdrs}</code> (um bloco por SDR ativo), <code>{totais}</code>, <code>{data}</code>, <code>{hora}</code>, <code>{portal}</code>.</p>
      </div>`,
    )}
  </section>`;
}

function renderNumeroTab(data: MonitorPageData): string {
  const settings = data.settings;
  const recipients = settings?.alertRecipients ?? '';
  const recipientCount = parseAlertRecipients(recipients).length;
  const tokenSaved = Boolean(settings?.uazapiInstanceTokenEncrypted);
  return `${renderMonitorQr(data.qr)}
  <section class="panel tab-section">
    <h2>Numero que envia e quem recebe</h2>
    <p class="muted">Um WhatsApp separado, que nao e de nenhum SDR, manda os tres avisos para os numeros abaixo.</p>
    <div class="actions">
      <form method="post" action="/monitoring/qr"><button class="button button-secondary" type="submit">Conectar numero do monitor</button></form>
      ${inlineAction('/monitoring/test', 'Enviar mensagem de teste', 'resultado-teste')}
    </div>
    <div id="resultado-teste" class="action-result" aria-live="polite"></div>
    ${renderTabForm(
      'numero',
      `<label class="checkbox-field field-full"><input type="checkbox" name="isEnabled" ${settings?.isEnabled ? 'checked' : ''}> Monitor ligado (vale para os tres avisos)</label>
      <label class="checkbox-field field-full"><input type="checkbox" name="onlyActiveAgents" ${settings?.onlyActiveAgents ?? true ? 'checked' : ''}> Vigiar so os SDRs ativos no portal</label>
      <div class="field field-full">
        <label for="alertRecipients">Numeros que recebem os avisos (um por linha)</label>
        <textarea id="alertRecipients" name="alertRecipients" rows="4" placeholder="5519999999999">${escapeHtml(recipients)}</textarea>
        <p class="muted">${recipientCount} numero(s) validos hoje.</p>
      </div>
      <div class="field">
        <label for="uazapiBaseUrl">URL base da UAZAPI do monitor</label>
        <input id="uazapiBaseUrl" name="uazapiBaseUrl" value="${escapeHtml(settings?.uazapiBaseUrl ?? '')}" placeholder="https://seu-servidor.uazapi.com">
      </div>
      <div class="field">
        <label for="uazapiInstanceId">Instancia do monitor (opcional)</label>
        <input id="uazapiInstanceId" name="uazapiInstanceId" value="${escapeHtml(settings?.uazapiInstanceId ?? '')}">
      </div>
      <div class="field">
        <label for="uazapiInstanceTokenEncrypted">Token da instancia do monitor</label>
        <input id="uazapiInstanceTokenEncrypted" name="uazapiInstanceTokenEncrypted" type="password" autocomplete="off" placeholder="${tokenSaved ? 'Token salvo - preencha so para trocar' : 'Token da instancia que envia os avisos'}">
      </div>`,
    )}
  </section>`;
}

export function renderMonitorPage(data: MonitorPageData): string {
  const tab = data.tab ?? 'queda';
  const settings = data.settings;
  const errorHtml = data.error ? `<div class="alert-error">${escapeHtml(data.error)}</div>` : '';
  const noticeHtml = data.notice ? `<section class="panel"><p>${escapeHtml(data.notice)}</p></section>` : '';
  const offNotice =
    !settings?.isEnabled && tab !== 'numero'
      ? `<section class="panel"><p class="alert-error">O monitor esta desligado: nenhum dos tres avisos sai. Ligue na aba <a href="/monitoring?aba=numero">Numero e destinatarios</a>.</p></section>`
      : '';
  const tabs = MONITOR_TABS.map(
    (item) =>
      `<a class="tab${item === tab ? ' tab-active' : ''}" href="/monitoring${item === 'queda' ? '' : `?aba=${item}`}"${item === tab ? ' aria-current="page"' : ''}>${MONITOR_TAB_LABELS[item]}</a>`,
  ).join('');
  const content =
    tab === 'fila' ? renderFilaTab(data) : tab === 'relatorio' ? renderRelatorioTab(data) : tab === 'numero' ? renderNumeroTab(data) : renderQuedaTab(data);

  return renderLayout({
    title: 'Monitor de conexao - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Monitor</h1>
      <p class="muted">Avisa pelo WhatsApp quando um SDR cai, quando a fila de leads acaba e manda o resumo do dia.</p>
    </div>
  </header>
  <nav class="tabs" aria-label="Partes do monitor">${tabs}</nav>
  ${errorHtml}
  ${noticeHtml}
  ${offNotice}
  ${renderRunResult(data.runResult)}
  ${renderReportResult(data.reportResult)}
  ${renderLeadQueueResult(data.leadQueueResult)}
  ${content}
</main>`,
  });
}
