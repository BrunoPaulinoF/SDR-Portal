import type { SdrAgent } from '../../db/schema.js';
import { resolveSdrPlaybook } from '../ai/sdr-playbooks.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { FirstMessageVariantMetrics } from './first-message-variant-repository.js';

function replyRate(sent: number, replied: number): string {
  if (sent <= 0) return '—';
  return `${Math.round((replied / sent) * 100)}%`;
}

function wordShingles(text: string, size: number): Set<string> {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const shingles = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) shingles.add(words.slice(index, index + size).join(' '));
  return shingles;
}

/**
 * A variante repete a explicacao da segunda mensagem? As duas saem coladas, no mesmo disparo:
 * repetir faz o dono ler a mesma propaganda duas vezes de um numero que ele nao conhece.
 *
 * Foi o que ficou no ar de 17/09 a 29/09 na Mariana: a variante B ainda trazia "a gente tem
 * uma IA que atende o WhatsApp do delivery, responde na hora..." e logo depois vinha a segunda
 * mensagem dizendo o mesmo. A documentacao dizia que o texto ja tinha mudado.
 */
export function repeatsSecondMessage(variantBody: string, secondMessage: string | null | undefined): boolean {
  if (!secondMessage?.trim()) return false;
  const second = wordShingles(secondMessage, 4);
  let shared = 0;
  for (const shingle of wordShingles(variantBody, 4)) {
    if (second.has(shingle)) shared += 1;
    if (shared >= 3) return true;
  }
  return false;
}

function renderVariantCard(agentId: string, metrics: FirstMessageVariantMetrics, secondMessage: string | null): string {
  const { variant, sent, replied } = metrics;
  const toggleLabel = variant.isActive ? 'Pausar' : 'Ativar';
  const repeatWarning =
    variant.isActive && repeatsSecondMessage(variant.body, secondMessage)
      ? '<p class="alert-error">Esta variante repete a explicacao da segunda mensagem. As duas saem coladas: o lead le a mesma coisa duas vezes seguidas, de um numero que nao conhece. Deixe aqui so a apresentacao.</p>'
      : '';
  return `<section class="panel">
    <header class="topbar">
      <div>
        <h2>Variante ${escapeHtml(variant.label)} <span class="status-pill ${variant.isActive ? 'status-on' : 'status-off'}">${variant.isActive ? 'Ativa' : 'Pausada'}</span></h2>
        <p class="muted">Enviadas: <strong>${sent}</strong> · Respostas: <strong>${replied}</strong> · Taxa: <strong>${replyRate(sent, replied)}</strong></p>
      </div>
      <div class="table-actions">
        <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}/toggle" data-inline><button class="link-button" type="submit">${toggleLabel}</button></form>
        <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}/delete" data-inline onsubmit="return confirm('Excluir esta variante? As metricas dela serao perdidas.')"><button class="link-button" type="submit">Excluir</button></form>
      </div>
    </header>
    ${repeatWarning}
    <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}" class="form-grid">
      <div class="field field-full"><label>Rotulo</label>
        <input type="text" name="label" value="${escapeHtml(variant.label)}" required>
      </div>
      <div class="field field-full"><label>Mensagem</label>
        <textarea name="body" rows="10" required>${escapeHtml(variant.body)}</textarea>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="isActive" ${variant.isActive ? 'checked' : ''}> Variante ativa (entra no rodizio)</label>
      <div class="actions field-full"><button class="button" type="submit">Salvar variante</button></div>
    </form>
  </section>`;
}

export function renderFirstMessageVariantsPage(
  agent: SdrAgent,
  metrics: FirstMessageVariantMetrics[],
  error?: string,
): string {
  const abOn = agent.firstMessageMode === 'ab_test';
  // O playbook convite depende de um roteiro exato: com a IA escrevendo a abertura,
  // cada lead recebe um texto diferente do combinado — foi assim que um SDR de convite
  // acabou mandando a abertura consultiva ("posso te fazer uma pergunta sobre a operacao?").
  const roteiroWarning = !abOn && resolveSdrPlaybook(agent.playbook) === 'convite'
    ? '<p class="alert-error">Este SDR usa o playbook Convite, que depende de um roteiro exato. Enquanto a primeira mensagem for gerada por IA, o texto sai diferente do roteiro a cada lead. Cadastre a mensagem do roteiro abaixo e mude para mensagem fixa.</p>'
    : '';
  const totalSent = metrics.reduce((sum, m) => sum + m.sent, 0);
  const totalReplied = metrics.reduce((sum, m) => sum + m.replied, 0);

  const errorHtml = error ? `<p class="alert-error">${escapeHtml(error)}</p>` : '';

  const modePanel = `<section class="panel">
    <header class="topbar">
      <div>
        <h2>Modo da primeira mensagem</h2>
        <p class="muted">${abOn
          ? '<strong>Mensagem fixa</strong>: o texto das variantes ativas abaixo sai exatamente como esta escrito, por rodizio, sem IA e sem custo de token.'
          : '<strong>Gerada por IA</strong>: a primeira mensagem e escrita pela IA a cada lead, com o prompt de primeira mensagem. O texto muda de lead para lead, e as variantes abaixo ficam paradas.'}</p>
      </div>
      <div class="table-actions">
        <form method="post" action="/sdr-agents/${agent.id}/first-message-mode" data-inline>
          <input type="hidden" name="mode" value="${abOn ? 'ai' : 'ab_test'}">
          <button class="button ${abOn ? 'button-secondary' : ''}" type="submit">${abOn ? 'Deixar a IA gerar a primeira mensagem' : 'Usar mensagem fixa (texto exato, sem IA)'}</button>
        </form>
      </div>
    </header>
    ${roteiroWarning}
    <p class="muted">Com duas ou mais variantes ativas, o modo fixo vira teste A/B: o rodizio compara a taxa de resposta de cada texto. Com uma so, todo lead recebe a mesma mensagem.</p>
    <p class="muted">Resumo geral: <strong>${totalSent}</strong> enviadas · <strong>${totalReplied}</strong> respostas · taxa <strong>${replyRate(totalSent, totalReplied)}</strong>.</p>
  </section>`;

  const cards = metrics.map((m) => renderVariantCard(agent.id, m, agent.secondMessage)).join('');
  const emptyCards = metrics.length
    ? ''
    : '<section class="empty-state"><h2>Nenhuma variante ainda</h2><p class="muted">Crie a mensagem abaixo para o SDR mandar um texto fixo em vez de deixar a IA escrever.</p></section>';

  const newPanel = `<section class="panel">
    <h2>Nova variante</h2>
    <p class="muted">Placeholders disponiveis: <code>{{responsavel}}</code> (complemento de "Falo com ___?": usa o nome do negocio, ou o primeiro nome do contato cadastrado), <code>{{nome}}</code> (contato do lead ou titular do MEI) e <code>{{restaurante}}</code> (nome fantasia ou empresa). Se o lead nao tiver o dado, o texto e limpo automaticamente.</p>
    <form method="post" action="/sdr-agents/${agent.id}/first-messages" class="form-grid">
      <div class="field field-full"><label>Rotulo</label>
        <input type="text" name="label" placeholder="Ex: A, B, Prova social..." required>
      </div>
      <div class="field field-full"><label>Mensagem</label>
        <textarea name="body" rows="10" placeholder="Escreva a mensagem fixa. Use {{nome}} e {{restaurante}} se quiser." required></textarea>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="isActive" checked> Entrar no rodizio ao salvar</label>
      <div class="actions field-full"><button class="button" type="submit">Adicionar variante</button></div>
    </form>
  </section>`;

  // A abordagem sao duas mensagens, e as duas moram nesta tela: a primeira se apresenta, a
  // segunda explica o sistema. Vazia, o SDR volta a abordar com uma mensagem so.
  const secondMessage = agent.secondMessage ?? '';
  const secondPanel = `<section class="panel">
    <h2>Segunda mensagem da abordagem</h2>
    <p class="muted">Sai sozinha, logo depois da primeira, no mesmo disparo e sem esperar o lead responder. E texto fixo: nao passa pela IA e aceita os mesmos placeholders das variantes. Deixe vazia para abordar com uma mensagem so.</p>
    <form method="post" action="/sdr-agents/${agent.id}/second-message" class="form-grid">
      <div class="field field-full"><label>Mensagem</label>
        <textarea name="secondMessage" rows="8" placeholder="Ex: explique em poucas linhas o que o sistema faz e o teste gratis.">${escapeHtml(secondMessage)}</textarea>
      </div>
      <div class="actions field-full"><button class="button" type="submit">Salvar segunda mensagem</button></div>
    </form>
  </section>`;

  return renderLayout({
    title: `Mensagem inicial - ${agent.displayName} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Mensagem inicial · ${escapeHtml(agent.displayName)}</h1>
      <p class="muted">A abordagem sai em duas mensagens: a apresentacao curta (fixa ou gerada por IA, com a taxa de resposta de cada texto) e, logo depois, a segunda mensagem que explica o sistema.</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/sdr-agents">Voltar para SDRs</a>
    </div>
  </header>
  ${errorHtml}
  ${modePanel}
  ${emptyCards}
  ${cards}
  ${newPanel}
  ${secondPanel}
</main>`,
  });
}
