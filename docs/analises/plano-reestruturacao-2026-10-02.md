# Raio-X dos SDRs e plano de reestruturação — 02/10/2026

Leitura feita **com dados de produção de hoje**: dashboard (7 dias, 30 dias e histórico, por
SDR), `/monitoring`, os 30 mil registros de `/job-logs` (maio → hoje), os 7.450 de `/ai-runs`,
as 77 conversas mais recentes da Mariana lidas uma a uma, o estado das instâncias na UAZAPI e
o código do `main`. Base anterior: os relatórios de agosto e setembro nesta pasta.

## O resumo em 30 segundos

1. **Hoje nenhum SDR está trabalhando.** Os dois WhatsApps estão desconectados: a Francielly
   **há 30 dias** (desde 02/09), a Mariana desde **29/09**.
2. **A Mariana quase não gera resultado mesmo quando está ligada.** Em 30 dias: 406
   abordagens → 86 pessoas responderam → **2 handoffs (0,5%)**. Foram 1.536 mensagens enviadas
   para 2 handoffs.
3. **A Francielly, quando funcionava, era 6× melhor**: 922 abordagens → 329 respostas de gente
   (36%) → **30 handoffs (3,3%)**.
4. **O sistema não sabe se alguém comprou.** A medição para no handoff. Não existe "reunião
   marcada", "teste começou" nem "virou cliente". Sem isso não dá para saber se qualquer
   mudança deu dinheiro.

O problema número 1 não é prompt, não é modelo e não é texto de abordagem: é **o canal fora do
ar e ninguém agindo quando ele cai**.

## Os números

| | Francielly (Insumo Smart) | Mariana (KyberFood) |
| --- | --- | --- |
| Leads na base | 1.853 | 758 |
| Abordagens (histórico) | 922 | 562 |
| Responderam como gente | 329 (36%) | 171 (30%) |
| Handoffs | 30 (3,3%) | 5 (0,9%) |
| Telefone inexistente | 430 (23%) | 89 (12%) |
| Parados na 1ª etapa (Permissão) | 66% | 74% |
| Últimos 30 dias | **1 abordagem** (fora do ar) | 406 abordagens, 86 respostas, **2 handoffs** |
| Playbook / abertura | `convite`, "Opa, tudo bom?" | `consultivo`, apresentação + pitch |
| Situação hoje | desconectada desde 02/09 (UAZAPI responde 401) | desconectada desde 29/09 ("same number connected") |

Tokens de IA da Mariana em 30 dias: **7 milhões**, em 1.162 chamadas.

## Pontos críticos — o que está derrubando o resultado

### 1. O WhatsApp cai e fica dias fora (o maior de todos)

**Mariana:** dos 23 dias úteis entre 01/09 e 01/10 (ter–sáb), ela trabalhou em **15** e ficou
fora em **8** — um terço do mês perdido. Os motivos que a UAZAPI registrou:

- `logged out from another device` — alguém removeu o aparelho em *Aparelhos conectados*;
- `QR Code timeout` — a reconexão começou e não foi terminada;
- `same number connected` — **o mesmo número foi ligado em outra instância**.

O último é o de agora e a causa está confirmada: em **29/09 às 18:01** (horário de Brasília) foi
criada na UAZAPI a instância `kyberfood-KyberFood-Homologacao-CW`, ligada **ao número da
Mariana** (+55 19 99337-2127). **Um minuto depois** a instância da Mariana caiu com `same number
connected`. A homologação foi desligada no dia seguinte, mas a Mariana nunca foi reconectada.

**Francielly:** fora desde 02/09. Primeiro `primary device was logged out` (759 vezes no log),
depois `UAZAPI respondeu HTTP 401` (448 vezes). 401 quer dizer que o token salvo no portal não
vale mais — a instância foi apagada ou recriada na UAZAPI. Ela também não aparece na lista de
instâncias da conta UAZAPI em que a Mariana está.

**Por que ninguém agiu:** o monitor funciona e mandou o alerta — mas **uma vez só**. O campo
"Repetir o alerta a cada" está em **0**, então o aviso sai na queda e nunca mais. E o relatório
diário mostra "Insumo Smart: 0 prospectados, 0 responderam" há 30 dias **sem dizer que o
WhatsApp está desconectado**. Para quem lê, parece dia fraco, não SDR morto. Na Mariana, entre o
alerta e a reconexão passaram de 2 a 4 dias em quase todas as quedas.

### 2. Lead quente parado agora

- **Fit013 Marmitas** — 29/09 às 16:05: *"Tenho interesse"*. A Mariana ofereceu o Igor e o
  WhatsApp caiu duas horas depois. Se o lead respondeu, a resposta não chegou ao portal.
- **Ih Sushi Bar** — 24/09: recebeu o contato da pizzaria de demonstração, está em "Solução" e
  ninguém voltou a falar com ele.

Os dois precisam de um humano **hoje**, pelo celular.

### 3. A primeira mensagem no ar não é a que a documentação diz

`first-message-variants.md` diz que desde 22/09 a variante ativa é *"Olá, tudo bem? Me chamo
Mariana, sou da KyberFood. Queria falar sobre o atendimento do WhatsApp de vocês…"*.

**Não é.** As 58 abordagens de setembro que li — inclusive as de 24/09 e 29/09 — saíram com o
texto antigo: *"…sou **do comercial** da KyberFood. **A gente tem uma IA que atende o WhatsApp do
delivery, responde na hora e monta o pedido sozinha**…"*. E logo em seguida vem a segunda
mensagem, que repete a mesma explicação com outras palavras. O dono abre o WhatsApp e lê **duas
mensagens de vendedor de IA dizendo a mesma coisa**, de um número desconhecido. É o retrato de
spam.

O erro aqui não é de texto, é de processo: **o que está no repositório e o que está no banco
divergem e nada avisa**.

### 4. A maioria das "respostas" ainda é robô — e o robô mata o lead em silêncio

Nas 77 conversas mais recentes da Mariana: 38 tiveram alguma resposta, **34 delas com robô da
loja**, e só **5 ou 6 com uma pessoa de verdade** (perto de 7%). Os robôs que ainda passam pelo
filtro:

- **Cardápio do dia em foto** ("Bom dia" + imagem, todo dia de manhã — Sabor Divino desde
  28/08, Ceciliana). Isso conta como "respondeu" no painel, e **a imagem pausa a IA para
  sempre** (`pauseAi` com motivo `lead_image_message`): o lead vira "Pausado por humano", o
  follow-up é desligado e **ninguém é avisado**.
- **Atendente de IA da própria loja** ("Desculpe, não consegui te entender", "não sou capaz de
  compreender frases muito longas") — a Mariana conversou com eles.

### 5. Bug: a rede de segurança manda a automática da loja para a IA

`pending-reply.ts` procura conversa cuja última mensagem é do lead e chama a IA de novo. Ele
**não olha `messages.auto_reply`**. Resultado: toda automática que o webhook acertou em ignorar
é mandada para a IA **duas vezes**, 5 e 10 minutos depois.

Nos logs de setembro: **375 das 576 gerações de resposta da Mariana (65%) terminaram em "ficar
calado"**, a ~10 mil tokens cada. O padrão é exato: duas chamadas por mensagem, 5 minutos de
intervalo, sempre do `pending-reply`. Além do custo, reabre a porta que o filtro de 02/09
fechou: basta o modelo errar uma vez para responder ao robô.

### 6. Não existe medição de resultado depois do handoff

O funil termina em `transferred`. Não há como marcar "reunião feita", "teste de 3 dias
começou", "virou cliente", "perdido". Os 35 handoffs da história do sistema não têm desfecho
registrado. Sem isso, toda decisão (abertura, prompt, modelo, limite) é tomada olhando taxa de
resposta, que é o número mais fácil de enganar.

### 7. Defeitos no código que perdem lead ou resultado

Revisão do código do `main` (348 testes passando, lint e `tsc` limpos — os defeitos abaixo são
de lógica, não de compilação):

| Gravidade | Defeito | Onde | Efeito |
| --- | --- | --- | --- |
| Crítico | Handoff some em silêncio: com `handoffPhone` vazio o aviso não sai e o lead vira `transferred` mesmo assim; se a UAZAPI recusar o aviso, o erro estoura **antes** de marcar o lead e nada tenta de novo | `ai/ai-response-service.ts` (`notifyHandoff` antes de `markTransferred`) | o único resultado que o sistema registra pode se perder |
| Alto | **Um follow-up por lead, para sempre**: `markFollowupSent` grava `followupDisabledAt` e nada limpa | `leads/db-lead-repository.ts` | quem respondeu ao segundo toque e esfriou nunca mais é procurado |
| Alto | Liberar a IA depois da pausa por foto não religa o follow-up (`resumeAi` não limpa `followupDisabledAt`) | `leads/db-lead-repository.ts` | o lead continua morto mesmo depois do clique |
| Alto | Filtro de robô pega frase de gente: "obrigado pelo contato, mas não temos interesse", "vou encaminhar pro meu sócio", "só um momento", qualquer link | `conversations/store-auto-reply.ts` | recusa não é registrada e sinal quente é ignorado |
| Alto | Mensagem que chega enquanto a IA está gerando dispara uma segunda resposta em paralelo | `ai/inbound-response-buffer.ts` | duas respostas seguidas = cara de robô |
| Alto | Erro de banco dentro do buffer derruba o processo (sem `catch`) e apaga todas as respostas pendentes | `ai/inbound-response-buffer.ts` | lead fica sem resposta |
| Médio | A rede de segurança só olha as 50 conversas mais recentes de todos os SDRs | `conversations/db-conversation-repository.ts` | lead que falou há poucas horas pode nunca ser visto |
| Médio | Sem trava ao pegar o lead: o botão manual e o cron podem mandar a primeira mensagem duas vezes; timeout da UAZAPI também | `scheduler/initial-outreach.ts` | mensagem duplicada para lead frio |
| Médio | Erro de envio no follow-up não reagenda: o mesmo lead trava a fila do SDR e a IA gera texto a cada 5 min sem enviar | `scheduler/followup-outreach.ts` | follow-ups param |
| Médio | Importação compara número exato e só dentro do SDR; não há lista de "não contatar" | `leads/lead-importer.ts` | mesma loja abordada por dois números; quem recusou volta |
| Médio | Dashboard carrega tabelas inteiras (inclusive o prompt de cada chamada de IA) a cada visita; banco sem índices de busca | `dashboard/`, `db/schema.ts` | lentidão e risco de estourar memória do container |

Segurança: o segredo do webhook vai na URL e aparece nos logs; o cookie de sessão não expira;
o login não limita tentativas.

## Onde o sistema está falhando para não dar resultado (as causas de fundo)

1. **Ninguém é dono do canal.** O alerta chega, mas não existe rotina de "caiu → reconecta na
   mesma hora". O mesmo número é usado em testes de outros produtos (homologação KyberFood) e
   derruba o SDR.
2. **O esforço foi para recursos novos enquanto o básico estava quebrado.** Em setembro entraram
   segunda mensagem, relatório diário, monitor de fila e, hoje, resposta em áudio com
   ElevenLabs — com a Francielly fora do ar o mês inteiro.
3. **Muitas mudanças ao mesmo tempo, sem teste controlado.** Abertura, prompt, modelo,
   limite diário e cooldown mudaram juntos várias vezes. Com 2 handoffs por mês não dá para
   saber o que ajudou e o que atrapalhou.
4. **Configuração em dois lugares.** Prompt e variante vivem no banco (tela do portal) e no
   repositório (`docs/prompts/`). Os dois divergem e nada mostra a diferença.
5. **A lista de leads é fraca.** 20% da base inteira é telefone inexistente, a maioria das lojas
   responde com robô, e as poucas pessoas que respondem muitas vezes não servem (não faz
   delivery, só retirada, só festa e casamento).
6. **A Mariana vende IA sendo IA, para quem já tem robô.** A abordagem que funcionou melhor no
   sistema (Francielly) é a mais humana e curta: "Opa, tudo bom?". A da Mariana é pitch de
   tecnologia na primeira linha.

## O plano

### Fase 0 — hoje (sem código)

1. **Reconectar a Mariana**: tela `/sdr-agents/<id>/conectar`, ler o QR code com o celular do
   número +55 19 99337-2127. **Não ligar esse número em nenhuma outra instância** (homologação,
   teste, Chatwoot). Se precisar testar o KyberFood, usar outro chip.
2. **Decidir a Francielly**: se a Insumo Smart continua, criar/reconectar a instância e
   atualizar o token no portal; se parou, **desativar o SDR** para ele sair do painel e dos
   alertas.
3. **Falar com Fit013 Marmitas e Ih Sushi Bar** pelo celular, hoje.
4. **Trocar a variante ativa** da Mariana na tela `Msg inicial` para o texto sem pitch que já
   está em `first-message-variants.md`, e conferir na próxima abordagem real que saiu certo.
5. **Monitor**: "Repetir o alerta a cada" = **120 minutos**, e pôr no alerta o celular de quem
   consegue ler o QR code.
6. **Segurança**: a instância `SDR-KyberFood` na UAZAPI tem uma chave da OpenAI salva no campo
   `openai_apikey`, visível para qualquer um com acesso à conta UAZAPI. Apagar o campo e gerar
   uma chave nova na OpenAI.

### Fase 1 — próximas 2 semanas: parar de perder lead (código pequeno, alto retorno)

| # | O quê | Onde | Por quê |
| --- | --- | --- | --- |
| 1 | `pending-reply` pular mensagem com `auto_reply = true` | `scheduler/pending-reply.ts` | corta ~65% das chamadas de resposta e o risco de responder robô |
| 2 | Relatório diário dizer **"WhatsApp DESCONECTADO desde …"** por SDR | `monitoring/daily-report-service.ts` | o relatório de "0 prospectados" escondeu 30 dias de SDR morto |
| 3 | Repetir alerta de queda por padrão (ex.: 120 min) | `monitoring/` + migração | um alerta só não basta |
| 4 | Imagem do lead **não** pausar a IA para sempre: pausar só se houver conversa humana antes, e avisar alguém | `uazapi-webhook-routes.ts`, `ai-pause.ts` | cardápio do dia em foto mata o lead em silêncio |
| 5 | Reconhecer "Bom dia + foto" repetido todo dia e bot de IA da loja como automática | `store-auto-reply.ts` | broadcast diário ainda conta como "respondeu" |
| 6 | Aviso no portal quando o prompt/variante no banco for diferente de `docs/prompts/` | tela do SDR / `apply-sdr-prompts` | a variante errada ficou no ar por 10 dias sem ninguém ver |
| 7 | Botão "falar com humano agora" para lead em `handoff_offer` parado há mais de 2 h | dashboard | o "Tenho interesse" não pode esperar o SDR voltar |
| 8 | Handoff: marcar o lead primeiro, avisar depois, com nova tentativa; recusar salvar SDR sem telefone de handoff | `ai/ai-response-service.ts`, tela do SDR | handoff não pode sumir |
| 9 | Tirar do filtro de robô as frases que gente também escreve ("obrigado pelo contato", "vou encaminhar", "só um momento", link solto) | `store-auto-reply.ts` | recusa e sinal quente voltam a ser vistos |
| 10 | Trava de "resposta em andamento" por conversa e `catch` no buffer | `inbound-response-buffer.ts` | acaba resposta dupla e queda do processo |
| 11 | Follow-up com erro de envio reagenda e conta tentativa, como o disparo inicial | `followup-outreach.ts` | um lead não trava a fila |

**Andamento (02/10):** feitos no código os itens 1, 2, 4, 5, 8, 9, 10 e 11. O 6 virou dois
avisos — na tela do SDR, quando o texto gravado difere de `docs/prompts/<sdr>/`, e na tela
`Msg inicial`, quando a variante ativa repete a segunda mensagem. O 7 virou alerta no painel
(lead em oferta de handoff parado há mais de 2h, e aviso de handoff que não chegou), não botão.
O 3 ficou como **ajuste na tela do monitor**: o código já usa 60 minutos por padrão; o 0 em
produção foi escolha de alguém, e a tela agora avisa o que ele custa — trocar é Fase 0.

### Fase 2 — 2 a 4 semanas: medir o que importa

1. **Desfecho depois do handoff** — novos status: `reuniao_marcada`, `teste_iniciado`,
   `cliente`, `perdido`, com data e motivo, marcados por quem atende (Igor/Fernando) na tela do
   lead. É a única forma de saber se o SDR dá dinheiro.
2. **Um funil só, igual em todas as telas** — enviados → entregues → **gente respondeu** →
   ouviu a proposta → handoff → reunião → cliente. Robô e broadcast fora de todas as contas.
3. **Saúde do canal no painel** — % de tempo conectado por SDR na semana, quedas e tempo até
   reconectar. Meta: 95% do horário de envio conectado.
4. **Teste A/B de verdade** — uma mudança por vez, duas variantes rodando juntas, comparação
   pela taxa de **gente** e de **handoff**, e só depois de ~150 envios por variante.

### Fase 3 — 1 a 2 meses: reestruturação

1. **Configuração com uma fonte só.** Os prompts e variantes passam a ser versionados no próprio
   banco (histórico de versões na tela, com quem mudou e quando) **ou** só no repositório com
   deploy automático — nunca os dois sem conferência.
2. **Separar o "motor" do "portal".** Hoje o mesmo processo serve a tela, recebe o webhook e roda
   os disparos. Webhook e envios viram um worker próprio, com fila persistente (pg-boss) em vez
   de buffer na memória: deploy não pode derrubar resposta de lead. Um job por conversa
   (debounce + uma resposta por vez) substitui o buffer **e** o `pending-reply`, e resolve de uma
   vez perda no restart, resposta dupla, a janela de 50 conversas e o filtro de robô.
3. **Cadência de verdade.** Trocar as colunas únicas `followupSentAt`/`followupDisabledAt` por
   uma sequência de N toques por lead, e reservar o lead (`FOR UPDATE SKIP LOCKED`) antes de
   qualquer envio.
4. **Camada de canal** isolando a UAZAPI: status, reconexão, limites (`wa_messages_limits`),
   aquecimento de número novo e troca de instância num lugar só. Permite trocar de provedor ou
   ter um número reserva por SDR.
5. **Prompts menores.** Hoje cada resposta leva ~10 mil tokens de regras (base + playbook +
   prompt da Mariana). Regra que o código já garante (robô, link, preço) sai do prompt. Menos
   regra, menos contradição, modelo mais obediente.
6. **Lista de leads melhor antes de gastar mensagem**: validar o número no WhatsApp na
   importação (não só na hora do envio), descartar quem não faz delivery, e priorizar lojas que
   **não** têm robô de atendimento.
7. **Abordagem da Mariana nos moldes da que funcionou**: curta e humana, sem pitch de IA na
   primeira mensagem, e a explicação só quando a pessoa perguntar. Medir contra a atual com o
   A/B da Fase 2.

## Metas para saber se melhorou

| Indicador | Hoje | Meta em 30 dias |
| --- | --- | --- |
| Tempo conectado no horário de envio | ~65% (Mariana), 0% (Francielly) | 95% |
| Tempo entre queda e reconexão | 2 a 4 dias | menos de 2 horas |
| Resposta de **gente** / abordagens | ~21% | 25% |
| Handoff / abordagens (Mariana) | 0,5% | 2% |
| Chamadas de IA que terminam em "ficar calado" | 65% | menos de 20% |
| Handoffs com desfecho registrado | 0% | 100% |

## Ressalvas

- As 77 conversas lidas são as mais recentes da caixa da Mariana, não o mês inteiro. A
  separação gente/robô foi feita pela etiqueta do portal e conferida a olho.
- "Responderam" no relatório diário conta qualquer lead que respondeu no dia, inclusive de
  abordagens antigas — serve para tendência, não para taxa exata.
- A Francielly vende outro produto (Insumo Smart) para outro público. A comparação com a
  Mariana mostra que abordagem curta funciona melhor **neste sistema**, não que os produtos se
  equivalem.
