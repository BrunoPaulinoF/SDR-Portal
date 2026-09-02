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

export interface MonitorPageData {
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
      const label = state ? (state.status === 'connected' ? 'conectado' : 'desconectado') : 'sem leitura';
      const since = state?.status === 'disconnected' ? state.disconnectedAt : state?.lastConnectedAt;

      return `<tr>
        <td>${escapeHtml(agent.name)}${agent.isActive ? '' : ' <span class="status-pill status-off">SDR desligado</span>'}</td>
        <td>${escapeHtml(formatWhatsappNumber(agent.whatsappNumber) || '-')}</td>
        <td>${pill(state?.status ?? null, label)}${state?.instanceStatus ? `<br><span class="muted">${escapeHtml(state.instanceStatus)}</span>` : ''}</td>
        <td>${escapeHtml(formatDateTimeInTimeZone(since ?? null, data.timeZone))}</td>
        <td>${escapeHtml(formatDateTimeInTimeZone(state?.lastCheckedAt ?? null, data.timeZone))}</td>
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

export function renderMonitorPage(data: MonitorPageData): string {
  const settings = data.settings;
  const recipients = settings?.alertRecipients ?? '';
  const recipientCount = parseAlertRecipients(recipients).length;
  const tokenSaved = Boolean(settings?.uazapiInstanceTokenEncrypted);
  const errorHtml = data.error ? `<div class="alert-error">${escapeHtml(data.error)}</div>` : '';
  const noticeHtml = data.notice ? `<section class="panel"><p>${escapeHtml(data.notice)}</p></section>` : '';
  const webhookHint = data.webhookUrlHint
    ? `<p class="muted">O webhook <strong>connection</strong> de cada SDR ja chega em <code>${escapeHtml(data.webhookUrlHint)}</code> e dispara a verificacao daquele SDR na hora, sem esperar o tick. Use o botao <em>Configurar webhook</em> na tela do SDR para registrar os eventos na UAZAPI.</p>`
    : '<p class="muted">Configure APP_URL no ambiente para que a UAZAPI consiga avisar as quedas por webhook, alem do tick de 5 minutos.</p>';

  return renderLayout({
    title: 'Monitor de conexao - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Monitor de conexao</h1>
      <p class="muted">Uma instancia WhatsApp separada vigia os numeros dos SDRs e avisa quem voce escolher quando algum cair.</p>
    </div>
    <div class="actions">
      <form method="post" action="/monitoring/run" data-inline>
        <button class="button button-secondary" type="submit">Verificar agora</button>
      </form>
      <form method="post" action="/monitoring/test" data-inline>
        <button class="button button-secondary" type="submit">Enviar teste</button>
      </form>
      <form method="post" action="/monitoring/report" data-inline>
        <button class="button button-secondary" type="submit">Enviar relatorio agora</button>
      </form>
      <form method="post" action="/monitoring/qr" data-inline>
        <button class="button button-secondary" type="submit">Conectar numero do monitor</button>
      </form>
    </div>
  </header>
  ${errorHtml}
  ${noticeHtml}
  ${renderRunResult(data.runResult)}
  ${renderMonitorQr(data.qr)}
  ${renderReportResult(data.reportResult)}
  <section class="panel">
    <h2>Estado dos SDRs</h2>
    ${renderStatesTable(data)}
  </section>
  <section class="panel">
    <h2>Configuracao</h2>
    ${webhookHint}
    <form method="post" action="/monitoring" class="form-grid">
      <label class="checkbox-field field-full"><input type="checkbox" name="isEnabled" ${settings?.isEnabled ? 'checked' : ''}> Monitor ligado</label>
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
        <input id="uazapiInstanceTokenEncrypted" name="uazapiInstanceTokenEncrypted" type="password" autocomplete="off" placeholder="${tokenSaved ? 'Token salvo - preencha so para trocar' : 'Token da instancia que envia os alertas'}">
      </div>
      <div class="field">
        <label for="repeatAlertMinutes">Repetir o alerta a cada (minutos, 0 = so na queda)</label>
        <input id="repeatAlertMinutes" name="repeatAlertMinutes" type="number" min="0" value="${settings?.repeatAlertMinutes ?? DEFAULT_REPEAT_ALERT_MINUTES}">
      </div>
      <div class="field field-full">
        <label for="alertRecipients">Numeros que recebem o alerta (um por linha)</label>
        <textarea id="alertRecipients" name="alertRecipients" rows="4" placeholder="5519999999999">${escapeHtml(recipients)}</textarea>
        <p class="muted">${recipientCount} numero(s) validos hoje.</p>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="notifyOnRecovery" ${settings?.notifyOnRecovery ?? true ? 'checked' : ''}> Avisar tambem quando o SDR voltar</label>
      <label class="checkbox-field field-full"><input type="checkbox" name="onlyActiveAgents" ${settings?.onlyActiveAgents ?? true ? 'checked' : ''}> Vigiar apenas SDRs ligados no portal</label>
      <div class="field field-full">
        <label for="alertTemplate">Mensagem de queda (vazio usa o padrao)</label>
        <textarea id="alertTemplate" name="alertTemplate" rows="7" placeholder="${escapeHtml(defaultAlertTemplate(data.portalUrl))}">${escapeHtml(settings?.alertTemplate ?? '')}</textarea>
        <p class="muted">Marcadores: <code>{sdrs}</code> (lista com nome, hora e motivo), <code>{total}</code>, <code>{data}</code>, <code>{hora}</code>, <code>{portal}</code>.</p>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="dailyReportEnabled" ${settings?.dailyReportEnabled ? 'checked' : ''}> Enviar relatorio no fim do dia (SDRs ativos: prospectados, responderam e possiveis clientes)</label>
      <div class="field">
        <label for="dailyReportTime">Hora do relatorio</label>
        <input id="dailyReportTime" name="dailyReportTime" type="time" value="${escapeHtml(settings?.dailyReportTime ?? DEFAULT_DAILY_REPORT_TIME)}">
        <p class="muted">Fuso do portal (${escapeHtml(data.timeZone)}). Sai na primeira verificacao depois dessa hora, uma vez por dia.${data.lastDailyReportOn ? ` Ultimo envio: ${escapeHtml(data.lastDailyReportOn)}.` : ''}</p>
      </div>
      <div class="field field-full">
        <label for="dailyReportTemplate">Texto do relatorio (vazio usa o padrao)</label>
        <textarea id="dailyReportTemplate" name="dailyReportTemplate" rows="6" placeholder="${escapeHtml(defaultDailyReportTemplate())}">${escapeHtml(settings?.dailyReportTemplate ?? '')}</textarea>
        <p class="muted">Marcadores: <code>{sdrs}</code> (um bloco por SDR ativo), <code>{totais}</code>, <code>{data}</code>, <code>{hora}</code>, <code>{portal}</code>.</p>
      </div>
      <div class="field field-full">
        <label for="recoveryTemplate">Mensagem de volta (vazio usa o padrao)</label>
        <textarea id="recoveryTemplate" name="recoveryTemplate" rows="6" placeholder="${escapeHtml(defaultRecoveryTemplate())}">${escapeHtml(settings?.recoveryTemplate ?? '')}</textarea>
      </div>
      <div class="actions field-full">
        <button type="submit">Salvar</button>
      </div>
    </form>
  </section>
</main>`,
  });
}
