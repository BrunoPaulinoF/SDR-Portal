# Leads — gastronomia com delivery (estado de São Paulo)

Duas listas, do mesmo pipeline e do mesmo critério, sem lead repetido entre elas:

| Arquivo | Leads | Praças | Coleta |
| --- | --- | --- | --- |
| `leads-gastro-delivery-sp.xlsx` | 500 | São Paulo, Campinas, Guarulhos, Santo André, Ribeirão Preto, Sorocaba, São José dos Campos | 26/08/2026 |
| `leads-gastro-delivery-sp-lote2.xlsx` | 174 | São Bernardo do Campo, Osasco, Santos | 02/09/2026 |

Cada arquivo tem três abas: **Leads** (a lista, já ordenada por score), **Resumo**
(contagens em fórmula, que se ajustam se você apagar linhas) e **Criterio** (o que
somou e o que subtraiu em cada lead).

`telefones-ja-entregues.json` é a lista dos 500 números do primeiro lote. É o que
o `rank-leads-gastro.mjs` recebe em `--exclude` para uma varredura nova render só
lead novo — sem isso a segunda rodada devolveria as mesmas casas no topo (elas
continuam sendo as melhores do critério) e o SDR dispararia duas vezes para o
mesmo número.

## Import no portal

O arquivo entra direto em **Leads → Importar**, sem mapear coluna à mão: os
cabeçalhos já são os aliases que o `lead-importer.ts` reconhece — **Nome da
empresa**, **WhatsApp**, **Segmento**, **Cidade** e **Estado**. As linhas importam
com zero erro (`tests/leads-gastro-planilha.test.ts` cobre **toda** planilha do
diretório, então um lote novo já nasce testado).

Duas armadilhas que já quebraram o import uma vez, para não reintroduzir:

- **Célula vazia tem de ser `None`, nunca `''`.** O openpyxl grava string vazia
  como inline string sem conteúdo, e o `read-excel-file` do portal aborta a
  leitura do arquivo inteiro com `Unsupported "inline string" cell value
  structure` — antes mesmo de chegar no mapeamento de colunas.
- **Os cabeçalhos são contrato.** Renomear "Nome da empresa" ou "WhatsApp" faz o
  import cair em "Colunas obrigatorias nao encontradas". Por isso "Telefone
  (formatado)" e "Tem WhatsApp?" têm nomes propositalmente fora da lista de
  aliases: senão disputariam o mapeamento com a coluna do número.

## Como puxar mais leads

Precisa de um token da Apify em `local-secrets/apify-token` (ou `APIFY_TOKEN`).
Os três passos são independentes: o caro é o primeiro, e os outros dois rodam
quantas vezes for preciso sobre o dump já pago.

```bash
node scripts/apify-leads-gastro.mjs --dry-run    # só mostra o plano e o custo
node scripts/apify-leads-gastro.mjs              # varre as cidades ainda não varridas
node scripts/rank-leads-gastro.mjs --top=500 \
  --exclude=docs/leads/telefones-ja-entregues.json \
  --out=local-secrets/leads-ranked-lote3.json    # pontua, ordena e tira repetido
python3 scripts/leads-gastro-xlsx.py \
  local-secrets/leads-ranked-lote3.json \
  docs/leads/leads-gastro-delivery-sp-lote3.xlsx # monta o .xlsx
```

Depois de fechar um lote, some os telefones dele em `telefones-ja-entregues.json`,
senão o lote seguinte volta a repetir.

O `apify-leads-gastro.mjs` já traz **24 municípios do estado** em ordem de
densidade de delivery e, por padrão, **pula os que já foram varridos** (a marca
`varridoEm` na lista `CITIES`) — uma segunda passada rasa neles devolveria quase
os mesmos lugares. `--todas-cidades` reabre a lista inteira e `--cidades=Santos,Bauru`
escolhe a dedo.

### O orçamento se ajusta sozinho

O script lê `/users/me/limits` e monta o plano com o que ainda sobra no ciclo da
conta, deixando 2% de folga. Duas regras que valem a pena conhecer:

- **Ele encolhe a cota por busca até um piso de 8 e só então corta município.**
  Espalhar 1 lugar por busca em 24 cidades caberia em qualquer orçamento e não
  serviria: com amostra desse tamanho nenhuma marca aparece duas vezes, então
  rede/franquia nunca é detectada e o ranking perde o fator que mais pesa depois
  do celular.
- **Ele confere o gasto entre um município e outro e aborta ao encostar no teto.**
  A Apify contabiliza com atraso — na coleta de 02/09 o saldo aparecia como
  US$ 4,64 logo após a varredura e US$ 4,77 poucos minutos depois. Por isso a
  folga existe, e por isso a quarta cidade daquele dia foi recusada.

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

## Limites destas listas

- A conta da Apify é **free tier, com teto de US$ 5 por ciclo**, e o ciclo vai do
  dia 14 ao dia 13. Isso limita a profundidade por cidade: o primeiro lote parou
  em 1.000 lugares (US$ 3,82) e o segundo em 192 (US$ 0,64), com o que sobrava.
- Por consequência, **rede é subdetectada**: a marca só é reconhecida como rede se
  duas unidades caírem na mesma varredura rasa. Uma lista curta de franquias
  conhecidas cobre parte do resto.
- **O dump bruto da Apify some em 7 dias** (`dataRetentionDays`), então o
  `raw-places.json` local é a única cópia — reprocessar um lote antigo depois
  disso exige pagar a varredura de novo.
- `orderBy`, `googleFoodUrl` e `menu` voltam sempre vazios do actor — o sinal de
  plataforma vem só do campo `website`, preenchido em 55% dos lugares.
- Telefone e delivery vêm do que o Google publica, e podem estar desatualizados.
