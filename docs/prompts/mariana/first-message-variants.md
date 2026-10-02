# Primeira mensagem da Mariana — variantes propostas

A primeira mensagem **não** sai do `prompt.txt`. Ela vem da tela
`/sdr-agents/<id>/first-messages`, em modo "Mensagem fixa": o texto da variante ativa é
enviado exatamente como está escrito, sem IA. É por isso que ela é idêntica em todas as
conversas — e é o único texto que 100% da base lê.

## A abordagem são duas mensagens (17/09)

Desde 17/09 a abordagem sai em **duas** mensagens, uma atrás da outra, no mesmo disparo e sem
esperar o lead responder:

1. **a apresentação curta** — as variantes deste arquivo, na tela `Msg inicial`;
2. **a explicação** — `second-message.txt`, no campo "Segunda mensagem da abordagem" da mesma
   tela. É ela que diz o que o sistema faz, que ele roda dentro do próprio WhatsApp da loja,
   no mesmo número, e que existe **teste grátis de 3 dias**.

A divisão é o ponto: a apresentação sozinha não tem o que o dono classifica como anúncio, e a
explicação chega depois de ele já ter lido um "oi" de gente. Quem juntar as duas coisas numa
mensagem só volta ao textão que a variante B era.

Regra de redação que nasce daí: **nada do que está na segunda mensagem entra na primeira** —
nem recurso, nem o teste grátis, nem "a gente tem uma IA que...".

## Variantes no ar

Esta seção é a fonte das variantes ativas da Mariana. `apply-sdr-prompts --apply` grava cada
`### rótulo` com o bloco de código logo abaixo como variante **ativa**, e **pausa** (não apaga)
qualquer outra variante ativa que não esteja aqui — as métricas dela ficam guardadas. Cada
gravação vai para o histórico de mudanças da tela do SDR.

As duas seguem o princípio da seção mais abaixo: curtas, cara de gente, sem "comercial", sem
falar de IA (quem explica o sistema é a segunda mensagem) e com uma pergunta que se responde em
duas palavras. **Só a abertura muda entre elas** — a segunda mensagem é a mesma —, então a
diferença no resultado é da abertura. Decida pela tela `Msg inicial`, que só declara vencedora
com 150 envios de cada e diferença real.

### Nao e pedido

```
oi, tudo bem? aqui é a Mariana, da KyberFood. não é pedido não 😄 queria falar com quem cuida do WhatsApp do {{restaurante|delivery}}. é você mesmo?
```

### Nao sou cliente

```
oi! aqui é a Mariana, da KyberFood. não sou cliente não, mas é rápido e é sobre o atendimento do WhatsApp de vocês. falo com {{responsavel}}?
```

## O que esteve no ar até 02/10

Em 02/10 a variante ativa no banco ainda era o texto antigo (abaixo, "O texto anterior"), embora
este arquivo dissesse desde 22/09 que ele tinha mudado: a troca era manual, pela tela, e não
aconteceu. É por isso que as variantes passaram para a seção acima, gravada pelo script, e que a
tela do SDR avisa quando o banco diverge dos arquivos.

## O que deveria estar no ar desde 22/09

Variante **"B"**, única ativa, com o texto ajustado à abordagem de duas mensagens:

> Olá, tudo bem? Me chamo Mariana, sou da KyberFood. Queria falar sobre o atendimento do
> WhatsApp de vocês. Falo com {{responsavel}}?

Duas coisas saíram do texto anterior:

- **a explicação** ("a gente tem uma IA que atende o WhatsApp do delivery, responde na hora e
  monta o pedido sozinha"), que agora é a segunda mensagem. Mantê-la aqui faria o lead ler a
  mesma coisa duas vezes, uma mensagem colada na outra;
- **o "do comercial"**. Dizer "comercial" na primeira linha é dizer "sou vendedora" antes de a
  pessoa saber do que se trata. Vale para as variantes e para o `prompt.txt`.

O que ficou é a apresentação, o motivo do contato dito de forma concreta e a pergunta de duas
palavras.

### O texto anterior, e por que ele saiu

> Olá, tudo bem? Me chamo Mariana, sou do comercial da KyberFood. A gente tem uma IA que
> atende o WhatsApp do delivery, responde na hora e monta o pedido sozinha. Falo com
> {{responsavel}}?

Ele entregava o produto na primeira linha. Em dois segundos o dono classificava como "vendedor
de IA" e não respondia. O portal marcava 60% de resposta, mas quase tudo era o robô da própria
loja: de gente foram 27% na caixa inteira e 5% nas 20 últimas conversas
(`docs/analises/mariana-2026-09-02.md`).

## O princípio das variantes abaixo

Curiosidade não é pergunta esperta. **Pergunta retórica de vendedor sobre a rotina do lead —
"em dia de movimento, como vocês respondem o WhatsApp?", "quem cuida do delivery na correria?"
— é marketing disfarçado de pergunta.** Ela soa a robô, o lead reconhece o formato na hora e o
único impulso que gera é o de bloquear. Essas frases estão proibidas por escrito no
`first-message-prompt.txt`.

O que faz alguém responder um número desconhecido é bem mais simples e bem menos esperto:

1. **Parece escrita por uma pessoa.** Minúscula, curta, sem pontuação caprichada, sem emoji em
   fila, sem verbo de anúncio. Texto formatado é a assinatura do disparo em massa.
2. **Tem um motivo de contato concreto**, dito de verdade: o assunto é o WhatsApp do delivery
   dele. Isso é honesto e é o que ele quer saber.
3. **Não entrega o assunto inteiro.** Ele sabe que existe um assunto, não sabe qual. A
   curiosidade nasce aí, não de uma frase de efeito.
4. **Custa duas palavras para responder**: "sou eu", "é comigo", "sobre o quê?". Qualquer uma
   dessas já abre a ETAPA 1 — e a essa altura a segunda mensagem já explicou o que a Mariana
   faz, então a ETAPA 1 vai direto para a rotina da loja.
5. **Tira a mensagem da caixa de spam mental do dono.** Ele recebe pedido o dia inteiro e
   vendedor toda semana. Dizer de saída que não é pedido desarma a primeira categoria em que
   ele ia arquivar você sem ler. Sem se anunciar como "do comercial", que é a segunda.

## Variante de reserva

Nenhuma variante tem link, número, estatística ou saudação de período (a mensagem sai entre 15h
e 21h; "boa tarde" fixo denuncia automação metade das vezes). Esta fica fora do ar porque só
vale a pena com a base tendo o nome do contato:

> oi, {{nome|tudo bem}}? aqui é a Mariana, da KyberFood. queria falar sobre o WhatsApp do
> {{restaurante|seu delivery}} — não é pedido. é contigo mesmo?

Para testá-la, mova para a seção "Variantes no ar" como `### Pelo nome` com bloco de código, no
lugar da que perder o A/B — uma troca por vez.

## A segunda mensagem

O texto está em `second-message.txt` e é gravado por `apply-sdr-prompts` no campo
`secondMessage` do SDR (tela `Msg inicial` → "Segunda mensagem da abordagem"). Ele **não**
passa pela IA: sai igual para todo lead, com os mesmos placeholders das variantes, poucos
segundos depois da primeira — o intervalo é o delay de digitação do SDR.

Campo vazio = abordagem de uma mensagem só, como era antes. Falha no envio da segunda não
refaz a primeira: o lead já entrou como `initial_sent`, e o erro fica no `/job-logs` com a
chave `initial-second-<lead>`.

## Blocos de código neste arquivo

Só os blocos de código **dentro da seção "Variantes no ar"** viram variante. O resto do arquivo
usa citação (`>`) de propósito: sem a seção, `apply-sdr-prompts` trataria o primeiro bloco de
código do arquivo como o roteiro único (o modo do playbook `convite`, que a Insumo Smart usa) e
pausaria o A/B.

## Por que não voltar às variantes antigas

As variantes A–D originais mandavam o contato da pizzaria de demonstração e um link `wa.me` na
primeira mensagem. A prova é o melhor argumento da Mariana, mas gastá-la antes de existir
conversa desperdiça o único ativo dela: o lead recebe um link de um número desconhecido e
ignora — e link em primeira mensagem para número frio ainda derruba a entrega. O lugar da
prova é a ETAPA 2 do `prompt.txt`, assim que a pessoa der qualquer sinal de interesse.
