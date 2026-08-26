# Primeira mensagem da Mariana — variantes propostas

A primeira mensagem **não** sai do `prompt.txt`. Ela vem da tela
`/sdr-agents/<id>/first-messages`, em modo "Mensagem fixa": o texto da variante ativa é
enviado exatamente como está escrito, sem IA. É por isso que ela é idêntica em todas as
conversas — e é o único texto que 100% da base lê.

## O que está no ar hoje

Variante **"Ancorada dor"**, única com envios (58 enviadas):

> Oi, tudo bem? Aqui é a Mariana. Trabalho com atendimento de WhatsApp pra delivery e queria
> trocar uma ideia rápida. Falo com {{responsavel|quem cuida do delivery aí}}?

O rótulo promete uma dor que o texto não tem. Ela pede permissão para falar e não dá nenhum
motivo para responder: quem lê não sabe o que é a KyberFood, não sabe o que vai ganhar e só
vê mais um vendedor pedindo atenção. O portal marca 57% de resposta, mas 27 das 33 respostas
são o robô da própria loja — de gente, foram 6 em 59 abordagens (10%). Ver
`docs/analises/mariana-2026-08.md`.

As variantes A–D (pausadas) têm o problema oposto: são cartas de vendas de 10 linhas, com
link `wa.me` e estatística inventada ("62% dos brasileiros…"), que é exatamente o formato que
o WhatsApp pune e que o dono de delivery não lê.

## Variantes propostas para o A/B

Ambas cabem em 3 linhas, dizem o que é antes de pedir qualquer coisa e terminam numa pergunta
que se responde de cabeça, em duas palavras. Nenhuma tem link, número ou estatística — link em
primeira mensagem para número frio derruba entrega e cheira a spam.

### Variante "Direta" (recomendada como A)

> Oi, tudo bem? Aqui é a Mariana, da KyberFood. A gente coloca um atendente de IA no WhatsApp
> do delivery pra responder pedido na hora, no pico e de madrugada.
> No {{restaurante|seu delivery}}, chega a ficar mensagem sem resposta quando enche?

### Variante "Escolha" (recomendada como B)

> Oi! Aqui é a Mariana, da KyberFood. Trabalho com uma IA que atende o WhatsApp do delivery e
> monta o pedido sozinha.
> Hoje vocês respondem o zap do {{restaurante|delivery}} na mão mesmo, ou já tem algum robô
> ajudando?

Com as duas ativas ao mesmo tempo, o rodízio compara as taxas. Deixe rodar até cada uma ter
pelo menos ~60 envios antes de decidir, e leia a taxa **descontando o robô da loja** — o
número da tela conta autoresposta como resposta.

## Por que não voltar às variantes A–D

Elas mandam o contato da pizzaria de demonstração na primeira mensagem. A prova é o melhor
argumento da Mariana, mas gasta-la antes de existir conversa desperdiça o único ativo dela: o
lead recebe um link de um número desconhecido e ignora. O lugar da prova é a ETAPA 2 do
`prompt.txt`, assim que a pessoa der qualquer sinal de interesse.
