# Leads — gastronomia com delivery (São Paulo, ABC e interior)

`leads-gastro-delivery-sp.xlsx` — 500 leads ranqueados, coletados do Google Maps
via Apify em 26/08/2026. Três abas: **Leads** (a lista, já ordenada por score),
**Resumo** (contagens em fórmula, que se ajustam se você apagar linhas) e
**Criterio** (o que somou e o que subtraiu em cada lead).

## Import no portal

O arquivo entra direto em **Leads → Importar**, sem mapear coluna à mão: os
cabeçalhos já são os aliases que o `lead-importer.ts` reconhece — **Nome da
empresa**, **WhatsApp**, **Segmento**, **Cidade** e **Estado**. As 500 linhas
importam com zero erro (`tests/leads-gastro-planilha.test.ts` cobre isso).

Duas armadilhas que já quebraram o import uma vez, para não reintroduzir:

- **Célula vazia tem de ser `None`, nunca `''`.** O openpyxl grava string vazia
  como inline string sem conteúdo, e o `read-excel-file` do portal aborta a
  leitura do arquivo inteiro com `Unsupported "inline string" cell value
  structure` — antes mesmo de chegar no mapeamento de colunas.
- **Os cabeçalhos são contrato.** Renomear "Nome da empresa" ou "WhatsApp" faz o
  import cair em "Colunas obrigatorias nao encontradas". Por isso "Telefone
  (formatado)" e "Tem WhatsApp?" têm nomes propositalmente fora da lista de
  aliases: senão disputariam o mapeamento com a coluna do número.

## Como refazer

Precisa de um token da Apify em `local-secrets/apify-token` (ou `APIFY_TOKEN`).
Os três passos são independentes: o caro é o primeiro, e os outros dois rodam
quantas vezes for preciso sobre o dump já pago.

```bash
node scripts/apify-leads-gastro.mjs --dry-run   # só mostra o plano e o custo
node scripts/apify-leads-gastro.mjs             # varre e grava o dump bruto
node scripts/rank-leads-gastro.mjs --top=500    # pontua e ordena
python3 scripts/leads-gastro-xlsx.py            # monta o .xlsx
```

## O que define o ranking

O critério saiu do que a análise da Mariana (`docs/analises/mariana-2026-08.md`)
mostrou queimar a base:

- **18 dos 82 leads dela morreram como `invalid_phone`.** Por isso telefone
  celular vale mais que qualquer outro fator (+30): número fixo não tem WhatsApp.
- **27 das 33 "respostas" eram o robô da própria loja, não gente.** Por isso rede
  nacional leva −25: o número publicado é central de atendimento, e a unidade não
  decide sozinha sobre tecnologia.

Ter delivery quase não diferencia ninguém — 81% dos lugares marcam entrega no
perfil do Google. O que diferencia é ter **plataforma de pedido** (iFood, Anota
AI, Cardápio Web, Goomer, Menudino, Saipos): prova de operação digital rodando.

## Limites desta lista

- A varredura parou em **1.000 lugares (US$ 3,82)** porque a conta da Apify é free
  tier, com teto de US$ 5/mês. Isso limita a profundidade por cidade.
- Por consequência, **rede é subdetectada**: a marca só é reconhecida como rede se
  duas unidades caírem na mesma varredura rasa. Uma lista curta de franquias
  conhecidas cobre parte do resto.
- `orderBy`, `googleFoodUrl` e `menu` voltam sempre vazios do actor — o sinal de
  plataforma vem só do campo `website`, preenchido em 55% dos lugares.
- Telefone e delivery vêm do que o Google publica, e podem estar desatualizados.
