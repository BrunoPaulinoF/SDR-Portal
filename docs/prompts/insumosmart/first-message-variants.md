# Mensagem inicial (texto fixo)

Esta é a mensagem de abordagem da Insumo Smart, **exatamente como o Fernando escreve**.
Ela é o texto da tela **Msg inicial** (`/sdr-agents/<id>/first-messages`), com o modo em
**mensagem fixa**: o texto sai como está escrito aqui, sem passar pela IA — sem custo de
token, sem variação entre leads e sem risco de a IA reescrever a pergunta.

> **Atenção ao modo.** No portal, mensagem fixa é o mesmo botão do teste A/B: uma variante
> ativa = todo lead recebe este texto; duas ou mais = rodízio entre elas. Com o modo em
> "gerada por IA", este arquivo não é usado — a IA escreve a abertura do zero, e é aí que
> ela volta a mandar a abertura consultiva ("posso te fazer uma pergunta sobre a operação?").

```
Opa, tudo bom?

Também estou no ramo da gastronomia e queria te fazer uma proposta, pode ser?

Então, tô iniciando um projeto onde vou acompanhar poucas empresas gastronômicas de perto, e a de vocês chamou minha atenção.

Acho que podemos fazer esse projeto juntos, bora trocar uma ideia?
```

Única diferença para o texto enviado pelo Fernando: "Opa, bom?" virou **"Opa, tudo bom?"**.
Se ele preferir o original, é trocar essa linha — nada mais depende dela.

## Por que este texto e não outro

Cada bloco faz uma coisa, e é por isso que a ordem não pode ser mexida:

1. **"Opa, tudo bom?"** — cumprimento de quem manda mensagem, não de quem faz abordagem.
2. **"Também estou no ramo da gastronomia... pode ser?"** — tira quem fala do lugar de
   vendedor e pede uma coisa minúscula. Quem responde "pode" já entrou na conversa.
3. **"tô iniciando um projeto... a de vocês chamou minha atenção"** — projeto, não produto:
   não há nada para avaliar, comparar ou orçar, só uma curiosidade em aberto. E é a casa que
   foi escolhida, não o vendedor que apareceu.
4. **"bora trocar uma ideia?"** — o convite. É conversa entre dois do ramo, e é isso que se
   quer de resposta.

A pergunta do convite é **"bora trocar uma ideia?"**. Não é "Gostaria de saber mais sobre o
nosso projeto?", não é "posso te explicar como funciona?" e não é pergunta sobre a operação
("como você controla o custo aí?"). Trocar essa frase por outra é o erro que essa versão
existe para corrigir.

## Regras do texto

- **Sem emoji.** Nenhum, em nenhuma mensagem deste SDR.
- Sem link, telefone, site ou e-mail.
- Sem número, porcentagem, promessa de resultado, quantidade de vagas ou prazo.
- Sem "reunião", "call", "agenda", "15 minutinhos". Convite não é compromisso com hora marcada.
- Sem dizer o que o projeto faz (CMV, custo, margem, ficha técnica). A curiosidade é o ativo.
- Sem nome de produto, sem apresentação da empresa e sem assinatura.

## Como deixar no portal

Em `/sdr-agents/<id>/first-messages`:

1. Cadastrar **uma** variante com o texto acima, marcada como ativa.
2. Clicar em **"Usar mensagem fixa (texto exato, sem IA)"**. O painel tem que passar a
   dizer "Mensagem fixa" — se estiver escrito "Gerada por IA", a mensagem sai errada.
3. Não cadastrar uma segunda variante: com duas ativas o portal entra em rodízio, e o
   roteiro deixa de ser um só. Se um dia houver teste, as variantes têm que manter os
   quatro blocos acima e terminar em "bora trocar uma ideia?" — o que se testa é a
   redação, nunca o convite.
