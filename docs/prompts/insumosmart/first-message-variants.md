# Mensagem inicial (texto fixo)

A abordagem da Insumo Smart é uma conversa de quatro passos, um por vez, esperando o lead
responder entre eles. Só o primeiro sai no disparo, como texto fixo; os outros três a SDR
conduz com as palavras dela, seguindo a conversa-base do Fernando.

Este arquivo é só o **bloco 1** — o texto da tela **Msg inicial**
(`/sdr-agents/<id>/first-messages`), com o modo em **mensagem fixa**: sai exatamente como está
escrito, sem passar pela IA, sem custo de token e sem risco de reescrita.

```
Opa, tudo bom?
```

Os passos 2, 3 e 4 estão em `prompt.txt`, na seção **A CONVERSA-BASE**, como referência de tom
e de ordem — a SDR responde o que o lead disse e emenda o passo seguinte:

| Passo | Ideia | Quando |
| --- | --- | --- |
| 1 | Opa, tudo bom? | disparo (este arquivo, texto fixo) |
| 2 | Também sou do ramo e queria te fazer uma proposta, pode ser? | depois da 1ª resposta |
| 3 | Tô começando um projeto com poucas casas e a de vocês chamou atenção | depois da 2ª resposta |
| 4 | Bora trocar uma ideia? | depois da 3ª resposta |

Só o passo 4 tem redação travada ("bora trocar uma ideia?"): é a pergunta que decide o funil.

> **Atenção ao modo.** No portal, mensagem fixa é o mesmo botão do teste A/B: uma variante
> ativa = todo lead recebe este texto. Com o modo em "gerada por IA", este arquivo não é
> usado — a IA escreve a abertura do zero, e é aí que ela volta a mandar a abertura
> consultiva ("posso te fazer uma pergunta sobre a operação?").

## Por que quebrado em quatro

O texto é o mesmo do Fernando; o que muda é o ritmo. As quatro frases numa mensagem só leem
como anúncio — o lead vê um bloco de texto de alguém que ele não conhece e não responde. Um
passo por vez, cada um é barato de responder, e cada resposta é um compromisso pequeno que
puxa o próximo:

1. **"Opa, tudo bom?"** — cumprimento de quem manda mensagem, não de quem faz abordagem. É a
   pergunta mais fácil do mundo de responder, e responder já abre a conversa.
2. **"Também estou no ramo... pode ser?"** — tira quem fala do lugar de vendedor e pede uma
   coisa minúscula. Quem responde "pode" entrou.
3. **"tô iniciando um projeto... chamou minha atenção"** — projeto, não produto: não há nada
   para avaliar, comparar ou orçar. E é a casa que foi escolhida.
4. **"bora trocar uma ideia?"** — o convite. Conversa entre dois do ramo, e é isso que se quer
   de resposta.

A pergunta do convite é **"bora trocar uma ideia?"**. Não é "Gostaria de saber mais sobre o
nosso projeto?", não é "posso te explicar como funciona?" e não é pergunta sobre a operação.

## Regras do texto

- **Sem emoji.** Nenhum, em nenhuma mensagem deste SDR.
- Sem link, telefone, site ou e-mail.
- Sem número, porcentagem, promessa de resultado, quantidade de vagas ou prazo.
- Sem "reunião", "call", "agenda", "15 minutinhos". Convite não é compromisso com hora marcada.
- Sem dizer o que o projeto faz (CMV, custo, margem, ficha técnica). A curiosidade é o ativo.
- Sem nome de produto, sem apresentação da empresa e sem assinatura.

## Como deixar no portal

Em `/sdr-agents/<id>/first-messages`:

1. Cadastrar **uma** variante com `Opa, tudo bom?`, marcada como ativa.
2. Clicar em **"Usar mensagem fixa (texto exato, sem IA)"**. O painel tem que passar a dizer
   "Mensagem fixa" — se estiver escrito "Gerada por IA", a mensagem sai errada.
3. Não cadastrar uma segunda variante: com duas ativas o portal entra em rodízio, e o roteiro
   deixa de ser um só.

`npm run sdr:prompts -- --agent="<id ou nome>" --apply` faz isso tudo de uma vez, incluindo a
conversa-base dentro do `prompt.txt`.
