# Mariana — por que quase ninguém responde (26/08/2026)

Leitura das **64 conversas** da Mariana no portal (toda a caixa dela, não uma amostra), da
tela do SDR, da tela de Msg inicial e dos 2309 registros de `ai_runs` dela. A pergunta era
uma: por que tão pouca gente responde.

Resposta curta: **o prompt principal quase não está sendo usado.** Ele governa o que a Mariana
faz *depois* que alguém responde, e só 6 pessoas responderam. O que trava a operação está
antes dele — na primeira mensagem, na janela de envio e no robô das lojas.

## O funil real

82 leads na base da Mariana. 18 caíram como `invalid_phone` (número sem WhatsApp) e nunca
receberam nada. Sobraram **59 abordagens outbound** (mais 5 conversas iniciadas pelo próprio
lead):

| | Conversas | % das abordagens |
| --- | --- | --- |
| Abordagens enviadas | 59 | 100% |
| Qualquer inbound | 33 | 56% |
| **Resposta de gente** (fora o robô da loja) | **6** | **10%** |
| Chegaram a ouvir o que é a KyberFood | 8 | 14% |
| Receberam o contato da pizzaria de demonstração | 1 | 2% |
| Handoff | **0** | **0%** |

O único handoff da Mariana (`Handoff feito`, +55 19 99299-2100) foi um lead que **chamou ela**,
em 29/07 — não saiu de abordagem nenhuma.

E a distribuição por etapa do funil mostra o mesmo de outro jeito: das 64 conversas, **55 estão
paradas em "Permissao"**, a primeira etapa. 7 chegaram a "Descoberta", 1 a "Solucao".

### A taxa de 57% da tela é o robô da loja

A tela de Msg inicial mostra **58 enviadas, 33 respostas, 57%**. Esse número não pode virar
decisão: **27 das 33 são resposta automática da própria loja** — saudação de boas-vindas,
horário de funcionamento, link de cardápio, "faça seu pedido pelo app", "estamos fechados".
Nenhuma pessoa leu a mensagem nessas 27.

Descontando o robô, a taxa de resposta humana é **10%**, não 57%.

## As três causas, em ordem de tamanho

### 1. A primeira mensagem pede permissão e não dá motivo nenhum para responder

É um texto fixo, igual para todo mundo (variante "Ancorada dor", a única com envios):

> Oi, tudo bem? Aqui é a Mariana. Trabalho com atendimento de WhatsApp pra delivery e queria
> trocar uma ideia rápida. Falo com quem cuida do delivery aí?

Quem lê isso não sabe o que é a KyberFood, não sabe o que vai ganhar e vê só mais um vendedor
pedindo atenção. O rótulo diz "ancorada dor", mas não há dor nenhuma no texto — ele gasta a
única mensagem que 100% da base lê pedindo autorização para começar.

O mais revelador: **a segunda mensagem (o bump) faz o trabalho que a primeira deveria fazer.**

> Oi! Aqui é a Mariana, da KyberFood. Crio atendente de IA que vende pelo WhatsApp do delivery.
> No pico, sobra mensagem sem resposta?

Essa diz quem é, o que é e faz uma pergunta respondível. É o formato certo — só está no
lugar errado, dois dias depois.

### 2. A janela de envio é 08:00–18:00, de segunda a sexta — a loja está fechada

Essa é a causa das 27 respostas de robô. As próprias autorrespostas dizem o horário das lojas
da base: X Calota 17:30–23:20, Passion Burger 18:15–22:30, Escher 19h–23h, Box Smoker
17:30–22:30, General Burger 18:00–23:00, O Ponto 19h–23h, Serginho 19h–2h. A Mariana dispara
entre 08h e 18h — **25 das 59 abordagens saíram entre 12h e 14h** — e a janela fecha às 18:00,
exatamente quando o delivery começa.

Os horários das respostas humanas mostram para onde a janela deveria andar:

| Hora | 13h | 14h | 15h | 16h | 17h | 18h | 21h |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Respostas de gente | 2 | 3 | 2 | 5 | 6 | 1 | 2 |

**Nenhuma resposta humana antes das 13h.** Elas se concentram das 16h em diante, quando a
equipe chega para montar a noite — e ainda pingam às 21h, fora da janela.

### 3. O robô da loja é contado como "o lead respondeu" — e o follow-up pitcha para ele

Aqui a resposta ao vivo até se comporta: das 921 chamadas de `reply_generation`, **295 (32%)
saíram com `nao_responder: true`**, que é a Mariana reconhecendo autoatendimento e calando a
boca. Ao vivo, ela só entregou pitch para um robô em 2 conversas (Dicapri e Felicis).

O problema está um nível acima. Quando a autorresposta chega, ela grava `last_inbound_at` e o
lead vira `in_conversation` — ou seja, o sistema registra "esse lead respondeu". Dois dias
depois o job de follow-up olha essa conversa, entende que o lead **respondeu e esfriou**, e
manda um `reengage` com o pitch inteiro. Aconteceu em **8 conversas**: Casa & Comida, Instinto
Burger, Suprema Pizza, Bom Beef, Escher, Maluca Lanche, Box Smoker e Zezinho.

Em todas elas, a única coisa que existiu do outro lado foi um robô — e o segundo toque, que
era a chance de acertar, foi gasto respondendo a ele. Pior: quando o dono finalmente abrir o
WhatsApp e rolar a conversa, o que ele vai ver é um robô conversando com o robô dele.

A distorção aparece inteira nos números de `ai_runs`: **393 gerações em modo `reengage`
contra 11 em modo `bump`**. O `bump` — o texto pensado para quem nunca respondeu, que é a
situação real da maioria — quase não roda, porque a autorresposta das lojas tirou esses leads
da fila do bump e colocou na de reengajamento.

Esse é um ajuste de código, não de prompt: enquanto uma autorresposta contar como resposta do
lead, o funil vai continuar mentindo e o segundo toque vai continuar no modo errado. O
`nao_responder` da resposta ao vivo é o sinal que já existe e poderia marcar a conversa como
"sem gente até agora".

## O que acontece nas 6 conversas com gente

Todas as 6 morreram no mesmo lugar, e não é coincidência — é a pergunta de descoberta:

| Lead | Última coisa que a pessoa disse | O que a Mariana perguntou | Fim |
| --- | --- | --- | --- |
| Restaurante Godoy | "Sim" | "quem fica respondendo o zap aí nos picos?" | silêncio |
| Stout Burger | "Sim" | "no pico de sexta e sábado, quem fica respondendo o zap?" | humano assumiu na mão |
| Pizzaria Don Romeu | "Sobre o que seria, por favor?" | "nos picos, quem fica respondendo o zap aí?" | robô da loja respondeu |
| Dê Lanches | "Hoje já trabalhamos com a Saipos e Glutoes" | "no pico, quem fica no zap aí?" | silêncio |
| Puro Sabor | "O responsável está viajando" | "no pico, como vocês atendem as mensagens?" | silêncio |
| Disk Pizzaiolo | "Como funciona a atendente de IA?" | (mandou o contato da demo) | silêncio |

**"Quem fica respondendo o zap no pico?" é 0 de 6.** É uma pergunta aberta sobre a operação:
para responder, o dono precisa parar o que está fazendo e escrever um parágrafo. Quem está no
balcão não faz isso. O prompt oferece cinco perguntas sugeridas e **todas as cinco são abertas**.

Três detalhes agravam o quadro:

- **Ela gasta um turno confirmando com quem fala.** Em Godoy, Stout, Dê Lanches, Puro Sabor,
  Polillo e Dicapri, a pessoa já tinha respondido e a Mariana perguntou "é você quem cuida do
  delivery aí?". Em Godoy foram três turnos até chegar ao assunto.
- **Ela ignora o sinal mais forte que recebe.** Dê Lanches disse "já trabalhamos com a Saipos e
  Glutoes" — isso é a descoberta pronta, e ela respondeu perguntando se falava com o
  responsável.
- **Ela manda duas mensagens seguidas.** Serginho (17:51 e 17:52), Dê Lanches (17:52 e 17:53),
  Stout (15:57, 15:57 e 16:02) — perguntas quase idênticas em sequência, que é a assinatura
  de robô que o lead reconhece na hora.

## Dois problemas de configuração, fora do prompt

- **O campo "Prompt do segundo toque" (`bumpPrompt`) está VAZIO em produção**, embora
  `docs/prompts/mariana/bump-prompt.txt` exista no repositório. Sem ele, o bump — a segunda
  mensagem para quem nunca respondeu, que é o caso da maioria — cai no `followupPrompt`, que
  é escrito para "um lead que já respondeu alguma coisa e depois esfriou".
- **33% das gerações de follow-up falham.** São 129 erros em 393 chamadas de
  `followup_message_generation` (`Unexpected end of JSON input` e `status_sugerido` nulo),
  contra 7 erros em 921 de `reply_generation`. Vale investigar à parte: é desperdício de token
  e atraso no segundo toque.

Também vale notar o volume: 921 chamadas de `reply_generation` para 64 conversas, sendo
**295 com `nao_responder: true`** (32%). A maior parte é a Mariana decidindo, corretamente,
não responder a robô — mas é IA sendo paga para ler autoatendimento.

## O que mudar, em ordem de impacto

**1. Trocar a primeira mensagem** (tela Msg inicial). Duas variantes prontas para o A/B em
`docs/prompts/mariana/first-message-variants.md`. Ambas dizem o que é a KyberFood antes de
pedir qualquer coisa e terminam numa pergunta de duas palavras. Deixe as duas ativas: o
rodízio compara.

**2. Mover a janela de envio** (tela do SDR):

| Campo | Hoje | Proposto |
| --- | --- | --- |
| `sendWindowStart` | 08:00 | **15:00** |
| `sendWindowEnd` | 18:00 | **20:00** |
| `sendDaysOfWeek` | `1,2,3,4,5` (seg–sex) | **`2,3,4,5,6`** (ter–sáb) |

Das 15h em diante a loja está aberta ou montando a noite, e tem gente com o celular na mão.
Terça a sábado porque segunda é o dia de folga mais comum no delivery e sábado é dia útil
para eles.

**3. Colar o `bump-prompt.txt` no campo "Prompt do segundo toque"**, que está vazio.

**4. As mudanças no `prompt.txt`** (já aplicadas neste commit):

- **Filtro de robô promovido ao topo**, antes do funil, com a lista concreta do que é
  autorresposta (saudação com nome da loja, horário, link de cardápio, "faça seu pedido",
  cumprimento que repete "Comercial") e a ordem explícita de não fazer pitch para ela.
- **A etapa de permissão deixou de existir.** O funil foi de 4 para 3 etapas e a regra agora é
  literal: se veio qualquer resposta de gente, diga o que é e pergunte na MESMA mensagem;
  nunca gaste um turno confirmando com quem fala.
- **O banco de perguntas foi trocado.** Saíram as cinco perguntas abertas; entraram cinco
  fechadas ("chega a ficar mensagem sem resposta?", "na mão mesmo ou já tem robô?"), com
  proibição explícita de pergunta aberta de trabalho.
- **A prova foi antecipada.** O contato da pizzaria de demonstração não depende mais de
  descoberta concluída: vai assim que a pessoa perguntar como funciona, responder qualquer
  coisa, ou a conversa travar.
- **Regra dura 8 e 9**: nunca duas mensagens seguidas sem resposta do lead; nunca perguntar
  duas vezes a mesma coisa.
- **Sistema citado pelo lead virou regra**: "já uso Saipos/Anota/Goomer" é a resposta da
  descoberta, não um obstáculo — espelha e vai para a prova. Entraram duas objeções novas
  ("já uso outro sistema" pelo nome, e "só pegamos pedido por link/app").
- **Restaurada a regra dura 7** (a Mariana não é a IA de atendimento), que existia no
  repositório e tinha sumido do texto em produção.
- Emoji: produção dizia "SEM emojis" e ela usava assim mesmo, em quase toda conversa. A regra
  voltou para "no máximo 1 por mensagem", que é o que ela consegue cumprir.

## Como medir se funcionou

A taxa da tela conta robô. Para saber se mudou de verdade, o número a acompanhar é
**quantas conversas tiveram uma frase curta, pessoal e fora de script** — hoje 6 em 59. Com a
primeira mensagem e a janela novas, a meta razoável para a próxima leva é dobrar isso antes de
mexer em qualquer outra coisa.

E vale repetir o que a base já diz: 18 dos 82 leads (22%) não têm WhatsApp. Isso não é
problema de prompt, mas come um quinto de cada lista importada.
