# Plano de reestruturação das telas do portal — 02/10

Pedido: "a dashboard está muito ruim de se usar (...) config de SDR que você salva e ele volta pro
menu, muita coisa misturada e confusa, muita coisa na mesma tela". O portal foi aberto com dados
de exemplo e cada tela foi medida antes do plano.

## O que foi encontrado

- **Tela do SDR:** 56 campos e 7 formulários numa página só (cerca de 9 telas de rolagem com as
  seções abertas). Os prompts, que são o que mais se edita, ficam dentro de "Modelo de IA", entre
  as chaves de API e o texto fixo do sistema. **Salvar levava para a lista de SDRs** e fechava as
  seções. Os botões de teste abriam outra página com o JSON cru da UAZAPI. "Msg inicial" e
  "Conectar" são telas separadas, alcançadas só pela lista.
- **Painel:** 5 telas de altura — 6 filtros, 10 cartões, 6 tabelas (duas largas demais para a
  tela). Alerta urgente misturado com aviso informativo. Lia a cada abertura **todas** as
  mensagens (com o payload cru), todas as chamadas de IA (com o prompt inteiro) e todos os
  registros de tarefa: ficava mais lento a cada dia de operação.
- **Leads:** sem busca, sem filtro, sem paginação (60 leads já davam 6 telas), situação em inglês
  (`pending`, `initial_sent`) e o apagar-em-massa no pé da mesma página.
- **Monitor:** três funções diferentes (queda, fila, relatório) num formulário só.
- **Menu:** 10 itens, três deles registros técnicos em inglês.

## As 4 etapas

**A — consertos rápidos.** Salvar fica na mesma tela, com aviso e o mesmo lugar; testes do
WhatsApp com resultado na própria tela, em português; leads com busca, filtros, 50 por página e
situação em português; apagar em massa em tela própria; painel lendo só o período.

**B — tela do SDR em abas.** Resumo · Conversa (prompts) · Abordagem (junta "Msg inicial") ·
Envio · WhatsApp (junta "Conectar" e os testes) · Voz · Avançado · Histórico. Cada aba salva só
os próprios campos. A lista de SDRs vira cartões com o estado do WhatsApp e os envios do dia.

**C — painel em 3 partes.** "Precisa de você agora" (só o que pede ação, cada aviso com o botão
para o lugar certo); um cartão por SDR; os 4 números que importam + funil. O resto vai para uma
página "Relatórios".

**D — menu e telas de apoio.** Menu: Painel · Conversas · Leads · SDRs · Relatórios, e
Configurações (Empresas, Monitor, IA auxiliar). Os três registros viram uma página "Registros"
que abre nos erros. Monitor em 3 abas. Nada de código técnico na tela.

A base continua a mesma (HTML gerado no servidor + `/app.js`): reescrever em outra tecnologia
levaria semanas e arriscaria o que funciona. Cada etapa sai num PR.

## Andamento

- **Etapa A (02/10): feita.** Ver "Telas" no `CLAUDE.md`.
- **Etapa B (02/10): feita.** A tela do SDR virou abas (`?aba=`), cada uma com o proprio
  formulario (`POST /sdr-agents/:id/aba/:aba`) que so troca os campos dela; Msg inicial e
  Conectar ganharam as mesmas abas; a lista de SDRs virou cartoes. A rota antiga que salvava
  o formulario inteiro (`POST /sdr-agents/:id`) saiu: nada mais a usava, e um POST parcial
  nela apagava o que nao viesse.
- **Etapa C (05/10): feita.** O `/dashboard` virou o Painel: "Precisa de voce agora" (cada aviso
  com o botao para resolver; o que e so informacao saiu), um cartao por SDR ativo e o resultado
  do periodo (4 numeros + funil). Filtro so de periodo. Todo o resto foi para `/relatorios`,
  com os filtros completos. No menu, "Dashboard" virou "Painel" e entrou "Relatorios"; o resto
  do menu fica para a etapa D.
