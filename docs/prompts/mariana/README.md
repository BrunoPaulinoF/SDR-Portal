# Prompts da Mariana (SDR KyberFood)

Estes arquivos são a **fonte versionada** dos prompts que ficam no banco, na tela
`/sdr-agents/<id>/edit`. O portal continua sendo quem manda em produção — este diretório
existe para o texto ter histórico, revisão e diff.

Quando alterar um prompt no portal, atualize o arquivo aqui no mesmo commit.

| Arquivo | Campo no portal | Entra no prompt da IA? |
| --- | --- | --- |
| `prompt.txt` | Prompt principal | sim — região estável, depois do `SDR_BASE_PROMPT` |
| `offer-description.txt` | Oferta | sim — região estável |
| `first-message-prompt.txt` | Prompt da primeira mensagem | só quando o modo A/B está desligado |
| `followup-prompt.txt` | Prompt de follow-up | sim, no job de follow-up |
| `lead-qualification-prompt.txt` | Prompt de qualificação | sim, no `lead_fit_assessment` |
| `handoff-template.txt` | Template de handoff | não é prompt: é a mensagem enviada ao humano |

`Descrição do produto` (`productDescription`) **não** alimenta nenhum prompt — é
documentação interna da tela. Só `productName` e `offerDescription` chegam à IA.

## O que mudou nesta revisão

Diagnóstico a partir das 743 conversas da Mariana em produção: 44% dos leads respondiam,
mas 168 dos 219 que ouviam a segunda mensagem paravam ali. A segunda mensagem pedia que o
lead aceitasse ouvir uma oferta sem dizer qual era ("tenho uma solução que reduz custos…
tem interesse em saber mais?"), e o roteiro mandava aceitar o "não" na hora — queimando o
lead com `mark_not_interested` + `disable_followup`. Resultado: 10 handoffs em 742 abordagens.

Mudanças:

1. **O funil virou 4 etapas** (`permission` → `discovery` → `solution` → `handoff`), e a
   etapa 2 agora **diz o que é** em uma frase e faz **uma pergunta de diagnóstico** sobre a
   rotina do lead. A antiga fórmula de curiosidade está proibida por escrito.
2. **"Não" antes da etapa 3 deixou de ser fim de linha.** Vale uma réplica curta e concreta;
   só a recusa repetida (ou explícita) encerra. "Agora não" não desativa mais o follow-up.
3. **A prova mudou de ordem.** A demonstração preferida passou a ser dentro da própria
   conversa (o lead manda um áudio pedindo uma pizza e a Mariana responde no papel do
   atendente). O cartão da pizzaria — de onde 67% dos leads sumiam — virou a segunda opção.
4. **Regras duras foram para o topo.** Preço, links, ações inexistentes e números inventados
   agora abrem o prompt, em vez de ficarem enterrados no meio de 11 mil caracteres. A regra
   de preço já havia sido furada em produção (a IA citou R$ 347/mês).
5. **A qualificação passou a exigir sinal positivo de delivery.** Antes aprovava por falta de
   evidência contrária e descartava 6 leads em 1.588; agora, sem rastro de operação, o lead
   é descartado com o motivo "sem sinal de operação".
6. **A oferta parou de duplicar o funil.** O roteiro estava escrito duas vezes, com palavras
   diferentes, no prompt e na oferta. Agora a oferta descreve só o que é vendido.

## Revisao de 19/08, a partir das conversas pos-mudanca

Cinco horas de operacao com o roteiro novo, lidas em `/ai-runs` e nas conversas. O que
mudou de verdade foi a janela das 15:10, quando entrou o conserto da pesquisa web e o teto
de saida subiu: descarte na qualificacao caiu de 88% para 38%, os motivos pararam de citar
buscas que nunca aconteceram (31 para 0), os erros de JSON truncado sumiram (10% para 0) e a
latencia mediana caiu de 21,2s para 8,5s. Dos leads que chegaram a segunda mensagem, 3 de 4
seguiram a conversa — a fila historica era 51 de 219.

Sobraram tres defeitos, corrigidos aqui:

1. **"Fabricacao" no CNAE virou motivo de descarte.** O 1091-1/02 e a padaria/confeitaria que
   produz o que vende, e foi descartado cinco vezes como "industria sem varejo" (e aprovado
   uma, pelo nome fantasia). O prompt de qualificacao agora decide por codigo — 1091-1/02 e
   1092-9/00 entram, 1091-1/01 sai — e a palavra "fabricacao" saiu da lista de descarte.
2. **O follow-up recomeçava a conversa.** Leads que ja tinham confirmado quem eram recebiam de
   novo "voce e quem toca o atendimento ai?". O prompt de follow-up agora abre mandando reler
   as perguntas ja feitas, limita essa pergunta a uma vez por conversa e trocou o primeiro
   caso da lista (que era um pega-tudo com o exemplo pronto que o modelo copiava).
3. **Razao social de pessoa virava nome de loja** ("Falo com a pessoa responsavel pela Erica
   Cristina Guimaraes Pereira Luiz?"). Correcao em `lead-display-name.ts`, fora dos prompts.

Fora dos prompts: a variante de primeira mensagem **"Ancorada empresa" foi pausada** (0
respostas em 10 envios contra 43% da "Saudacao 1"; p = 0,004). O rodizio ficou com "Ancorada
dor" (6 de 9) e "Saudacao 1".

## Playbook

A Mariana usa o playbook **`consultivo`**, que é o padrão. O funil dela (permissão →
descoberta → solução → handoff) saiu do `SDR_BASE_PROMPT` e virou o bloco `consultivo` em
`src/modules/ai/sdr-playbooks.ts`, com o texto preservado — a mudança foi de arquitetura, não
de comportamento. O que separou os dois blocos foi a Insumo Smart, que precisa do funil
oposto (ver `docs/prompts/insumosmart/`).

Duas regras comuns mudaram de redação nessa separação e valem para a Mariana também: a de
"você só escreve nesta conversa" agora diz explicitamente que o handoff é a única ação fora
do chat (antes dava para ler como proibição de prometer que o Igor ia chamar), e as regras de
adiamento/`disable_followup` saíram do bloco de recusa do funil para as regras gerais.

Também mudou fora dos prompts: `followupEnabled` ligado, `aiMaxOutputTokens` de 10.000 para
1.500 e `aiTemperature` de 0.5 para 0.4.

## Configuração que anda junto com os prompts

Alguns campos do portal não são prompt, mas o texto das mensagens depende deles:

| Campo | Valor atual | Por quê |
| --- | --- | --- |
| `demoContactName` | `KyberFood - Pizzaria Demonstração` | é o nome que aparece no cartão de contato no WhatsApp do lead. Era "Pizzaria de teste": a palavra "teste" tirava o realismo justamente na hora da prova, e contradizia os prompts, que já falavam "pizzaria de demonstração". |
| `aiMaxOutputTokens` | `8000` | teto de saída; a qualificação e o follow-up somam prompt longo mais raciocínio antes de emitir o JSON. Valor baixo devolve resposta vazia. |
| `aiReasoningEffort` | `default` | não envia o parâmetro, então o DeepSeek aplica o próprio padrão (`high`). |
| `followupEnabled` | ligado | metade dos leads que esfriam somem calados; é o público do follow-up. |
