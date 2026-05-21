import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

function renderSdrSelect(agents: SdrAgent[], selectedId: string): string {
  const options = agents.map(
    (agent) =>
      `<option value="${escapeHtml(agent.id)}"${agent.id === selectedId ? ' selected' : ''}>${escapeHtml(agent.displayName)} (${escapeHtml(agent.name)})</option>`,
  );

  return `<select id="sdrAgentId" name="sdrAgentId" required>
    <option value="">Selecione um SDR...</option>
    ${options.join('')}
  </select>`;
}

export function renderPromptAssistantFormPage(
  agents: SdrAgent[],
  selectedSdrAgentId?: string,
  briefing?: string,
  generatedPrompt?: string,
  error?: string,
): string {
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';
  const selectedAgent = agents.find((agent) => agent.id === selectedSdrAgentId) ?? null;
  const currentPrompt = selectedAgent?.prompt ?? '';

  let resultHtml = '';
  if (generatedPrompt) {
    resultHtml = `<section class="panel">
      <h2>Prompt gerado</h2>
      <pre style="white-space:pre-wrap;word-break:break-word;background:#f5f5f5;padding:1rem;border-radius:4px;max-height:300px;overflow:auto;">${escapeHtml(generatedPrompt)}</pre>
      <form method="post" action="/prompt-assistant/apply" style="margin-top:1rem;">
        <input type="hidden" name="sdrAgentId" value="${escapeHtml(selectedSdrAgentId ?? '')}">
        <input type="hidden" name="prompt" value="${escapeHtml(generatedPrompt)}">
        <p class="muted" style="margin-bottom:0.5rem;">Aplicar este prompt ao SDR?</p>
        <button type="submit">Aplicar prompt ao SDR</button>
        <a class="button button-secondary" href="/prompt-assistant">Cancelar</a>
      </form>
    </section>`;
  }

  return renderLayout({
    title: 'IA auxiliar de prompt - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>IA auxiliar de prompt</h1>
      <p class="muted">Descreva o que o SDR deve fazer e a IA gerara um prompt configurado.</p>
    </div>
  </header>

  ${errorHtml}

  ${resultHtml}

  <section class="panel${resultHtml ? '' : ''}">
    <form method="post" action="/prompt-assistant/generate">
      <div class="field">
        <label for="sdrAgentId">SDR</label>
        ${renderSdrSelect(agents, selectedSdrAgentId ?? '')}
      </div>
      ${selectedAgent ? `<div class="field" style="margin-bottom:1rem;">
        <label>Prompt atual do SDR</label>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f5f5f5;padding:0.75rem;border-radius:4px;max-height:150px;overflow:auto;font-size:0.85rem;margin:0;">${escapeHtml(currentPrompt || '(sem prompt configurado)')}</pre>
      </div>` : ''}
      <div class="field">
        <label for="briefing">Briefing</label>
        <textarea id="briefing" name="briefing" rows="6" required style="width:100%;">${escapeHtml(briefing ?? '')}</textarea>
        <p class="muted">Ex: "O SDR deve abordar restaurantes em SP oferecendo sistema de gestao. Tom consultivo e direto, sem ser insistente. Nao mencionar preco na primeira mensagem."</p>
      </div>
      <button type="submit">Gerar prompt</button>
    </form>
  </section>
</main>`,
  });
}
