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
é o do roteiro. Do sim em diante a SDR não anuncia a transferência: ela pede — *"Posso pedir
para o Fernando te chamar?"* — e é o segundo sim que dispara o handoff e o aviso no WhatsApp do
Fernando (veja **A passagem é uma pergunta**, abaixo).

A abordagem são **quatro mensagens, uma por vez**, esperando o lead responder entre elas —
não um bloco de texto só. As quatro juntas leem como anúncio; separadas, cada resposta é um
compromisso pequeno que puxa o próximo:

| Passo | Ideia | Onde vive |
| --- | --- | --- |
| 1 | Opa, tudo bom? | `first-message-variants.md` (mensagem fixa do disparo) |
| 2 | Também estou no ramo da gastronomia e queria te fazer uma proposta, pode ser? | `prompt.txt`, seção A CONVERSA-BASE |
| 3 | Então, tô iniciando um projeto onde vou acompanhar poucas empresas gastronômicas de perto, e a de vocês chamou minha atenção. | idem |
| 4 | Acho que podemos fazer esse projeto juntos, bora trocar uma ideia? | idem |

Só o passo 1 sai pelo disparo, como texto fixo. Os outros três a IA conduz: **responde o que o
lead falou e emenda o passo seguinte com as palavras dela**, mantendo o tom e a ordem. Copiar
frase por frase foi tentado e deu errado — a SDR ignorava a pergunta do lead ("e você?") e
terminava mensagem em ponto final, sem nada para responder. As duas regras que consertam isso
(responder antes de avançar, e terminar sempre em pergunta) estão no `prompt.txt` e no bloco de
funil do playbook `convite`. Só a pergunta do convite e a pergunta da passagem têm redação travada.

O **follow-up** (`followup-prompt.txt`) é a quinta mensagem, quando o lead some: "passei
novamente porque estou fechando as empresas", com a saída fácil de deixar a vaga para outra
casa.

Daí o desenho: **a SDR tem uma decisão só na conversa inteira** — a pessoa aceita ou não
conversar com o Fernando. Ela não faz discovery, não qualifica em profundidade, não negocia e
não fala preço. Quem faz isso é o Fernando, ao vivo, com o contexto todo.

Isso também derruba o risco. Os três erros que mais custam caro num SDR de IA — inventar
preço, inventar detalhe do produto e queimar o lead com um pitch vago — só existem quando a
IA tem muito o que dizer. Aqui ela tem uma frase, de propósito.

## O que a SDR explica, e o que ela guarda

A primeira versão destes prompts guardava tudo: a SDR não dizia o que a Insumo Smart faz, e a
curiosidade em aberto era justamente essa. Na prática isso produziu respostas vagas — *"é um
acompanhamento de perto da operação mesmo"* — e o lead que não entendeu não responde. Pior: para
não explicar, a SDR se encostava no Fernando (*"quem detalha tudo é ele"*), o que lê como
despreparo e transforma o encaminhamento em fuga da pergunta.

A regra agora tem duas metades:

- **A proposta central é dela**, e ela diz com segurança sempre que perguntarem: *acompanhar de
  perto os números da operação e transformá-los em decisões práticas para a gestão financeira.*
- **A aplicação é do Fernando** — como isso entraria naquela casa, o que muda no caso dela, o
  desenho do acompanhamento. E o motivo é dito ao lead: cada operação tem uma realidade
  diferente. Não é "eu não sei", é "isso depende de conhecer a sua casa".

A curiosidade que segura a conversa mudou de lugar: não é mais *o que a Insumo Smart faz*, é
*como isso funcionaria aqui*. É a única que a SDR preserva.

Disso saem as regras que o `prompt.txt` passou a carregar, todas vindas de conversas reais:

| Regra | Por quê |
| --- | --- |
| Responder a dúvida antes de falar do Fernando | Encaminhar sem responder é fuga, e o lead sente |
| Nunca "só ele sabe explicar", "não tenho os detalhes", "ele te explica tudo" | Soa despreparo |
| "Não entendi" → reformular com palavras mais concretas, nunca repetir a mesma resposta | Repetir a frase que já não funcionou perde o lead |
| Não presumir problema, prejuízo, desperdício ou erro de preço | A SDR não conhece a casa; supor dor é o vício mais comum de SDR de IA |
| Nada de promessa ("vamos aumentar seu lucro") | Não é verdade que ela possa afirmar |
| No máximo três frases curtas, uma ideia por vez | Bloco longo no WhatsApp não se lê |
| Natural e profissional, sem diminutivo infantilizado ("explicadinho", "rapidinho") | Informal é o registro; infantil não |

O `offer-description.txt` também mudou: o bloco de dor virou **contexto interno explicitamente
marcado como não-diagnóstico**, porque ele estava na região estável do prompt e servia de convite
para a IA afirmar ao lead problemas que ninguém verificou.

## A passagem é uma pergunta

O Fernando mandou o print de uma conversa que terminava assim: o lead diz *"Não entendi sua
proposta"* e a SDR responde *"Quem detalha tudo é o Fernando, dono da Insumo Smart. Já pedi pra
ele entrar em contato com você, em breve ele te chama."* O handoff estava certo — o problema era
ele ter sido anunciado como fato consumado. Quem estava confuso levou um despacho: nada ali
convidava a continuar falando, e o lead ainda ficou sabendo que o número dele já tinha sido
passado adiante sem ser perguntado.

Por isso a passagem passou a ter **duas etapas**:

| Etapa | O que a SDR faz | `conversation_stage` |
| --- | --- | --- |
| 1 | Responde a dúvida, diz que quem entende o cenário da casa é o Fernando e **pergunta**: "posso pedir para o Fernando te chamar?" — sem acionar nada | `handoff_offer` |
| 2 | O lead autoriza → `notify_handoff` na mesma resposta, com as dúvidas dele no resumo | `handoff_done` |

Isso muda o significado das etapas no funil do convite: `handoff_offer` era "o lead aceitou e o
Fernando já foi avisado", e agora é "a pergunta da passagem está no ar". Nada precisou mudar no
código que aplica as ações: `markTransferred` só roda quando `notify_handoff` aparece nas
`actions`, então segurar a ação por um turno já segura a transferência inteira.

Duas exceções e um cuidado, todos escritos no prompt:

- **Não se pergunta duas vezes.** Se o próprio lead pediu ("pode me chamar", "manda o contato
  dele"), a autorização já existe: o handoff sai direto. Repetir a pergunta que ele acabou de
  fazer é o robô de novo, por outro caminho.
- **Contato de dentro da casa** (sócio, gerente, dono) continua sendo handoff direto, e contato
  de outra empresa continua sendo `notify_referral`.
- **A pergunta pode ficar sem resposta**, e esse é o custo real da mudança: existe agora um sim
  a mais entre o aceite e o handoff. O `followup-prompt.txt` ganhou o caso correspondente —
  quando a última mensagem foi a pergunta da passagem, o follow-up não recomeça o roteiro, só
  refaz a pergunta.

O número 4 de **O que medir** é o que responde se isso saiu caro: `handoff_offer` que nunca vira
`handoff_done` é lead que topou e ficou no meio do caminho.

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

## Cordialidade e indicação

O Fernando mandou prints de conversas reais com dois problemas que não vinham do roteiro, e sim
do que o prompt deixava de dizer:

1. **A SDR saiu mal-educada.** O prompt empurra mensagem curta, informal e sem frase de
   atendimento ("fico à disposição", "como posso te ajudar?"). Sem contrapartida escrita, a IA
   leu isso como licença para ser ríspida: resposta seca, sem agradecer, despedida cortada.
2. **Quem se ofereceu para indicar ouviu "não precisa".** Leads que responderam que não estão
   mais no ramo ofereceram o contato de outras casas, e a IA recusou. Era lead novo, de graça,
   jogado no lixo — e ainda com grosseria contra quem estava tentando ajudar.

**Cordialidade virou regra fixa (`SDR_BASE_PROMPT`)**, não regra de playbook: vale para qualquer
SDR e não briga com nenhum funil. Curto e informal é o tom, seco e grosseiro nunca; agradecer
quando o lead responde; encerrar agradecendo o tempo dele e desejando o melhor, inclusive quando
a resposta é não. Uma regra irmã proíbe o descarte — "não precisa", "não serve" e ignorar o que
o lead ofereceu. O bloco do playbook `convite` recebeu o complemento correspondente: fugir da
frase de atendimento não é ser seco, e encerrar sem argumentar não é bater a porta.

**Indicação também é regra fixa**, com uma ação própria para não se confundir com o handoff:

| Situação | O que a SDR faz |
| --- | --- |
| O lead oferece o contato de alguém | Agradece, aceita e registra com `notify_referral` |
| O lead diz que não é, ou não é mais, do ramo | Pede UMA indicação, com "por favor", antes de encerrar |
| O contato é de alguém da própria casa (sócio, gerente, dono) | Continua sendo `notify_handoff`: a conversa está indo para quem decide ali |
| O lead pediu para não receber mais mensagens, reclamou ou desconfiou | Não pede nada: pede desculpas pelo incômodo e encerra |

`notify_referral` manda para o mesmo WhatsApp do handoff uma mensagem com quem indicou e os
dados do indicado, mas **não** transfere a conversa: o lead que indicou continua com o status
que ele merece (`not_interested`, em geral), o `handoff_summary` dele não é sobrescrito e o
funil não ganha uma transferência que nunca existiu. Se a IA esquecer o resumo, o sistema manda
a última mensagem do lead crua — melhor um texto sem formatação do que um contato perdido.

Ordem no encerramento, que o prompt cobra: `disable_followup` sai já na mensagem em que a SDR
pede a indicação (quem não é mais do ramo não pode continuar recebendo follow-up), e
`mark_not_interested` só depois da resposta — encerrar antes mata a pergunta que acabou de ser
feita. As indicações aparecem na própria conversa e nos `ai_runs` (a ação fica no
`parsed_json`); no WhatsApp do Fernando elas chegam com o cabeçalho "Indicacao recebida pela
<SDR>", diferente do handoff.

O `prompt.txt` também absorveu duas regras que estavam só no portal e nunca tinham sido
versionadas: a SDR nunca diz "vou passar você para o Fernando" (ele não responde por este
número — o que sai daqui é o contato indo para o WhatsApp dele) e nunca solta o nome sozinho,
já que o lead não sabe quem é Fernando: ele é "o Fernando, dono da Insumo Smart".

## O que a primeira semana de conversas reais mudou aqui

A análise completa está em [`docs/analises/francielly-2026-08.md`](../../analises/francielly-2026-08.md).
Três coisas que este diretório afirmava não sobreviveram ao contato com as conversas:

**1. O exemplo negativo virava a resposta enviada.** O `prompt.txt` mostrava a resposta certa e a
errada lado a lado, rotuladas BOM e RUIM. Em produção, **6 das 7 explicações saíram com o texto
marcado como RUIM**, quase palavra por palavra, e a versão BOM não saiu nenhuma vez. O modelo
copia a frase e ignora o rótulo. Agora o erro é **descrito entre parênteses, nunca escrito**: se
voltar a existir uma frase ruim pronta no prompt, ela volta a ser enviada. O teste
`sdr-prompt-bundle` falha se `RUIM:` reaparecer.

**2. A proposta central era abstrata demais para ser entendida.** *"Acompanhar de perto os números
da operação e transformá-los em decisões práticas para a gestão financeira"* é verdade, mas ninguém
do outro lado entendeu. A CT Express gastou cinco rodadas de "não entendi", chegou a *"não quero
falar com ninguém não"*, voltou 40 minutos depois — e converteu no minuto em que ouviu **"custo de
insumo, margem por prato e preço de cardápio"**. Esses três exemplos concretos passaram a fazer
parte da frase, já na primeira explicação. Eles estavam no prompt antes, mas só como reformulação
para quando o lead reclamasse: tarde demais.

**3. O follow-up cobrava uma conversa que nunca aconteceu.** O texto padrão fala de "esse projeto" e
de "fechar as vagas" — e **9 dos 11 follow-ups** foram para leads que só tinham recebido "Opa, tudo
bom?". A Baunille respondeu o óbvio: *"pode deixar para outra empresa"*. O texto padrão foi escrito
quando a primeira mensagem ainda carregava o pitch inteiro; depois que a abertura virou o passo 1
sozinho, ele passou a cobrar quem não sabia de nada. Agora o `followup-prompt.txt` decide pelo
histórico: quem já ouviu o convite recebe o texto das vagas, quem parou antes recebe o passo em que
a conversa parou.

Também entrou uma regra que faltava: **"não entendi" não é aceite**. Em produção, `notify_handoff`
disparou logo depois de *"não entendi sua proposta"*, e o Fernando recebeu um lead cujo resumo era
"o lead não entendeu a explicação".

> **Nada disso está em produção até o Deploy.** Os prompts vivem no banco: depois do merge, é
> Deploy no EasyPanel e então `node dist/src/db/apply-sdr-prompts.js --agent="Franc" --apply` no
> Console. Rodar antes do Deploy grava o texto antigo.

Duas coisas que a análise apontou e que **não** foram mexidas aqui, porque são decisão do Fernando:
o bloco `LEAD NÃO É DO RAMO ESPERADO` que ele escreveu direto no portal (e que hoje cancela as três
regras de indicação), e a troca do modelo para `deepseek-v4-flash`.

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

`apply-sdr-prompts` grava os arquivos deste diretório no SDR. Ele roda dentro do container do
app (é quem enxerga o banco) e, sem `--apply`, só mostra o que mudaria. Em produção isso é o
**Console do serviço no EasyPanel**, que já abre um shell no container — e só depois de um
Deploy, senão o container ainda tem os arquivos antigos:

```bash
cd /app
node dist/src/db/apply-sdr-prompts.js --agent="Franc"            # mostra o plano
node dist/src/db/apply-sdr-prompts.js --agent="Franc" --apply    # grava
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
| `/sdr-agents/<id>/first-messages` → Variante ativa | `Opa, tudo bom?` (passo 1) | Sem variante ativa o portal cai na IA mesmo em modo fixo |

## O que medir

O funil desta SDR tem cinco números, e o terceiro é o que importa:

1. **enviadas → responderam** — mede o bloco 1, o "opa, tudo bom?".
2. **responderam → chegaram ao convite** — mede se a conversa sobrevive aos passos do meio.
3. **chegaram ao convite → disseram sim** — mede o convite em si. É a métrica da estratégia.
4. **sim → handoff acionado** — mede a IA e a pergunta da passagem, não o roteiro. São duas
   perdas diferentes: lead que disse sim e nem ouviu a pergunta (`handoff_offer` nunca chegou —
   o prompt não reconheceu o aceite, olhe os `ai_runs`) e lead que ouviu a pergunta e não
   respondeu (`handoff_offer` parado, sem `handoff_done`). Se a segunda perda crescer, é a
   pergunta a mais cobrando o preço dela.
5. **fora do perfil → indicação recebida** — o número de graça. Lead que não é do ramo e sai da
   conversa sem nenhum pedido de indicação é oportunidade perdida; procure `notify_referral` no
   `parsed_json` dos `ai_runs`.

Estágio de cada lead fica em `conversation_stage` (`permission`, `discovery`, `solution`,
`handoff_offer`, `handoff_done`, `not_interested`) e o dashboard já agrupa por ele. No
playbook `convite` os nomes têm outro significado: `permission` é a leitura da resposta à
abertura, `discovery` é o convite devolvido quando a resposta não foi um sim, `solution` é
a resposta curta ao "o que é isso?", `handoff_offer` é a pergunta da passagem no ar e
`handoff_done` é o contato já encaminhado ao Fernando.

Vale revisar as primeiras ~50 conversas à mão. Os quatro erros esperados são a IA explicando
demais na etapa `solution` (e o lead sumindo com a curiosidade satisfeita), handoff acionado
sem sim de verdade (o "o que é isso?" lido como aceite), handoff anunciado sem a pergunta da
passagem, e conversa encerrada com quem está fora do perfil sem o pedido de indicação.

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
