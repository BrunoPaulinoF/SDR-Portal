# Primeira mensagem da Mariana — variantes propostas

A primeira mensagem **não** sai do `prompt.txt`. Ela vem da tela
`/sdr-agents/<id>/first-messages`, em modo "Mensagem fixa": o texto da variante ativa é
enviado exatamente como está escrito, sem IA. É por isso que ela é idêntica em todas as
conversas — e é o único texto que 100% da base lê.

## O que está no ar hoje

Variante **"B"**, única ativa (95 envios):

> Olá, tudo bem? Me chamo Mariana, sou do comercial da KyberFood. A gente tem uma IA que
> atende o WhatsApp do delivery, responde na hora e monta o pedido sozinha. Falo com
> {{responsavel}}?

Ela entrega o produto na primeira linha. Em dois segundos o dono classifica como "vendedor de
IA" e não responde. O portal marca 60% de resposta, mas quase tudo é o robô da própria loja:
de gente foram 27% na caixa inteira e 5% nas 20 últimas conversas
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
   dessas já abre a ETAPA 1, que é onde a Mariana finalmente diz o que faz.
5. **Tira a mensagem da caixa de spam mental do dono.** Ele recebe pedido o dia inteiro e
   vendedor toda semana. Dizer de saída que não é pedido — e que é comercial mesmo — desarma
   as duas categorias em que ele ia arquivar você sem ler.

## Variantes propostas para o A/B

Nenhuma tem link, número, estatística ou saudação de período (a mensagem sai entre 15h e 21h;
"boa tarde" fixo denuncia automação metade das vezes).

### Variante "Não é pedido" (recomendada como A)

> oi, tudo bem? aqui é a Mariana, da KyberFood. não é pedido não 😄 queria falar com quem cuida
> do WhatsApp do {{restaurante|delivery}}. é você mesmo?

### Variante "Comercial mesmo" (recomendada como B)

> oi! aqui é a Mariana, da KyberFood. não sou cliente não, é comercial mesmo — mas é rápido e é
> sobre o atendimento do WhatsApp de vocês. falo com {{responsavel}}?

### Variante "Pelo nome" (C, só vale a pena com a base tendo contato)

> oi, {{nome|tudo bem}}? aqui é a Mariana, da KyberFood. queria falar sobre o WhatsApp do
> {{restaurante|seu delivery}} — não é pedido. é contigo mesmo?

Com duas ou três ativas ao mesmo tempo, o rodízio compara as taxas. Deixe rodar até cada uma
ter ~60 envios antes de decidir, e leia a taxa **descontando o robô da loja** — o número da
tela conta autoresposta como resposta. Desde 02/09 o robô reconhecido é marcado como
`Automatica da loja` na caixa de conversas, o que dá para conferir a olho enquanto a métrica
da tela não separa os dois.

## Por que este arquivo não tem bloco de código

`apply-sdr-prompts` trata o **primeiro bloco de código** deste arquivo como *a* mensagem
inicial fixa: ele desativa todas as variantes ativas do SDR e deixa uma só, com o rótulo
`Roteiro` (ver `FIRST_MESSAGE_FILE` em `src/modules/sdr-agents/prompt-bundle.ts`). Como aqui
a proposta é um A/B com mais de uma variante ativa, e o script só sabe expressar uma, as
mensagens acima estão em citação (`>`) e não em bloco de código — assim `--apply` grava os
outros prompts e **não encosta** nas variantes.

Consequência prática: as variantes acima entram **na mão**, pela tela
`/sdr-agents/<id>/first-messages`. E não transforme nenhuma delas em bloco de código aqui só
para "ficar bonito": o próximo `--apply` derrubaria o A/B e deixaria a primeira delas sozinha
no ar.

## Por que não voltar às variantes antigas

As variantes A–D originais mandavam o contato da pizzaria de demonstração e um link `wa.me` na
primeira mensagem. A prova é o melhor argumento da Mariana, mas gastá-la antes de existir
conversa desperdiça o único ativo dela: o lead recebe um link de um número desconhecido e
ignora — e link em primeira mensagem para número frio ainda derruba a entrega. O lugar da
prova é a ETAPA 2 do `prompt.txt`, assim que a pessoa der qualquer sinal de interesse.
