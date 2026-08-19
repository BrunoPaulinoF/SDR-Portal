# Variantes de primeira mensagem (teste A/B)

Estas são as mensagens fixas da tela **Msg inicial** (`/sdr-agents/<id>/first-messages`),
com o modo **teste A/B ligado**. Em A/B a primeira mensagem não passa pela IA: o texto sai
exatamente como está escrito aqui, sem custo de token e sem variação entre leads — que é o
que torna a comparação entre variantes honesta.

Placeholders: `{{sdrName}}` (nome do SDR), `{{responsavel}}` (complemento de "Falo com ___?":
usa o nome do negócio ou o primeiro nome do titular), `{{restaurante}}` (nome fantasia),
`{{nome}}` (contato). Aceita padrão com `|`, como em `{{restaurante|de vocês}}`, e o texto é
limpo automaticamente quando o lead não tem o dado.

As três variantes testam hipóteses diferentes sobre **onde** colocar o convite. Rode as três
com o mesmo volume até cada uma ter pelo menos ~80 envios antes de decidir.

---

## Variante A — Proposta

> Hipótese: o micro-pedido de permissão ("pode ser?") é mais fácil de responder do que
> qualquer outra coisa, e um "pode" já cria compromisso para a mensagem seguinte.
> É a mensagem original do Fernando, adaptada para o WhatsApp frio.

```
Opa, tudo bem? Aqui é a {{sdrName}} — também sou do ramo da gastronomia.

Falo com {{responsavel}}? Queria te fazer uma proposta, pode ser?
```

## Variante B — Chamou atenção

> Hipótese: dizer logo que a casa foi escolhida a dedo (e que o projeto é com poucas)
> compra mais atenção do que pedir licença, e ainda confirma quem decide.

```
Opa, tudo bem? Aqui é a {{sdrName}}, da Insumo Smart — sou do ramo da gastronomia também.

O Fernando tá começando um projeto pra acompanhar de perto poucas operações, e a {{restaurante|de vocês}} chamou nossa atenção. Falo com {{responsavel}}?
```

## Variante C — Convite direto

> Hipótese: o funil inteiro cabe em uma mensagem. Se o convite é de baixo compromisso
> ("saber mais"), talvez não valha gastar dois turnos para chegar nele.
> Risco conhecido: o "sim" pode vir de quem não decide — por isso a SDR confirma
> com quem fala antes de acionar o handoff.

```
Opa, tudo bem? Aqui é a {{sdrName}} — também sou do ramo da gastronomia.

O Fernando tá começando um projeto acompanhando de perto poucas operações daqui, e a {{restaurante|de vocês}} chamou a atenção da gente. Gostaria de saber mais sobre o projeto?
```

---

## O que NÃO colocar em nenhuma variante

- O que o projeto faz (CMV, custo, margem, ficha técnica). A curiosidade é o ativo.
- Número, porcentagem, promessa de resultado, quantidade de vagas ou prazo.
- Link, telefone, site, e-mail.
- "Reunião", "call", "agenda", "15 minutinhos". Convite ≠ compromisso com hora marcada.
- Pergunta sobre a operação ("como você controla o custo aí?"). Discovery é do Fernando.
- Dois emojis, ou mais de 3 linhas.
