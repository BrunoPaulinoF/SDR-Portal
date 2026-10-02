/**
 * Script comum de todas as telas do portal (`/app.js`). O portal continua funcionando sem ele:
 * cada trecho so melhora o que o HTML ja faz sozinho.
 *
 * - **Aviso de salvo.** As rotas de salvar redirecionam de volta para a propria tela com
 *   `?salvo=1` (ou `?criado=1`); o script mostra o aviso e tira o parametro da barra de
 *   endereco, para recarregar a pagina nao repetir o aviso.
 * - **Voltar ao mesmo ponto.** Todo formulario guarda, ao enviar, a rolagem e quais secoes
 *   recolhiveis estavam abertas. Se a resposta cair na mesma tela, tudo volta como estava; se
 *   cair em outra, nada acontece. Antes, salvar o SDR levava para a lista e fechava tudo.
 * - **Resultado na propria tela.** Formulario com `data-inline-result="<id>"` e enviado por
 *   `fetch` pedindo JSON, e o resultado aparece no elemento indicado. Sem JSON (sessao vencida,
 *   erro do servidor) o aviso diz o que fazer. Todo texto entra por `textContent`.
 */
export const APP_SCRIPT = `(function () {
  var PLACE_KEY = 'sdr-portal:lugar';
  var MESSAGES = { salvo: 'Alteracoes salvas', criado: 'Criado com sucesso' };

  function showToast(text, kind) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (kind || 'success');
    toast.setAttribute('role', 'status');
    toast.textContent = (kind === 'error' ? '' : '\\u2713 ') + text;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('toast-hide'); }, 3500);
    setTimeout(function () { toast.remove(); }, 4200);
  }

  function savedNotice() {
    var params = new URLSearchParams(location.search);
    var key = Object.keys(MESSAGES).find(function (name) { return params.has(name); });
    if (!key) return;
    showToast(MESSAGES[key]);
    params.delete(key);
    var query = params.toString();
    try { history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash); } catch (e) {}
  }

  function restorePlace() {
    try {
      var raw = sessionStorage.getItem(PLACE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PLACE_KEY);
      var saved = JSON.parse(raw);
      if (saved.path !== location.pathname) return;
      var sections = document.querySelectorAll('details');
      (saved.open || []).forEach(function (index) { if (sections[index]) sections[index].open = true; });
      window.scrollTo(0, saved.y || 0);
    } catch (e) {}
  }

  function rememberPlace() {
    try {
      var open = [];
      document.querySelectorAll('details').forEach(function (section, index) { if (section.open) open.push(index); });
      sessionStorage.setItem(PLACE_KEY, JSON.stringify({ path: location.pathname, y: window.scrollY, open: open }));
    } catch (e) {}
  }

  function renderResult(target, result) {
    target.textContent = '';
    target.classList.remove('action-result-ok', 'action-result-error');
    target.classList.add(result.ok ? 'action-result-ok' : 'action-result-error');
    var title = document.createElement('strong');
    title.textContent = (result.ok ? '\\u2713 ' : '\\u2717 ') + (result.title || '');
    var summary = document.createElement('p');
    summary.textContent = result.summary || '';
    target.appendChild(title);
    target.appendChild(summary);
    if (result.hint) {
      var hint = document.createElement('p');
      hint.className = 'muted';
      hint.textContent = result.hint;
      target.appendChild(hint);
    }
    if (result.raw) {
      var details = document.createElement('details');
      var label = document.createElement('summary');
      label.textContent = 'Detalhes tecnicos';
      var pre = document.createElement('pre');
      pre.textContent = result.raw;
      details.appendChild(label);
      details.appendChild(pre);
      target.appendChild(details);
    }
  }

  function submitInline(form, target) {
    var button = form.querySelector('button[type=submit], button:not([type])');
    var label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Aguarde...'; }
    target.classList.remove('action-result-ok', 'action-result-error');
    target.textContent = 'Consultando...';
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
    })
      .then(function (response) {
        var type = response.headers.get('content-type') || '';
        if (type.indexOf('application/json') === -1) throw new Error('sem json');
        return response.json();
      })
      .then(function (result) { renderResult(target, result); })
      .catch(function () {
        renderResult(target, { ok: false, title: 'Nao foi possivel concluir', summary: 'Recarregue a pagina e tente de novo. Se pedir login, entre de novo.' });
      })
      .finally(function () { if (button) { button.disabled = false; button.textContent = label; } });
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    // Confirmacao cancelada (onsubmit="return confirm(...)"): nada vai ser enviado.
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
    var targetId = form.getAttribute('data-inline-result');
    var target = targetId ? document.getElementById(targetId) : null;
    if (target && window.fetch) {
      event.preventDefault();
      submitInline(form, target);
      return;
    }
    rememberPlace();
  });

  restorePlace();
  savedNotice();
})();
`;
