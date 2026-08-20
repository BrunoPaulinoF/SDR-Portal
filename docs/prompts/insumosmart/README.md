# Prompts da Insumo Smart (SDR do Fernando)

Estes arquivos são a **fonte versionada** dos prompts que ficam no banco, na tela
`/sdr-agents/<id>/edit`. O portal continua sendo quem manda em produção — este diretório
existe para o texto ter histórico, revisão e diff.

Quando alterar um prompt no portal, atualize o arquivo aqui no mesmo commit.

| Arquivo | Campo no portal | Entra no prompt da IA? |
| --- | --- | --- |
| `prompt.txt` | Prompt editável do SDR | sim — região estável, depois do prompt base + funil |
| `offer-description.txt` | Descrição da oferta | sim — região estável |
| `first-message-prompt.txt` | Prompt da primeira mensagem | só quando a mensagem fixa está desligada |
| `first-message-variants.md` | Tela **Msg inicial** (mensagem fixa) | não passa pela IA: texto fixo |
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
6. **Conversa, não atendimento.** Sem emoji, sem assinatura, sem "fico à disposição". O lead
   precisa achar que do outro lado tem uma pessoa do ramo.

A pergunta do convite é **"bora trocar uma ideia?"**, exatamente como está no roteiro do
Fernando. Uma versão anterior destes prompts trocou essa frase por "Gostaria de saber mais
sobre nosso projeto?", apostando que "saber mais" seria um sim mais barato que "trocar uma
ideia". Na prática o Fernando viu a IA fazendo a pergunta errada, e a decisão é dele: o texto
é o do roteiro. Do sim em diante nada muda — a SDR aciona o handoff, o Fernando é avisado no
WhatsApp dele e o lead ouve *"Já pedi pro Fernando entrar em contato com você"*.

Duas mensagens dão conta do funil inteiro, e as duas são texto fixo:

1. **Abertura** (`first-message-variants.md`) — cumprimento, "também estou no ramo",
   o projeto com poucas empresas, e o convite. O convite já vai aqui, na primeira mensagem.
2. **Follow-up** (`followup-prompt.txt`) — "passei novamente porque estou fechando as
   empresas", com a saída fácil de deixar a vaga para outra casa.

Como o convite já sai na primeira mensagem, a resposta do lead é resposta ao convite: a SDR
lê o sim e chama o Fernando, sem reformular a pergunta. Reformular era exatamente o erro
apontado.

Daí o desenho: **a SDR tem uma decisão só na conversa inteira** — a pessoa aceita ou não
trocar uma ideia sobre o projeto. Ela não apresenta, não faz discovery, não qualifica em profundidade e não
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

Na tela **Msg inicial** (`/sdr-agents/<id>/first-messages`): cadastrar **uma** variante com
o texto de `first-message-variants.md` e deixar o modo em **mensagem fixa** (é o mesmo botão
do teste A/B — uma variante ativa significa que todo lead recebe esse texto). Com o modo em
"gerada por IA" este roteiro não é usado. `first-message-prompt.txt` fica salvo como rede de
segurança para esse caso.

### Aplicando estes arquivos no banco sem colar campo a campo

`npm run sdr:prompts` grava os arquivos deste diretório no SDR. Ele roda dentro do container
do app (é quem enxerga o banco) e, sem `--apply`, só mostra o que mudaria:

```bash
docker compose exec app npm run sdr:prompts -- --agent="Francielly"           # mostra o plano
docker compose exec app npm run sdr:prompts -- --agent="Francielly" --apply   # grava
```

O que ele faz: escreve `prompt.txt`, `offer-description.txt`, `first-message-prompt.txt`,
`followup-prompt.txt`, `lead-qualification-prompt.txt` e `handoff-template.txt` nos campos
correspondentes, coloca o playbook em **convite**, cadastra o roteiro de
`first-message-variants.md` como variante **Roteiro** e muda o modo para **mensagem fixa**.
As variantes antigas são desativadas, não apagadas — as métricas delas continuam lá.

O que ele **não** faz: mexer em chave de API, instância da UAZAPI, janela de envio, limites,
handoff (nome e telefone) ou qualquer coisa fora dos prompts. Se o handoff estiver vazio, ele
avisa em vez de inventar.

Opções: `--agent=<id ou pedaço do nome>`, `--dir=<outro diretório de prompts>`,
`--playbook=consultivo|convite`, `--apply`. Rodar duas vezes é seguro: na segunda ele diz
"nada a mudar".

### Se a IA mandar uma mensagem que não é o roteiro

A abertura errada — "Bom dia! Aqui é a Francielly, da Insumo Smart... posso te fazer uma
pergunta rápida sobre a operação de vocês?" — é a abertura do playbook **consultivo**, escrita
pela IA. Ela sai quando uma destas três coisas está fora do lugar no portal, e nenhum arquivo
deste diretório muda isso: os prompts vivem no banco.

| Onde | Tem que estar | Se estiver errado |
| --- | --- | --- |
| `/sdr-agents/<id>/edit` → Playbook de conversa | **Convite** | Em Consultivo a IA explica, pergunta a rotina e vende — o funil oposto |
| `/sdr-agents/<id>/first-messages` → Modo | **Mensagem fixa** | Em "gerada por IA" a abertura é reescrita a cada lead |
| `/sdr-agents/<id>/first-messages` → Variante ativa | O texto de `first-message-variants.md` | Sem variante ativa o portal cai na IA mesmo em modo fixo |

## O que medir

O funil desta SDR tem quatro números, e o terceiro é o que importa:

1. **enviadas → responderam** — mede a mensagem de abertura, que já carrega o convite.
2. **responderam → disseram sim** — mede o convite em si. É a métrica da estratégia.
3. **follow-up enviado → responderam** — mede a segunda mensagem, a das vagas.
4. **sim → handoff acionado** — mede a IA, não o roteiro. Se o lead disse sim e o handoff não
   saiu, o problema é o prompt reconhecendo o aceite; olhe os `ai_runs` da conversa.

Estágio de cada lead fica em `conversation_stage` (`permission`, `discovery`, `solution`,
`handoff_offer`, `handoff_done`, `not_interested`) e o dashboard já agrupa por ele. No
playbook `convite` os nomes têm outro significado: `permission` é a leitura da resposta à
abertura, `discovery` é o convite devolvido quando a resposta não foi um sim, e `solution` é
a resposta curta ao "o que é isso?".

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
- **"Opa, bom?"** virou **"Opa, tudo bom?"** na mensagem de abertura, por parecer frase
  cortada. É a única palavra alterada do roteiro; se o Fernando preferir o original, é uma
  linha em `first-message-variants.md`.
