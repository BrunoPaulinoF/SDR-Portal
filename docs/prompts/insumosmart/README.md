# Prompts da Insumo Smart (SDR do Fernando)

Estes arquivos são a **fonte versionada** dos prompts que ficam no banco, na tela
`/sdr-agents/<id>/edit`. O portal continua sendo quem manda em produção — este diretório
existe para o texto ter histórico, revisão e diff.

Quando alterar um prompt no portal, atualize o arquivo aqui no mesmo commit.

| Arquivo | Campo no portal | Entra no prompt da IA? |
| --- | --- | --- |
| `prompt.txt` | Prompt editável do SDR | sim — região estável, depois do prompt base + funil |
| `offer-description.txt` | Descrição da oferta | sim — região estável |
| `first-message-prompt.txt` | Prompt da primeira mensagem | só quando o modo A/B está desligado |
| `first-message-variants.md` | Tela **Msg inicial** (variantes A/B) | não passa pela IA: texto fixo |
| `followup-prompt.txt` | Prompt de follow-up | sim, no job de follow-up |
| `lead-qualification-prompt.txt` | Prompt de qualificação | sim, no `lead_fit_assessment` |
| `handoff-template.txt` | Template de handoff | não é prompt: é a mensagem enviada ao Fernando |

`Descrição do produto` (`productDescription`) **não** alimenta nenhum prompt — é
documentação interna da tela. Só `productName` e `offerDescription` chegam à IA.

## A estratégia: um sim, e sai da frente

A abordagem do Fernando no Instagram já funciona por motivos que valem a pena nomear, porque
são eles que o prompt precisa preservar:

1. **Par, não fornecedor.** "Também sou do ramo da gastronomia" tira quem fala do lugar de
   vendedor antes da primeira objeção aparecer.
2. **Micro-consentimento.** "Queria te fazer uma proposta, pode ser?" pede uma coisa
   minúscula. Quem responde "pode" já entrou na conversa.
3. **Projeto, não produto.** Não há nada para avaliar, comparar ou orçar — só uma curiosidade
   em aberto.
4. **Seleção.** "Poucas empresas" e "a de vocês chamou minha atenção" invertem o papel: quem
   precisa se qualificar é o lead, não o vendedor.
5. **Saída fácil.** "Ou deixo essa oportunidade para outra empresa" custa nada para recusar —
   e é justamente por isso que as pessoas respondem.

O ajuste pedido — trocar "bora trocar uma ideia?" por **"Gostaria de saber mais sobre nosso
projeto?"** — é pequeno no texto e grande no funil. "Trocar uma ideia" é um compromisso de
agenda disfarçado, e o lead responde "sobre o quê?" para se defender. "Saber mais" é
informação, não compromisso: o sim é barato, e o sim é tudo que a SDR precisa. A partir dele
ela aciona o handoff, o Fernando é avisado no WhatsApp dele e o lead ouve
*"Já pedi pro Fernando entrar em contato com você"*.

Daí o desenho: **a SDR tem uma decisão só na conversa inteira** — a pessoa aceita ou não
conhecer o projeto. Ela não apresenta, não faz discovery, não qualifica em profundidade e não
fala preço. Quem faz isso é o Fernando, ao vivo, com o contexto todo.

Isso também derruba o risco. Os três erros que mais custam caro num SDR de IA — inventar
preço, inventar detalhe do produto e queimar o lead com um pitch vago — só existem quando a
IA tem muito o que dizer. Aqui ela tem quase nada, de propósito.

## Por que isso exigiu mexer no código

O `SDR_BASE_PROMPT` (as "instruções fixas", enviadas acima de qualquer prompt editável) tinha
um único funil embutido, o consultivo, e ele **proíbe por escrito** a abordagem por
curiosidade:

> `discovery`: dizer em uma frase simples o que você faz e fazer UMA pergunta sobre a rotina
> do lead. Nunca peça ao lead que aceite ouvir uma oferta sem antes dizer do que se trata.

Essa regra foi escrita a partir das conversas da Mariana (KyberFood) e está certa **para
aquele funil**. Para a Insumo Smart ela é exatamente o contrário do que se quer. Qualquer
texto que escrevêssemos no prompt editável ia brigar com a regra de cima, e prompt em
contradição não produz o meio-termo: produz comportamento errático.

Por isso o prompt base virou duas peças: **regras comuns** (anti-jailbreak, formato de saída,
comandos internos, robô da loja, adiamento vs. recusa) e um **bloco de funil por playbook**.
Cada SDR escolhe o playbook na tela de edição:

- **`consultivo`** — comportamento atual, sem nenhuma mudança. É o padrão, e a Mariana
  continua nele.
- **`convite`** — o funil da Insumo Smart: abertura → convite → handoff no primeiro sim.

O bloco `convite` ensina a IA a reconhecer o sim (que é onde este funil ganha ou perde),
separa o "pode ser?" da abertura do sim do convite, trata pergunta antes do aceite como etapa
de explicação curta, e manda acionar o handoff na dúvida. Também proíbe inventar escassez —
quantidade de vagas, prazo, contagem regressiva.

Além disso, `Pessoa do time para handoff` passou a entrar no contexto fixo do prompt: a IA
usa o nome configurado em `handoffName` em vez de um nome escrito à mão no meio do prompt.

## Como configurar no portal

Na tela do SDR (`/sdr-agents/<id>/edit`):

| Campo | Valor |
| --- | --- |
| Playbook de conversa | **Convite** |
| Prompt editável do SDR | `prompt.txt` |
| Descrição da oferta | `offer-description.txt` |
| Prompt de qualificação | `lead-qualification-prompt.txt` |
| Prompt de follow-up | `followup-prompt.txt` |
| Nome do contato de handoff | `Fernando` |
| Telefone de handoff | WhatsApp do Fernando (com DDI/DDD) |
| Template de handoff | `handoff-template.txt` |
| Follow-up ativo | ligado |
| Horas para follow-up | 24 a 48 |
| Temperatura | 0.4 |
| Máximo de tokens de saída | 1500 |
| Contato de demonstração | **em branco** — este SDR não usa cartão de demonstração |

Na tela **Msg inicial** (`/sdr-agents/<id>/first-messages`): ligar o **teste A/B** e cadastrar
as três variantes de `first-message-variants.md`. `first-message-prompt.txt` fica salvo como
rede de segurança para quando o A/B for desligado.

## O que medir

O funil desta SDR tem quatro números, e o terceiro é o que importa:

1. **enviadas → responderam** — mede a primeira mensagem. É o número que o teste A/B compara,
   já pronto na tela Msg inicial.
2. **responderam → chegaram ao convite** — mede a abertura. Se cair aqui, a mensagem 1 está
   assustando ou parecendo golpe.
3. **chegaram ao convite → disseram sim** — mede o convite em si. É a métrica da estratégia.
4. **sim → handoff acionado** — mede a IA, não o roteiro. Se o lead disse sim e o handoff não
   saiu, o problema é o prompt reconhecendo o aceite; olhe os `ai_runs` da conversa.

Estágio de cada lead fica em `conversation_stage` (`permission`, `discovery`, `solution`,
`handoff_offer`, `handoff_done`, `not_interested`) e o dashboard já agrupa por ele. No
playbook `convite` os nomes têm outro significado: `discovery` é a mensagem do convite e
`solution` é a resposta curta ao "o que é isso?".

Vale revisar as primeiras ~50 conversas à mão. Os dois erros esperados são a IA explicando
demais na etapa `solution` (e o lead sumindo com a curiosidade satisfeita) e handoff acionado
sem sim de verdade (o "o que é isso?" lido como aceite).

## Antes de ligar — confirmar com o Fernando

Escrevi este conjunto a partir da mensagem de exemplo, do prompt da Mariana e do que está no
código. **Não tive acesso ao banco de produção** (o host do `DATABASE_URL` só resolve dentro
da rede do Docker), então não li nenhuma conversa real da Insumo Smart, nem os prompts que
estão hoje salvos no portal. Nada aqui vem de métrica desse SDR.

Dois pontos precisam de confirmação antes de subir:

- **O conteúdo da oferta.** `offer-description.txt` descreve o projeto como acompanhamento de
  gestão de operação de gastronomia — custo de insumo, CMV, preço de cardápio, margem. Isso
  veio do nome da empresa e do `productName` que aparece no código ("Consultoria CMV"). Se o
  projeto for outra coisa, o arquivo a corrigir é esse e a frase de explicação da etapa
  `solution` no `prompt.txt`.
- **A escassez.** O roteiro afirma que o projeto é com poucas empresas e que as vagas estão
  sendo fechadas. Os prompts proíbem inventar número e prazo, mas o enquadramento em si
  precisa ser verdade — dito a centenas de leads por semana, deixa de ser argumento e vira
  um problema.
