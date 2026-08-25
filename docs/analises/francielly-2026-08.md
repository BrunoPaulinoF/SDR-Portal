# Francielly — desempenho, abordagem e pitch (25/08/2026)

Leitura das conversas reais da Insumo Smart no portal, com foco na semana em que o playbook
`convite` está no ar. O objetivo é responder duas coisas: **quanto ela está entregando** e
**onde a abordagem e o pitch estão perdendo lead**.

## O que foi lido

As 200 conversas mais recentes da Francielly (de 854 no portal, sobre uma base de 1353 leads),
lidas pela caixa de conversas, mais o dashboard, a tela do SDR e os 2770 registros de `ai_runs`
dela. O recorte tem duas eras bem diferentes, e misturá-las produz conclusão errada:

| | jun/2026 | 20–25/08/2026 |
| --- | --- | --- |
| Conversas no recorte | 140 | 60 |
| Playbook | consultivo | **convite** |
| Primeira mensagem | gerada por IA | fixa, "Opa, tudo bom?" |
| Modelo | gpt-5.4-mini | deepseek-v4-pro (e v4-flash desde 24/08) |

Das 60 de agosto, **14 são do próprio número de teste** (+55 19 97125-3411). Sobram **46 leads
reais** — que é exatamente o total de abordagens dos últimos 7 dias no dashboard. Ou seja: o
recorte de agosto é a semana inteira, não uma amostra.

## O funil da semana

46 leads reais abordados entre 20 e 25/08:

| Etapa | Leads | % dos abordados |
| --- | --- | --- |
| Receberam "Opa, tudo bom?" | 46 | 100% |
| Qualquer inbound | 22 | 48% |
| **Resposta de gente** (fora o robô da loja) | **16** | **35%** |
| A SDR chegou a fazer a proposta (passo 2) | 13 | 28% |
| Chegaram ao convite (passos 3 e 4) | 6 | 13% |
| Chegou a falar do Fernando | 3 | 7% |
| Handoff registrado | 2 | 4% |

Somando o Depósito Cervejeiros (lead de junho reativado pelo follow-up), foram **3 handoffs
reais na semana**.

### O dashboard está otimista em dois pontos

O painel mostra **58% de taxa de resposta e 8 handoffs (13%)** nos últimos 7 dias. Os dois
números precisam de desconto antes de virar decisão:

- **"Responderam" conta o robô da loja.** Em 22 conversas com inbound, 6 nunca tiveram uma
  pessoa do outro lado — só o atendimento automático mandando cardápio e horário. A taxa com
  gente é 35%, não 58%. A mesma ressalva vale para os "55% de resposta" da variante Roteiro na
  tela de Msg inicial.
- **Metade dos handoffs é teste.** Dos 8, 4 a 5 são do número do Fernando. Reais foram 3.

Com o desconto, a semana fica assim: **35% de resposta humana, 6,5% de handoff sobre abordagens**
— contra 37% de resposta e 3% de handoff em todo o histórico. O ganho está no handoff, não na
taxa de resposta.

### O gargalo não é a abertura, é o meio

Dos 16 leads que responderam como gente, **10 morreram antes do convite**. É o maior vazamento
do funil e é onde a abordagem e o pitch decidem o jogo. A abertura está fazendo o trabalho dela;
o que vem depois é que perde.

## O que está funcionando (e não deve ser mexido)

- **"Opa, tudo bom?" abre conversa.** Curta, sem cara de vendedor, sem nome de empresa. Quem
  responde responde como pessoa ("oiie", "quem é?", "como posso ajudar?"), que é o registro certo.
- **Tempo de resposta.** Mediana de **1 minuto** entre a fala do lead e a resposta dela, com 127
  de 130 respostas em até 2 minutos. Latência não é problema aqui.
- **A regra do robô da loja funciona.** Em Suprema Pizza, X Calota e Instinto Burger a SDR não
  respondeu ao atendimento automático e esperou aparecer gente. É o comportamento certo.
- **Tom.** Sem emoji, sem assinatura, sem "fico à disposição". A cordialidade do encerramento
  também aparece ("agradeço o retorno", "boas vendas aí").
- **Custo sob controle.** 83% de cache de prompt e 3,8% de erro de IA na semana (contra 8,4% no
  histórico, quase tudo de um episódio antigo de cota estourada).

## Os problemas, do mais caro para o menos

### 1. Quando o lead pergunta "o que é?", a SDR responde com a frase que o próprio prompt proíbe

Este é o problema número um, e ele tem prova direta.

O `prompt.txt` traz um exemplo com duas versões da resposta. A marcada como **RUIM** é:

> "É um acompanhamento de perto da operação mesmo, a parte de números que nunca dá tempo de olhar."

Em produção, **6 das 7 explicações que a SDR deu foram essa frase**, praticamente palavra por
palavra. A versão marcada como BOM não apareceu nenhuma vez. Modelo copia o texto do exemplo e
ignora o rótulo — a frase errada está escrita no prompt, então ela sai.

O custo aparece inteiro na CT Express Artesanal (21/08). Cinco rodadas de "não entendi", "sem
detalhes não tem como nem entender", "vcs são uma plataforma de delivery ou contabilidade?",
até "não quero falar com ninguém não". Quarenta minutos depois o lead voltou sozinho — "me
explica, eu tenho restaurante mas quero entender" — e a SDR finalmente disse algo concreto:

> "...a parte de números do restaurante, tipo custo de insumo, margem por prato e preço de cardápio."

Resposta do lead, cinco minutos depois: **"Sim. Fala ele me mandar as info."**

Uma frase concreta converteu o que cinco frases vagas quase perderam.

### 2. Uma regra escrita à mão no portal está matando todas as indicações

O prompt salvo no portal é igual ao versionado em `docs/prompts/insumosmart/`, **com uma exceção**
— um bloco acrescentado direto na tela:

> LEAD NÃO É DO RAMO ESPERADO: caso o lead mande por exemplo "aqui é taxi", "não trabalho com
> gastronomia" ou algo do tipo que mostre que o lead não é da área, de forma educada diga que
> errou o contato e se despeça, e não mande mais mensagem. (descarte o lead)

Ela contradiz três regras que já existem no mesmo prompt e no prompt base: a seção INDICAÇÃO
("contato oferecido nunca se recusa"), a seção FORA DO PERFIL ("antes de encerrar, faça o pedido
da seção INDICAÇÃO") e a regra fixa do `SDR_BASE_PROMPT`. Sendo a mais direta e a mais
imperativa das quatro, é ela que o modelo obedece. Três casos em uma semana:

- **Trem Bão** — "eu não sou do ramo. **Mas o q seria?**" → a SDR ignorou a pergunta, encerrou e
  não pediu indicação.
- **Hora do Lanche** — escritório de contabilidade → encerrou sem pedir indicação, e ainda mandou
  uma segunda despedida 18 horas depois.
- **Agrobar** — o pior. O lead vendeu o bar, ofereceu espontaneamente os contatos de outros
  restaurantes, e a SDR **recusou**: *"por enquanto a gente já tem as operações que quer
  acompanhar"*. O Fernando teve que digitar à mão duas vezes para recuperar os contatos — e a IA
  respondeu por cima dele no mesmo minuto, contradizendo o humano na frente do lead.

### 3. O follow-up cobra um projeto que o lead nunca ouviu falar

**9 dos 11 follow-ups do recorte** foram para leads que só tinham recebido "Opa, tudo bom?" — e
mesmo assim diziam:

> "Passei novamente porque estou fechando as empresas que vão participar **desse projeto**. Antes
> de fechar **as vagas**..."

O lead nunca soube de projeto nenhum nem de vaga nenhuma. A Baunille respondeu o que qualquer
pessoa responderia: *"pode deixar para outra empresa"* — e virou `sem interesse` sem nunca ter
ouvido a proposta.

Não é falha do modelo: é instrução explícita do `followup-prompt.txt` ("Se a pessoa não respondeu
ao convite da abertura: mande o texto padrão, sem mudar nada"). O texto foi escrito quando a
primeira mensagem ainda carregava o pitch inteiro. Depois que a abertura virou "Opa, tudo bom?",
essa linha passou a mandar cobrar uma conversa que não aconteceu.

### 4. O handoff continua sendo anunciado, não perguntado

A passagem em duas etapas está no prompt, mas na prática ela raramente acontece:

| | conversas |
| --- | --- |
| "já pedi / já encaminhei / já avisei o Fernando" | 7 |
| "posso pedir pro Fernando te chamar?" | 2 |

E dois dos três handoffs da semana saíram sem um sim de verdade:

- **CT Express** — o handoff disparou logo depois de *"não entendi sua proposta"*. O resumo que
  chegou ao Fernando foi: *"Lead não entendeu a explicação sobre o projeto. Quer mais detalhes."*
  Vinte minutos depois o mesmo lead dizia *"não quero falar com ninguém não"*.
- **Stout Burger** — o atendente passou o contato da gerente e a SDR encaminhou. Correto pela
  regra (contato de dentro da casa), mas o Fernando recebeu um número sem que ninguém ali tivesse
  ouvido a proposta.

Duas vezes também apareceu a frase que o prompt proíbe — *"quem detalha tudo é o Fernando"* — e
três mensagens usaram o diminutivo que ele também proíbe ("explicadinho", "certinho",
"rapidinho"). As cinco estão na mesma conversa, a CT Express: quando a SDR não tem o que dizer,
é esse conjunto de muletas que aparece.

### 5. Um lead disse sim e está há quatro dias sem resposta

CT Express, 21/08 às 14:10: **"Sim. Fala ele me mandar as info."** A IA tinha sido pausada
manualmente pelo portal cinco minutos antes e o follow-up estava desativado desde as 13:28. Nada
saiu desde então. É o único lead da semana que pediu explicitamente o contato e ele está parado.

### 6. Mensagem editada no WhatsApp vira mensagem nova, e a SDR responde duas vezes

Seis pares de inbound quase idênticos no recorte. Na conversa do José dá para ver o efeito: ele
corrigiu "estava alterado" para "estava atarefado" e a SDR mandou **duas respostas seguidas
quase iguais**; ele corrigiu "finde semana" para "fim de semana" e aconteceu de novo. O buffer de
debounce não colapsa edição — e duas mensagens quase iguais em sequência é a coisa mais robô que
uma conversa pode ter.

Na mesma conversa a SDR ainda perguntou *"posso pedir pro Fernando te chamar?"* depois de o lead
dizer que **o Fernando já tinha chamado**, e desmontou a reunião que ele havia proposto
("sem reunião marcada, pode ir respondendo por aqui") — prometendo pelo Fernando algo que não é
dela prometer.

### 7. Áudio quase nunca é transcrito

**5 de 6 áudios** recebidos no recorte ficaram sem transcrição. Para a SDR, esses leads
simplesmente não falaram. A Tortuga respondeu por áudio ao passo 2 e recebeu, no dia seguinte, a
cobrança de follow-up como se tivesse ignorado a mensagem. Quem responde por áudio costuma ser
quem está mais engajado.

### 8. Loop de follow-up: 23% dos tokens da semana em mensagens que nunca são enviadas

137 gerações de follow-up na semana para **apenas 14 leads distintos** — um deles gerou 38 vezes,
outro 30. Em 82% delas a IA respondeu corretamente `nao_responder: true` ("esse lead não deve
receber follow-up"), e mesmo assim o lead voltou para a fila.

A causa está em `src/modules/scheduler/followup-outreach.ts:361`: "a IA decidiu não mandar" e "a
geração falhou" caem no mesmo ramo, que reagenda e tenta de novo. São **412 mil tokens da semana**
(23% do total dela) gastos em mensagens que nunca vão sair.

### 9. O modelo foi trocado no dia 24 e ninguém mediu

Toda a qualidade descrita acima é do **deepseek-v4-pro**. Em 24/08 o SDR passou para
**deepseek-v4-flash**, que tem só 43 chamadas de histórico. Um prompt de 25 mil caracteres com
regras que se contradizem entre si (ver item 2) é exatamente o tipo de texto que um modelo mais
barato segue pior. Trocar de modelo e mudar o prompt na mesma semana também torna impossível saber
a quem creditar a diferença.

### 10. Um terço da lista não existe no WhatsApp

413 dos 1353 leads da base estão como `telefone inexistente` (31%), 26 só na última semana. Não é
problema da SDR, mas é o que segura o volume: a fila de pendentes está em 63, abaixo do mínimo de
100, e o alerta do dashboard já aponta isso.

## O que mudar na abordagem e no pitch

Em ordem de retorno sobre esforço.

**1. Travar a frase da proposta, como o convite já é travado.** A explicação precisa ter as três
palavras concretas que converteram a CT Express. Sugestão de texto único para a etapa `solution`:

> "A proposta é acompanhar de perto os números da operação — custo de insumo, margem por prato e
> preço de cardápio — e transformar isso em decisão prática de gestão. Como funcionaria aí depende
> de conhecer a sua casa, e quem faz isso é o Fernando, dono da Insumo Smart. Posso pedir pra ele
> te chamar?"

E **apagar do prompt o exemplo marcado como RUIM**. Enquanto aquele texto estiver escrito ali, ele
vai continuar saindo. Exemplo negativo deve descrever o erro ("resposta que não diz de que se
trata"), nunca reproduzi-lo.

**2. Remover do portal o bloco "LEAD NÃO É DO RAMO ESPERADO".** As seções FORA DO PERFIL e
INDICAÇÃO já cobrem o caso, com o pedido de indicação no meio. Se o Fernando quiser mesmo
descartar quem não é do ramo, a regra precisa ser reescrita para pedir a indicação **antes** de
encerrar — hoje ela cancela três regras de uma vez. Indicação é lead de graça, e a semana perdeu
pelo menos três.

**3. Dois textos de follow-up, um por etapa.** Quem já ouviu a proposta continua recebendo o texto
das vagas. Quem parou no "Opa, tudo bom?" ou no passo 2 precisa de outro, que **retome a
conversa-base em vez de cobrar** — algo como *"opa, passei aqui de novo. Também sou do ramo da
gastronomia e queria te fazer uma proposta, pode ser?"*. A regra atual do `followup-prompt.txt`
manda o contrário e é ela que produz o "pode deixar para outra empresa".

**4. Nenhum `notify_handoff` sem um sim explícito na mensagem anterior.** "Não entendi" não é sim.
Pergunta sobre o que é não é sim. E a mensagem que acompanha o handoff nunca deve começar por
"já pedi" / "já encaminhei" / "já avisei": o lead descobre que o número dele foi passado adiante
sem ter autorizado.

**5. Responder a pergunta antes de encerrar, sempre.** Trem Bão e Agrobar perguntaram "mas o que
seria?" já depois de dizer que não eram do ramo. Nos dois casos a SDR encerrou em cima da
pergunta. Custa uma frase responder — e é de quem pergunta que vem a indicação.

**6. Voltar para o deepseek-v4-pro** até existir uma semana medida com o flash. Depois, se quiser
testar, troque só o modelo, com o prompt parado.

**7. Destravar a CT Express hoje.** Religar a IA ou responder à mão: é o único sim explícito da
semana e ele está parado desde sexta.

**8. Transcrição de áudio** e **corte do loop de follow-up** (`followup-outreach.ts:361`,
separando "a IA decidiu não mandar" de "a geração falhou") são correções de código pequenas com
efeito imediato — a primeira devolve os leads mais quentes, a segunda devolve 23% do orçamento de
tokens.

## O que medir na próxima semana

Os números do funil de convite, com os descontos que este documento aplicou:

1. **resposta humana / abordagens** — hoje 35%. Exclua o robô da loja da conta.
2. **chegou ao convite / respondeu** — hoje 6 de 16 (38%). É o número que as mudanças 1, 3 e 5
   deveriam mexer primeiro.
3. **disse sim / chegou ao convite** — a métrica da estratégia.
4. **handoff com pergunta / handoff total** — hoje 2 de 7. Mede se a passagem em duas etapas
   saiu do papel.
5. **indicações recebidas / leads fora do perfil** — hoje 0 de 3. Só sobe se o item 2 for feito.

E sempre com o **número de teste (+55 19 97125-3411) fora da conta**: com ele dentro, a semana
parece ter tido 8 handoffs quando teve 3.
