# Darksales CRM — segmentação de lead

Este diretório guarda os prompts do SDR da Darksales. Por enquanto ele tem só a peça
que decide **quem é abordado**: `lead-qualification-prompt.txt`, que vai no campo
*Prompt de qualificação* da tela `/sdr-agents/<id>/edit` e roda antes da primeira
mensagem, no `lead_fit_assessment`.

## O que o dono respondeu

| Bloco | Resposta |
| --- | --- |
| O que vende | CRM (Darksales CRM) |
| Promessa | "faço os empreendedores ganharem mais dinheiro usando nosso CRM" |
| Diferencial | "melhor CRM, feito por um empreendedor que entende as dores dos empreendedores" |
| Nicho | "todo pequeno, médio e grande empreendedor que faça ou não tráfego pago" |
| Região | Sul — PR, SC, RS |
| Porte | pequena, média e grande |
| Presença digital | site, WhatsApp, Facebook ou Instagram ativo |
| Público | quem quer focar na internet, faixa de 50k MRR/mês |

## Os três problemas do briefing

**1. "Todo empreendedor" não é um ICP — é a ausência de um.** Um filtro que aceita
qualquer empresa não filtra nada, e o custo não é teórico: cada lead ruim gasta uma
mensagem do número de WhatsApp, e reputação de número é o ativo mais escasso da
operação. É exatamente a falha que a Mariana teve em produção — a qualificação
aprovava por falta de evidência contrária e descartou 6 leads em 1.588.

**2. O Bloco 2 e o Bloco 3 descrevem empresas diferentes.** "Pequeno, médio e grande,
com ou sem tráfego pago" e "50k MRR/mês, focado na internet" não são o mesmo lead.
R$50k de MRR é ~R$600k/ano: não é "todo pequeno empreendedor", é empresa com operação
comercial de verdade. Como é a única resposta com um número dentro, tratei o Bloco 3
como o ICP real — é também o único compatível com alguém que paga por um CRM.

**3. MRR não é observável de fora.** Não existe busca por "empresas com 50k de MRR".
Nenhum prompt de qualificação vai conseguir aplicar esse critério direto. O trabalho
todo é traduzir o critério invisível em **sinais visíveis** que costumam andar junto
com ele.

## A tradução: de faturamento para sinal observável

E antes disso, o critério que importa de verdade: **CRM não resolve dor de quem tem
poucos clientes.** Resolve dor de quem tem mais conversa entrando do que consegue
acompanhar de cabeça. Então o melhor sinal não é "tem site" — é **fluxo de lead**.

O prompt aprova em dois tiers, e grava o tier no campo `reason` para dar para medir
depois qual deles vira reunião:

**Tier A — sinal forte de fluxo comercial.** Anúncio pago rodando agora; equipe de
vendas ou atendimento (vaga de vendedor, "fale com um consultor", time comercial);
mais de uma unidade; venda com etapa de proposta (orçamento, agendamento, simulação);
e-commerce próprio com catálogo e avaliações; Google Maps com volume de avaliações.

**Tier B — empresa ativa e profissional, sem sinal forte de volume.** Site com domínio
próprio; redes com postagem nos últimos 60 dias e contato comercial; Maps de empresa
aberta com movimento; cadastro com estrutura clara.

O "com ou sem tráfego pago" do briefing continua valendo — tráfego pago não virou
requisito, virou o sinal que joga o lead para o tier A. É o melhor proxy disponível
para "tem lead entrando e tem orçamento", e sai de graça na busca.

**Região virou filtro duro**, porque é o único critério do briefing que é ao mesmo
tempo objetivo e observável: cidade/UF do cadastro, DDD do WhatsApp (PR 41–46, SC
47–49, RS 51/53/54/55) e endereço na busca.

**"Presença digital: site, WhatsApp, Facebook ou Instagram ativo" foi endurecido.**
Como estava, aprova todo mundo — qualquer negócio tem WhatsApp. Virou *ativo e
profissional*: domínio próprio, postagem recente, perfil não abandonado.

E entrou uma lista de descarte que o briefing não tinha: pessoa física e profissional
liberal sem equipe, comércio de balcão de baixo ticket sem venda consultiva (não tem
lead para acompanhar), concorrente e vizinho de mercado (CRM, ERP, agência de tráfego,
consultoria comercial — são quem vende, não quem compra) e perfil abandonado.

## O que isso não resolve

O filtro entrega "provavelmente na faixa", nunca "tem 50k de MRR". A qualificação de
verdade só acontece na conversa. Se a faixa de faturamento for mesmo inegociável, o
lugar de checar isso é o próprio SDR, com uma pergunta leve antes do handoff — e isso
é decisão de roteiro, não de filtro.

## Perguntas em aberto para o dono

Faltam respostas para escrever o resto do conjunto (oferta, prompt principal, primeira
mensagem, follow-up). O que o briefing não diz:

1. **O que o CRM faz de concreto?** "Melhor CRM" e "ganhar mais dinheiro" não dão à IA
   nada para conectar com a dor que o lead contar. Precisa de 3 a 5 funcionalidades
   reais (funil, WhatsApp integrado, automação, relatório, disparo?).
2. **Qual dor específica ele resolve melhor?** Lead que some sem resposta? Vendedor que
   não faz follow-up? Dono sem visibilidade do funil? Isso define a pergunta de
   diagnóstico do SDR.
3. **Quem recebe o handoff** — nome e WhatsApp de quem continua a conversa.
4. **Preço entra ou não na conversa?** Nos outros SDRs o preço é sempre assunto do
   humano; vale confirmar que aqui é igual.
5. **Existe demonstração?** Teste grátis, ambiente de demo, vídeo — muda o que o SDR
   oferece como prova.
6. **Segmento preferido dentro do Sul.** "Todo empreendedor" dilui a mensagem: uma
   primeira mensagem que fala a língua de um nicho converte mais que uma genérica.
   Mesmo mantendo o filtro largo, vale saber onde ele já fechou mais.
