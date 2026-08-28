# Francielly — desempenho, pontos fortes e pontos fracos (28/08/2026)

Segunda leitura das conversas da Insumo Smart, três dias depois de
[`francielly-2026-08.md`](francielly-2026-08.md). O objetivo aqui é duplo: dizer **o que a
semana entregou** e **quais das correções pedidas no dia 25 já apareceram na conversa real**.

## O que foi lido

As **66 conversas** com qualquer atividade entre 24 e 28/08 (todas as que o portal lista no
período), lidas mensagem a mensagem, mais o dashboard filtrado por SDR, as **380 chamadas de IA**
da Francielly desde 24/08 e as **2.843 linhas de job-log** dela. Fora da conta, como sempre, o
número de teste **+55 19 97125-3411** — 3 conversas na janela.

Composição dos 63 toques reais:

| Tipo de toque | Quantidade |
| --- | --- |
| Abordagem nova ("Opa, tudo bom?") | 37 |
| Segundo toque com o texto das vagas | 16 |
| Segundo toque vendendo "software" | 6 |
| Segundo toque novo (`bump`) | 4 |

## A semana foi decidida pelo canal, não pelo pitch

Antes de qualquer leitura de conversa: **a Francielly passou ~64 das últimas 96 horas sem
conseguir enviar.** O job-log dá a hora exata de cada transição.

| Quando | O que aconteceu |
| --- | --- |
| 25/08 20:00 | último envio normal |
| 25/08 20:06 → 27/08 11:24 | instância UAZAPI fora: **856 tentativas falhadas**, `HTTP 503`, zero envio no dia 26 inteiro |
| 27/08 11:24, 11:25, 11:48 | volta do ar; 3 envios |
| **27/08 11:48:27** | **o WhatsApp trava a conta**: `error 463`, `WHATSAPP_REACHOUT_TIMELOCK`, `until: 2026-08-28T11:48:27Z` |
| 27/08 18:00–19:10 | 44 tentativas recusadas com `HTTP 500` / 463 |
| 28/08 11:49 | trava expira; até 12:45 saíram 3 abordagens e 4 segundos toques |

O texto do erro é o ponto:

> "WhatsApp reported that the currently connected account is under a temporary restriction for
> starting new conversations, usually related to **sending volume or quality**."

Não é a UAZAPI, não é o portal: é o WhatsApp classificando o número. E o motivo mais provável está
na própria base — **417 dos 1.853 leads (23%) são `telefone inexistente`**, e o disparo está
configurado para abrir **40 conversas novas por dia**. Abrir 40 conversas diárias com números onde
quase um quarto não existe é exatamente o padrão que aciona esse bloqueio.

Consequência para todo número deste relatório: a "semana" da Francielly teve na prática **um dia e
meio de operação**. As taxas abaixo valem, mas sobre uma amostra pequena.

## Números da janela (24–28/08, sem o número de teste)

| Etapa | Leads | % das abordagens |
| --- | --- | --- |
| Abordagens novas | 37 | 100% |
| Qualquer inbound | 25 | 68% |
| **Resposta de gente** (fora o robô da loja) | **9** | **24%** |
| Ouviram a proposta | 3 | 8% |
| Handoff | 2 | 5% |

Os 26 segundos toques renderam 3 respostas (HNT, Soko Lounge, Depósito Cervejeiros) e **1 handoff**
— o Depósito Cervejeiros, lead de junho reativado. Total da janela: **3 handoffs, todos reais**,
nenhum do número de teste.

**O dashboard segue otimista pelo mesmo motivo de antes.** Ele mostra **64% de taxa de resposta e
7% de handoff** nos últimos 7 dias. Das 25 conversas com inbound, **16 nunca tiveram uma pessoa do
outro lado** — só cardápio, horário de funcionamento e "seja bem-vindo". A taxa com gente é **24%**.
Foi 35% na semana anterior; com 9 leads humanos numa amostra de 37, a diferença ainda está dentro
do ruído, mas a direção não é boa e merece a próxima semana cheia para ser lida.

## Pontos fortes

### 1. A frase vaga sumiu — e o prompt do portal voltou a ser o versionado

O problema nº 1 do relatório anterior era a SDR responder "o que é?" com a frase que o próprio
prompt marcava como **RUIM** (6 de 7 vezes). Na janela atual isso **não aconteceu nenhuma vez**.
As 4 explicações dadas usaram a versão concreta, e três delas produziram avanço real:

- **Disk Pizzaiolo** (25/08) — "Antes o que é exatamente a insumo smart?" → explicação → *"Pode
  chamar"*. Handoff em 6 minutos de conversa.
- **Depósito Cervejeiros** (24/08) — "Que seria o projeto" → explicação → *"Pode ser"*. Handoff.
- **Don Fritzz** (27/08) — "O que seira? 😁" → explicação → adiamento educado, encerrado sem
  desativar follow-up. Comportamento correto.

Além disso, o `prompt` gravado no portal hoje é **byte a byte igual** a
`docs/prompts/insumosmart/prompt.txt`. O bloco escrito à mão "LEAD NÃO É DO RAMO ESPERADO", que
sozinho cancelava três regras de indicação, **não está mais lá**.

### 2. O pedido de indicação voltou

Com o bloco removido, o comportamento das seções FORA DO PERFIL e INDICAÇÃO reapareceu:

- **Soko Lounge** — *"Oi, não tenho mais restaurante"* → *"Como você já foi do ramo, será que pode
  me passar algum contato que se interessaria, por favor?"* → o lead não tinha, e ela encerrou bem.
- Nos dois testes com "não sou da gastronomia", ela pediu indicação nas duas vezes.

Na semana anterior foram 3 leads fora do perfil e **zero** pedidos de indicação. Agora é 3 de 3.

### 3. O segundo toque parou de cobrar uma conversa que nunca houve

O `bumpPrompt` novo está no ar e os 4 segundos toques de hoje saíram com o texto padrão:

> "Opa! Aqui é a Francielly, também sou do ramo da gastronomia. Queria te fazer uma proposta,
> pode ser?"

É o oposto do texto antigo, que cobrava "as vagas" de quem só tinha recebido "Opa, tudo bom?" — e
que na semana passada fez a Baunille responder *"pode deixar para outra empresa"*. Na janela atual
16 leads ainda receberam o texto velho, mas **todos antes do deploy de 27/08 11:41**; o HNT reagiu
como se esperava (*"qual projeto? não sei nem do que está falando"*). Depois do deploy, nenhum caso.

### 4. O handoff virou pergunta

| | semana 20–25/08 | janela 24–28/08 |
| --- | --- | --- |
| "posso pedir pro Fernando te chamar?" antes de passar | 2 | 2 |
| "já pedi / já avisei" sem pergunta | 7 | 1 |

Disk Pizzaiolo e Depósito Cervejeiros tiveram pergunta explícita e **sim explícito** antes do
`notify_handoff`. Era o item 4 do relatório anterior e mudou de fato.

### 5. Tempo de resposta e custo

- Mediana de **1 minuto** entre a fala do lead e a resposta, **28 de 29** respostas em até 2 minutos.
- **90,6% de cache de prompt** — a ordenação estável→volátil está funcionando.
- O loop de follow-up que gastava 23% dos tokens está **corrigido no código**
  (`followup-outreach.ts` separa hoje `refused` de `error`, e `giveUp` desativa o follow-up na
  recusa). As 234 gerações para 41 leads que aparecem em `ai_runs` desde 24/08 são quase todas do
  dia 26, quando cada envio recusado pelo canal reagendava e regerava — outro sintoma da queda, não
  do laço antigo.

## Pontos fracos, do mais caro para o menos

### 1. A conta está sendo travada pelo WhatsApp, e nada no funil compensa isso

É o item mais caro da semana e não tem nada a ver com o pitch. Enquanto o `reachout_timelock`
estiver em jogo, melhorar a conversa não muda o resultado — não há conversa. Os três fatos que
sustentam o diagnóstico: 40 conversas novas/dia configuradas, 23% da base com número inexistente, e
o próprio WhatsApp citando "volume ou qualidade".

### 2. A explicação ainda não tem as três palavras concretas

O relatório anterior pediu que a frase da proposta carregasse **"custo de insumo, margem por prato e
preço de cardápio"** — os três exemplos que converteram a CT Express em *"Sim. Fala ele me mandar as
info."* O exemplo BOM foi reescrito, mas sem eles:

> "A proposta é acompanhar de perto os números da operação e transformar isso em decisão prática de
> gestão. (…) Posso pedir pra ele te chamar?"

É melhor que a versão vaga, mas continua sem dizer *quais* números. A **Casa & Comida** ouviu
exatamente essa frase e respondeu, no minuto seguinte, *"Não temos interesse. Obrigada."*

E o exemplo marcado como **RUIM** continua **reproduzido literalmente** no prompt (linha 34 do
`prompt.txt`). Ele não saiu em produção nesta janela, mas a razão de tirá-lo não mudou: enquanto o
texto errado estiver escrito ali, ele é candidato a sair.

### 3. Ela responde ao robô da loja — e a IA custa caro para decidir não responder

Duas falhas do filtro na janela:

- **O Ponto Lanches** (hoje) — a resposta automática chegou **duas vezes**, sem nenhuma pessoa, e
  ela respondeu *"Opa! Tem alguém aí que cuida da operação do Ponto Lanches?"*
- **Serginho Lanches** (25/08) — o robô mandou o horário de funcionamento e ela respondeu *"Opa, que
  bom! Também sou do ramo da gastronomia…"*, tratando o robô como pessoa.

Em outras 11 conversas o filtro acertou. O custo do acerto, porém, é alto: das **76 chamadas de
`reply_generation` desde 24/08, 41 (54%) terminaram em `nao_responder: true`**. Mais da metade do
maior item de token da SDR (1,05 milhão desde 24/08) é o modelo lendo cardápio de pizzaria para
concluir que não deve responder. Um filtro determinístico antes da IA — link de cardápio + horário
de funcionamento + "seja bem-vindo" + "faça seu pedido" — corta esse gasto e as duas falhas acima
de uma vez.

### 4. Handoff sem o consentimento de quem vai receber a ligação — Stout Burger (24/08)

O atendente passou o telefone da gerente: *"Thainá Gerente Phone: +55 19 99351-5699"*. A resposta
foi *"Ah, perfeito, obrigada! Já pedi para o Fernando, dono da Insumo Smart, falar com a Thainá."*
A Thainá nunca foi consultada e nunca ouviu a proposta; o Fernando recebeu um número frio. É correto
pela regra do contato interno e continua sendo **aviso, não pergunta** — a única ocorrência de "já
pedi" na janela é justamente aqui.

### 5. Um lead está sem resposta desde 25/08 — Retro House

25/08, 12:01: *"Olá, ótima tarde! Seja bem-vindo(a) ao Retrô House🧡 Tudo bem? **Com quem falo?**"*
Nenhuma resposta desde então. A mensagem tem cara de saudação padrão, mas termina numa pergunta
direta — é exatamente o caso em que o filtro de robô erra para o lado caro. Três dias parada.

### 6. Casa & Comida: 2h11 de atraso na única resposta que precisava ser rápida

*"Do que se trata"* às 11:19. Resposta às **13:30**. *"Não temos interesse"* às 13:31. Todas as
outras 28 respostas da janela saíram em até 2 minutos. O `pending-reply` — a rede de segurança que
existe justamente para o lead que falou e ficou sem resposta, com tolerância de 3 minutos — não
pegou este caso.

### 7. O segundo toque vendeu um software inventado, inclusive para uma psicóloga

Seis conversas fugiram do texto padrão e viraram pitch de produto:

- **Picolini & Alves** — *"Tenho um software que ajuda no dia a dia de restaurantes. Vocês já usam
  algo parecido?"*
- **Jose**, **Kleber**, **Cachacaria**, **G2C Alimentos** — variações do mesmo.
- **Paula Marcia de Lima Pedromilo** — *"Nosso software organiza a agenda e o atendimento de
  **clínicas de psicologia**. Quer que eu te mostre como funciona?"* Produto que não existe, para
  um lead que nem é do ramo.

Todos os seis são **anteriores ao deploy de 27/08 11:41** (o último, G2C, saiu às 08:25 daquele dia),
e o `bumpPrompt` novo proíbe explicitamente esse comportamento. Fica registrado porque nenhuma dessas
conversas foi limpa e a Paula continua na base como lead ativa.

### 8. Follow-up ignorou uma recusa já registrada — Gringa Smoke

03/07, o lead: *"Esse telefone é de taxi"*. 24/08, a SDR: *"Passei novamente porque estou fechando as
empresas que vão participar desse projeto…"* A regra de `nao_responder` do `followup-prompt.txt`
cobre "não é do ramo de gastronomia" e não pegou — o histórico estava a dois meses de distância, mas
estava lá.

### 9. O modelo continua no flash, e 3,7% das respostas vêm quebradas

A recomendação de voltar ao **deepseek-v4-pro** até haver uma semana medida não foi aplicada: o SDR
segue em **deepseek-v4-flash**, agora com `aiReasoningEffort: high`. Em 380 chamadas desde 24/08,
**12 falharam com `Unexpected end of JSON input`** e 2 com JSON inválido — 3,7% de saída quebrada. A
latência mediana da chamada é de **13s** (p90 31s), alta para um modelo escolhido por ser rápido.

### 10. Dois botões de digitação estão mortos

`responseDelayBaseMs = 15000` com `responseDelayMaxMs = 12000`. O cálculo é
`Math.min(max, base + tamanho × porCaractere)`, então o resultado é **sempre 12000** — o teto está
abaixo do piso, e tanto o delay base quanto o por caractere não têm efeito nenhum. Toda parte de
mensagem espera exatamente 12 segundos, independente do tamanho. O padrão do portal para o base é
1200, não 15000.

## O que fazer

Em ordem de retorno sobre esforço.

**1. Tratar o bloqueio do WhatsApp como o problema nº 1 da semana.** Enquanto ele existir, nenhuma
mudança de prompt aparece no resultado. Três medidas que atacam a causa citada pelo próprio erro:

- Baixar `dailyInitialSendLimit` de **40 para 15–20** por uns dias e observar se o `reachout_timelock`
  volta.
- **Validar o número no WhatsApp antes de o lead entrar na fila.** Hoje o portal só marca
  `invalid_phone` *depois* de tentar enviar — ou seja, cada número morto é uma conversa nova
  recusada, que é o que o WhatsApp está contando contra a conta.
- Ler `/instance/wa_messages_limits` (o endpoint que a própria UAZAPI aponta em
  `diagnostics_endpoint`) e mostrar o estado no dashboard, junto do alerta de SDR parado.

**2. Colocar as três palavras concretas na frase da proposta.** Texto sugerido para a etapa
`solution`, o mesmo do relatório anterior:

> "A proposta é acompanhar de perto os números da operação — **custo de insumo, margem por prato e
> preço de cardápio** — e transformar isso em decisão prática de gestão. Como funcionaria aí depende
> de conhecer a sua casa, e quem faz isso é o Fernando, dono da Insumo Smart. Posso pedir pra ele te
> chamar?"

E **apagar o exemplo RUIM** da linha 34, substituindo-o por uma descrição do erro ("resposta que não
diz de que se trata e termina sem pergunta") em vez do texto errado escrito por extenso.

**3. Filtro determinístico de resposta automática, antes da chamada de IA.** Resolve as duas falhas
do item 3 e devolve mais da metade do orçamento de `reply_generation`. Um teste simples sobre o texto
do inbound (link de cardápio, horário de funcionamento, "seja bem-vindo", "faça seu pedido", "estamos
fechados") já cobre todos os casos vistos na janela.

**4. Responder a Retro House hoje** e revisar o critério: mensagem de saudação que **termina em
pergunta ao interlocutor** ("com quem falo?", "como posso ajudar?") deve ser tratada como pessoa, não
como robô. O custo do falso positivo é um lead parado três dias; o do falso negativo é uma mensagem a
mais para um bot.

**5. Nenhum "já pedi" quando quem vai ser chamado não está na conversa.** No caso do contato interno
(Stout Burger), a mensagem certa é pedir permissão a quem passou o contato *e* avisar que o Fernando
vai se apresentar — não anunciar um pedido já feito.

**6. Investigar por que o `pending-reply` não pegou a Casa & Comida.** É a rede de segurança do
caminho todo; se ela falha silenciosamente, o atraso de 2h11 pode se repetir em qualquer lead quente.

**7. Limpar os resíduos do segundo toque antigo**: descartar a Paula Marcia (psicóloga) e revisar os
outros cinco leads que ouviram "software", que hoje estão na base com uma promessa que a Insumo Smart
não faz.

**8. Voltar ao `deepseek-v4-pro`** até existir uma semana inteira medida no flash — e, quando for
testar de novo, trocar **só o modelo**, com o prompt parado. Trocar os dois juntos, como aconteceu em
24/08, torna impossível saber a quem creditar a diferença.

**9. Corrigir `responseDelayMaxMs`** para acima do base (ou devolver o base ao padrão de 1200).

## O que medir na próxima semana cheia

A mesma lista do relatório anterior, com os descontos aplicados, mais uma métrica nova de canal:

1. **envios recusados pelo WhatsApp / envios tentados** — hoje o número que manda em todos os outros.
2. **resposta humana / abordagens** — 35% (20–25/08) → 24% (24–28/08). Exclua o robô da loja.
3. **ouviu a proposta / respondeu como gente** — 3 de 9 nesta janela.
4. **handoff com pergunta / handoff total** — 2 de 3, contra 2 de 7 na semana anterior.
5. **indicações pedidas / leads fora do perfil** — 3 de 3, contra 0 de 3.

E sempre com o **número de teste (+55 19 97125-3411) fora da conta**.
