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
| `followup-prompt.txt` | Prompt de follow-up | sim, no job de follow-up (quem respondeu e esfriou) |
| `bump-prompt.txt` | Prompt do segundo toque | sim, no job de follow-up (quem nunca respondeu) |
| `lead-qualification-prompt.txt` | Prompt de qualificação | sim, no `lead_fit_assessment` |
| `handoff-template.txt` | Template de handoff | não é prompt: é a mensagem enviada ao humano |

`Descrição do produto` (`productDescription`) **não** alimenta nenhum prompt — é
documentação interna da tela. Só `productName` e `offerDescription` chegam à IA.

## Revisão de 02/09: robô da loja e primeira mensagem

1. **A Mariana não responde mais à resposta automática da loja.** O filtro saiu do prompt e foi
   para o código (`src/modules/conversations/store-auto-reply.ts`): automática reconhecida não
   chega à IA, não move o lead no funil e aparece no histórico marcada como
   `[resposta automática da loja, não é a pessoa]`. A frase pronta
   `"oi! tem alguém aí que cuida do delivery?"` **saiu do `prompt.txt`** — ela estava entre
   aspas, o modelo copiava, e virou 15% de tudo que a Mariana escrevia. O segundo toque agora é
   do follow-up, no dia seguinte.
2. **A primeira mensagem passou a abrir curiosidade sem parecer anúncio.** Ver
   `first-message-variants.md`. Pergunta retórica de vendedor sobre a rotina do lead está
   proibida por escrito no `first-message-prompt.txt`: ela é o formato que o dono reconhece
   como robô. Isso **não** reabre a fórmula vaga banida na revisão anterior ("tenho uma solução,
   tem interesse?"): aquela é da ETAPA 1, depois que a pessoa falou, e continua proibida. Na
   primeira mensagem o assunto fica em aberto; assim que vier qualquer resposta de gente, a
   ETAPA 1 diz na hora, de forma concreta, o que é a KyberFood.

## O que mudou na revisão anterior

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

## Revisao de 20/08: a Mariana se oferecia como demonstracao

Relato da operacao: em algumas conversas a Mariana convidava o lead a testar o pedido no
WhatsApp **dela** ("manda um audio pedindo uma pizza que eu monto pra voce"). Isso quebra a
persona — ela e do comercial, nao e a IA de atendimento — e a promessa nao tem como se cumprir:
no fim daquela conversa quem escreve e um SDR de texto, entao o lead manda o audio e nao
acontece nada.

O `fix(followup)` anterior tratou so o job de follow-up. A causa continuava em pe nos outros
caminhos, por quatro motivos que se somam:

1. **A regra estava na camada errada.** "Voce nao e o produto que vende" e universal — vale para
   qualquer SDR, em qualquer playbook —, mas so existia dentro do prompt editavel da Mariana, na
   ETAPA 3, a uns 11 mil caracteres do comeco. Quem editasse o prompt no portal apagava a regra
   sem perceber, e a Insumo Smart nunca a teve. Agora ela e uma regra fixa do `SDR_BASE_PROMPT`,
   logo depois da regra de "voce so escreve nesta conversa", e aparece no preview de instrucoes
   fixas das duas telas.
2. **A oferta dava a deixa e vinha antes.** `buildSdrSystemPrompt` monta oferta -> prompt
   editavel, entao o modelo lia "o objetivo e a pessoa ver a IA funcionando" (sem dizer ONDE)
   varios milhares de caracteres antes de ler a proibicao. A oferta agora diz "ver a IA
   funcionando NO CONTATO DA PIZZARIA DE DEMONSTRACAO" e fecha com "a Mariana nunca e a
   demonstracao".
3. **O historico ensinava o erro.** O cartao de demonstracao e gravado como mensagem de texto
   ("Contato enviado: KyberFood - Pizzaria Demonstracao (5519...)"), e o fallback dele e um link
   `wa.me`. Os dois voltavam para o modelo como turno DELE — ou seja, exemplo na propria boca de
   duas coisas que a REGRA DURA 2 proibe, e registro de uma mensagem que o lead nunca viu assim
   (ele recebeu um cartao). `aiHistoryText` agora troca esses registros por
   "[o sistema enviou o cartao de contato de demonstracao nesta conversa]" nos dois geradores
   (resposta e follow-up), sem mudar o que o operador ve na caixa de conversas.
4. **A regra ficou repetida no ponto de uso.** Na ETAPA 3 sobrou uma linha curta apontando para a
   REGRA DURA 7, em vez do paragrafo longo que competia com a lista de recursos logo acima.

Fora da persona, uma linha errada no codigo da qualificacao: o system prompt abria com "Voce
qualifica se um lead deve receber abordagem fria de **consultoria/mentoria de planejamento
estrategico**" — sobra de outro produto, fixa em `initial-outreach.ts`, contradizendo o
`lead-qualification-prompt.txt` logo abaixo. Passou a ser neutra ("a abordagem fria deste SDR ...
nao presuma nenhum outro produto").

## Revisao de 25/08: o follow-up nao alcancava quem nunca respondeu

Leitura das 37 conversas da Mariana em producao: 32 abordagens frias, 18 com algum inbound,
mas so 4 com uma pessoa de verdade do outro lado — as outras 14 foram o robo de horario da
propria loja. Zero handoff. E, em sete dias, **um** follow-up enviado.

Duas causas no codigo, alem da janela de envio (que e configuracao do portal, nao prompt):

1. **Quem nunca respondeu estava fora da fila.** `findNextFollowupDueForSdr` exigia
   `status = 'in_conversation'` e `last_inbound_at IS NOT NULL`, mas `markInitialSent` sempre
   gravou o `followup_due_at` de todo lead abordado. O agendamento existia e ninguem lia: os 14
   leads mudos nunca receberiam segunda mensagem. O filtro agora aceita tambem
   `initial_sent` + `last_inbound_at IS NULL`.
2. **Recusa do modelo e erro tecnico caiam no mesmo lugar.** `buildFollowupMessage` devolvia
   `null` em cinco situacoes diferentes e o chamador reagendava todas em +60min, sem contador e
   sem teto — entao um lead que o modelo decidiu nao abordar voltava de hora em hora, para
   sempre, gastando uma chamada de IA por vez. Nos logs de 20 e 21/08 a cadencia era literal:
   13:35, 14:35, 15:35, 16:35, 17:36. Agora `refused` encerra o follow-up do lead e `error`
   reagenda contando a tentativa, ate `MAX_FOLLOWUP_ATTEMPTS`.

Abrir o filtro sozinho nao resolveria: o roteiro de follow-up manda "retomar o ultimo assunto
real" e lista "o historico nao justifica uma nova mensagem sua" como motivo de recusa — para o
lead mudo isso e verdade, e o modelo recusaria quase todos. Por isso o job passou a ter dois
modos, escolhidos por `last_inbound_at`, cada um com o proprio bloco de regras e o proprio
prefixo estavel de cache:

| Modo | Publico | Prompt do SDR |
| --- | --- | --- |
| `reengage` | respondeu e esfriou | `followup-prompt.txt` |
| `bump` | nunca respondeu | `bump-prompt.txt` (vazio: cai no de follow-up) |

O `bump-prompt.txt` diz em uma frase o que a KyberFood faz — a primeira mensagem nao diz —, faz
uma pergunta facil, proibe refazer a pergunta da abordagem e proibe cobrar a resposta que nao
veio. Tem uma secao so para o caso mais comum desse publico: quando a unica coisa no historico
e a autoresposta da loja, ninguem leu a Mariana ainda, entao ela escreve para a pessoa e nao
comenta a mensagem do robo.

Fora dos prompts, na mesma revisao: o nome do lead parou de sair como veio da lista. O cadastro
gruda descritor de segmento e cidade no nome real, e a abordagem perguntava por "a pessoa
responsavel pelo Escher Burger - Hamburguer Gourmet - Hamburguer artesanal?". `lead-display-name.ts`
agora corta o rabo depois do primeiro separador e a cidade colada no fim, sempre com a guarda de
so cortar quando o que sobra ainda identifica a loja — "Pizzaria Limeira" em Limeira continua
inteiro, e "Pizzaria - Dom Rei" nao vira "Pizzaria".

## Revisao de 26/08: quase ninguem responde, e o prompt quase nao entra em campo

Leitura das 64 conversas da Mariana no portal, da tela de Msg inicial e dos 2309 `ai_runs`
dela — analise completa em `docs/analises/mariana-2026-08.md`. O funil real: 59 abordagens,
**6 respostas de gente (10%)**, 55 conversas paradas na etapa de permissao e **zero handoff**
(o unico handoff dela foi um lead que chamou primeiro). Os 57% de resposta da tela contam a
autorresposta da propria loja: 27 das 33 respostas nunca tiveram uma pessoa do outro lado.

As duas maiores causas estao fora deste arquivo — a primeira mensagem fixa, que pede permissao
sem dizer o que e (ver `first-message-variants.md`), e a janela de envio 08:00-18:00 seg-sex,
que acerta a loja fechada. O que o `prompt.txt` explicava era o que acontece **depois** que
alguem responde, e isso aconteceu 6 vezes.

Nessas 6, o padrao foi identico: as 6 morreram na pergunta de descoberta. "Quem fica
respondendo o zap no pico?" e 0 de 6 — e as cinco perguntas sugeridas pelo prompt eram todas
abertas, do tipo que obriga o dono a parar o balcao e escrever um paragrafo.

Mudancas:

1. **O funil foi de 4 para 3 etapas: a etapa de permissao acabou.** Ela gastava o unico turno
   de atencao confirmando com quem se falava — em Godoy, Stout, De Lanches, Puro Sabor,
   Polillo e Dicapri a pessoa ja tinha respondido e ainda ouviu "e voce quem cuida do delivery
   ai?". A regra agora e literal: veio resposta de gente, diga o que e e pergunte na MESMA
   mensagem. O caso de quem nao decide virou situacao especial, so quando o lead trouxer.
2. **O banco de perguntas trocou de aberto para fechado.** Saíram as cinco perguntas de
   rotina; entraram cinco respondiveis em duas palavras ("chega a ficar mensagem sem
   resposta?", "na mao mesmo ou ja tem robo ajudando?"), com proibicao explicita de pergunta
   aberta de trabalho.
3. **O filtro de robo subiu para antes do funil.** Estava enterrado em "Situacoes especiais" e
   agora abre o roteiro, com a lista concreta do que e autorresposta — incluindo o cumprimento
   que repete o nome do contato ("Ola, Comercial"), que aparece em varias conversas.
4. **A prova deixou de depender da descoberta.** O cartao da pizzaria vai assim que a pessoa
   perguntar como funciona, responder qualquer coisa, ou a conversa travar. Era a etapa 3 e
   dependia de uma descoberta que nunca se completava.
5. **Regras duras 8 e 9**: nunca duas mensagens seguidas sem o lead falar no meio (Serginho,
   De Lanches e Stout receberam perguntas quase identicas em sequencia, com um minuto de
   diferenca) e nunca perguntar duas vezes a mesma coisa.
6. **Sistema citado pelo lead virou resposta, nao obstaculo.** De Lanches disse "ja trabalhamos
   com a Saipos e Glutoes" e ouviu de volta uma pergunta sobre o responsavel. Agora citar
   sistema e a descoberta pronta: espelha e vai para a prova. Entraram duas objecoes novas
   ("ja uso outro sistema", pelo nome, e "so pegamos pedido por link/app").
7. **Regra dura 7 restaurada.** A regra de que a Mariana nao e a IA de atendimento existia
   aqui no repositorio e tinha sumido do texto em producao — voltou para o topo.
8. **Emoji.** Producao dizia "SEM emojis" e ela usava emoji em quase toda conversa. A regra
   voltou para "no maximo 1 por mensagem", que e o que ela cumpre.

Fora dos prompts, tres coisas para a operacao (detalhe na analise): trocar a primeira mensagem
fixa, mover a janela de envio para 15:00-20:00 de terca a sabado, e colar o `bump-prompt.txt`
no campo "Prompt do segundo toque", que esta **vazio em producao**. E um ajuste de codigo: a
autorresposta da loja grava `last_inbound_at` e faz o lead virar `in_conversation`, entao o
follow-up entende "respondeu e esfriou" e manda `reengage` com o pitch inteiro para o robo —
393 geracoes em `reengage` contra 11 em `bump`.

## Revisao de 27/08: interesse sem handoff, e a despedida que nao acabava

Uma conversa so, a da Divinos Chocolateria (5512982039286, 26/08 das 15:44 as 16:02),
mostrou dois defeitos que nao sao dela: 17 chamadas de IA, `stage` travado em `solution` do
comeco ao fim, `actions` vazio em todas menos uma, e nenhum handoff.

**1. Interesse demonstrado nao acionava o Igor.** A lead recebeu o cartao da demonstracao,
disse "que legal, fico curiosa pra ver como funciona", "vou dar uma olhada com calma e
testar" e "depois converso com a equipe aqui pra ver se faz sentido pra gente". Nada disso
estava na lista da ETAPA 3, que so previa **testar e gostar**, perguntar preco, duvida
tecnica ou pedir para falar com uma pessoa — gatilhos todos reativos, que dependem de o lead
pedir. A regra geral do `SDR_BASE_PROMPT` ("se o lead pedir atendimento humano... solicite
handoff") e reativa pelo mesmo motivo, e a linha do funil consultivo ("quando houver
interesse... oferecer contato humano") era generica demais para vencer a lista enumerada do
prompt do SDR. A IA cumpriu o roteiro: ficou em `solution` esperando um pedido que nunca vem.

Correcoes: a ETAPA 3 passou a separar **oferecer o Igor** (pergunta, sem acao) de **acionar o
handoff** (depois do sim), com os sinais de interesse escritos — elogio, curiosidade, "vou
testar", "vou ver com a equipe" — e a instrucao de fazer a pergunta **antes** da despedida.
O bloco `consultivo` em `sdr-playbooks.ts` ganhou a secao "Como reconhecer o interesse",
espelhando o que o playbook `convite` ja tinha ("Como reconhecer o sim") e o consultivo nao.

**2. A IA se despediu 11 vezes seguidas.** Das 15:53 as 16:02, cada mensagem foi so cortesia
dos dois lados ("ate mais" / "ate logo" / "foi um prazer"), com uma geracao de IA por turno.
O outro lado quase certamente e um atendimento automatico: respondia em segundos, em varias
linhas, espelhando o tom. O `SDR_BASE_PROMPT` tinha a regra de loop, mas ela exigia a **mesma
mensagem** repetida — e os dois lados variavam a redacao a cada turno. Enquanto isso, as
regras de cortesia empurravam para o lado oposto: "resposta curta de gente... sempre merece
continuacao", "nunca fique calado depois de uma pergunta sua", "nada de frase cortada que soe
como porta na cara". Faltava dizer que despedida se responde uma vez.

Correcoes, todas no `SDR_BASE_PROMPT` (valem para qualquer SDR): bloco novo **"Despedida e
encerramento"** — a despedida se responde UMA vez e o que vier depois so com cortesia recebe
`nao_responder: true`; a regra de loop passou a falar em **ideia repetida**, nao texto
identico; e a lista fechada de casos de silencio passou a incluir "despedida que voce ja
respondeu", que era o que impedia a IA de calar sem quebrar outra regra.

Custo do defeito nesta conversa: 11 geracoes desperdicadas, 10 minutos de conversa depois do
assunto ter acabado, e o lead marcado `human_paused` na mao as 16:03.

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
