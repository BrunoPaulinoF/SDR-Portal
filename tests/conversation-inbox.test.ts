import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { buildInboxChats, buildInboxThread, inboxMessageLimit } from '../src/modules/conversations/conversation-inbox.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import type { Message } from '../src/db/schema.js';

const timeZone = 'America/Sao_Paulo';
const now = new Date('2026-08-20T18:00:00Z');

interface MessageOverrides {
  createdAt: Date;
  conversationId: string;
  direction?: string;
  senderType?: string;
  messageType?: string;
  text?: string | null;
  transcription?: string | null;
}

function message(overrides: MessageOverrides): Message {
  return {
    id: `msg-${overrides.createdAt.toISOString()}-${overrides.conversationId}`,
    conversationId: overrides.conversationId,
    leadId: 'lead',
    sdrAgentId: 'sdr',
    direction: overrides.direction ?? 'inbound',
    senderType: overrides.senderType ?? 'lead',
    whatsappMessageId: null,
    messageType: overrides.messageType ?? 'conversation',
    text: overrides.text ?? null,
    transcription: overrides.transcription ?? null,
    mediaUrl: null,
    rawPayload: null,
    sentByApi: false,
    fromMe: overrides.direction === 'outbound',
    createdAt: overrides.createdAt,
  };
}

async function buildScenario() {
  const leads = createMemoryLeadRepository();
  const conversations = createMemoryConversationRepository();
  const base = { companyId: 'c1', sdrAgentId: 'sdr', source: 'manual' };

  const padaria = await leads.create({
    ...base,
    whatsappNumber: '5519999990001',
    companyName: 'PADARIA SÃO JOÃO LTDA',
    contactName: 'Joana',
    status: 'in_conversation',
  });
  const pizzaria = await leads.create({
    ...base,
    whatsappNumber: '5519999990002',
    companyName: 'PIZZARIA DO ZE',
    status: 'initial_sent',
  });

  const chatPadaria = await conversations.create({
    companyId: 'c1',
    sdrAgentId: 'sdr',
    leadId: padaria.id,
    whatsappNumber: padaria.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date('2026-08-19T12:00:00Z'),
  });
  const chatPizzaria = await conversations.create({
    companyId: 'c1',
    sdrAgentId: 'sdr',
    leadId: pizzaria.id,
    whatsappNumber: pizzaria.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date('2026-08-20T17:30:00Z'),
  });

  return {
    conversations,
    leads: [padaria, pizzaria],
    chatPadaria,
    chatPizzaria,
    lastMessages: [
      message({ conversationId: chatPadaria.id, createdAt: new Date('2026-08-19T12:00:00Z'), text: 'Pode me mandar depois' }),
      message({
        conversationId: chatPizzaria.id,
        createdAt: new Date('2026-08-20T17:30:00Z'),
        direction: 'outbound',
        senderType: 'ai',
        text: 'Perfeito, mando o material agora mesmo',
      }),
    ],
  };
}

describe('lista de chats da caixa de conversas', () => {
  it('ordena pela ultima mensagem e resume quem falou por ultimo', async () => {
    const cenario = await buildScenario();

    const inbox = buildInboxChats({
      conversations: [cenario.chatPadaria, cenario.chatPizzaria],
      lastMessages: cenario.lastMessages,
      leads: cenario.leads,
      now,
      timeZone,
    });

    expect(inbox.total).toBe(2);
    expect(inbox.chats.map((chat) => chat.title)).toEqual(['Pizzaria do Ze', 'Padaria São João']);
    // conversa de hoje mostra a hora local; a de ontem mostra "Ontem"
    expect(inbox.chats[0]?.timeLabel).toBe('14:30');
    expect(inbox.chats[1]?.timeLabel).toBe('Ontem');
    expect(inbox.chats[0]?.preview).toBe('IA: Perfeito, mando o material agora mesmo');
    expect(inbox.chats[0]?.awaitingReply).toBe(false);
    // o lead falou por ultimo e ninguem respondeu: e o chat que precisa de olho
    expect(inbox.chats[1]?.awaitingReply).toBe(true);
    expect(inbox.chats[1]?.numberLabel).toBe('+55 19 99999-0001');
    expect(inbox.chats[1]?.initials).toBe('PS');
  });

  it('acha o chat por nome sem acento e por numero com pontuacao', async () => {
    const cenario = await buildScenario();
    const input = {
      conversations: [cenario.chatPadaria, cenario.chatPizzaria],
      lastMessages: cenario.lastMessages,
      leads: cenario.leads,
      now,
      timeZone,
    };

    expect(buildInboxChats({ ...input, search: 'padaria sao joao' }).chats.map((chat) => chat.conversationId)).toEqual([
      cenario.chatPadaria.id,
    ]);
    expect(buildInboxChats({ ...input, search: '(19) 99999-0002' }).chats.map((chat) => chat.conversationId)).toEqual([
      cenario.chatPizzaria.id,
    ]);
    expect(buildInboxChats({ ...input, search: 'material agora' }).chats.map((chat) => chat.conversationId)).toEqual([
      cenario.chatPizzaria.id,
    ]);
    expect(buildInboxChats({ ...input, search: 'nao existe' }).chats).toHaveLength(0);
  });

  it('chat sem mensagem nenhuma continua na lista, sem previa e sem hora quebrada', async () => {
    const cenario = await buildScenario();

    const inbox = buildInboxChats({
      conversations: [cenario.chatPadaria],
      lastMessages: [],
      leads: cenario.leads,
      now,
      timeZone,
    });

    expect(inbox.chats[0]?.preview).toBe('Sem mensagens');
    expect(inbox.chats[0]?.awaitingReply).toBe(false);
  });
});

describe('thread da conversa', () => {
  it('separa por dia, marca quem enviou e traz a transcricao do audio', async () => {
    const cenario = await buildScenario();
    const messages = [
      message({
        conversationId: cenario.chatPadaria.id,
        createdAt: new Date('2026-08-19T13:00:00Z'),
        direction: 'outbound',
        senderType: 'ai',
        text: 'Oi Joana, tudo bem?',
      }),
      message({
        conversationId: cenario.chatPadaria.id,
        createdAt: new Date('2026-08-20T13:10:00Z'),
        messageType: 'audio',
        transcription: 'Tudo certo, pode mandar',
      }),
      message({
        conversationId: cenario.chatPadaria.id,
        createdAt: new Date('2026-08-20T13:20:00Z'),
        direction: 'outbound',
        senderType: 'human',
        text: 'Aqui e o Bruno, assumindo daqui',
      }),
    ];

    const thread = buildInboxThread({
      conversation: cenario.chatPadaria,
      lead: cenario.leads[0] ?? null,
      messages,
      now,
      timeZone,
    });

    expect(thread.days.map((day) => day.label)).toEqual(['Ontem', 'Hoje']);
    expect(thread.days[0]?.messages[0]).toMatchObject({ direction: 'outbound', authorLabel: 'IA', timeLabel: '10:00' });
    expect(thread.days[1]?.messages[0]).toMatchObject({
      direction: 'inbound',
      authorLabel: '',
      kindLabel: 'Audio transcrito',
      body: 'Tudo certo, pode mandar',
    });
    // mensagem enviada do celular aparece marcada como manual: e o que pausa a IA
    expect(thread.days[1]?.messages[1]?.authorLabel).toBe('Manual');
    expect(thread.statusLabel).toBe('Em conversa');
    expect(thread.stageLabel).toBe('Permissao');
    expect(thread.hiddenMessages).toBe(0);
  });

  it('corta o historico antigo e avisa quantas mensagens ficaram de fora', async () => {
    const cenario = await buildScenario();
    const messages = Array.from({ length: inboxMessageLimit + 5 }, (_, index) =>
      message({
        conversationId: cenario.chatPadaria.id,
        createdAt: new Date(Date.UTC(2026, 7, 20, 10, index)),
        text: `mensagem ${index}`,
      }),
    );

    const thread = buildInboxThread({ conversation: cenario.chatPadaria, lead: null, messages, now, timeZone });
    const shown = thread.days.flatMap((day) => day.messages);

    expect(thread.totalMessages).toBe(inboxMessageLimit + 5);
    expect(shown).toHaveLength(inboxMessageLimit);
    expect(thread.hiddenMessages).toBe(5);
    // o corte guarda o fim da conversa, que e o que interessa acompanhar
    expect(shown[shown.length - 1]?.body).toBe(`mensagem ${inboxMessageLimit + 4}`);
  });
});

async function loggedInApp(options: Parameters<typeof buildApp>[0] = {}) {
  const authRepository = createMemoryAuthRepository();
  await authRepository.createUser({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('segredo123'),
    role: 'admin',
  });
  const app = buildApp({ authRepository, ...options });
  const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
  const cookie = login.cookies[0];
  return { app, cookie: `${cookie?.name}=${cookie?.value}` };
}

async function buildPortal() {
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const leadRepository = createMemoryLeadRepository();
  const conversationRepository = createMemoryConversationRepository();

  const mariana = await sdrAgentRepository.create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });
  const carlos = await sdrAgentRepository.create({ companyId: 'c1', name: 'Carlos', displayName: 'Carlos', isActive: true });
  // SDR recem-criado, primeiro na ordem alfabetica e ainda sem nenhuma conversa
  await sdrAgentRepository.create({ companyId: 'c1', name: 'Ana', displayName: 'Ana', isActive: false });

  const leadMariana = await leadRepository.create({
    companyId: 'c1',
    sdrAgentId: mariana.id,
    whatsappNumber: '5519999990001',
    companyName: 'PADARIA DA ESQUINA',
    status: 'in_conversation',
    source: 'manual',
  });
  const leadCarlos = await leadRepository.create({
    companyId: 'c1',
    sdrAgentId: carlos.id,
    whatsappNumber: '5519999990002',
    companyName: 'ACAITERIA CENTRAL',
    status: 'in_conversation',
    source: 'manual',
  });

  const chatMariana = await conversationRepository.create({
    companyId: 'c1',
    sdrAgentId: mariana.id,
    leadId: leadMariana.id,
    whatsappNumber: leadMariana.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date('2026-08-20T17:00:00Z'),
  });
  const chatCarlos = await conversationRepository.create({
    companyId: 'c1',
    sdrAgentId: carlos.id,
    leadId: leadCarlos.id,
    whatsappNumber: leadCarlos.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date('2026-08-20T17:10:00Z'),
  });

  await conversationRepository.createMessage({
    conversationId: chatMariana.id,
    leadId: leadMariana.id,
    sdrAgentId: mariana.id,
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'conversation',
    text: 'Pode mandar os precos da padaria',
  });
  await conversationRepository.createMessage({
    conversationId: chatCarlos.id,
    leadId: leadCarlos.id,
    sdrAgentId: carlos.id,
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'conversation',
    text: 'Aqui e a acaiteria, bom dia',
  });

  // o webhook real marca a chegada no lead; sem isso o lead fica sem historico de entrada
  await leadRepository.markInboundReceived(leadMariana.id, new Date('2026-08-20T17:00:00Z'));
  await leadRepository.markInboundReceived(leadCarlos.id, new Date('2026-08-20T17:10:00Z'));

  return { carlos, chatCarlos, chatMariana, conversationRepository, leadRepository, mariana, sdrAgentRepository };
}

describe('rota /conversations', () => {
  it('sem parametro nenhum ja abre o primeiro SDR com a conversa dele aberta', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({ method: 'GET', url: '/conversations', headers: { cookie } });

    // Ana vem antes na ordem alfabetica, mas nao tem conversa: a caixa abre no primeiro SDR que tem
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Acaiteria Central');
    expect(response.body).toContain('Aqui e a acaiteria, bom dia');
    expect(response.body).not.toContain('Padaria da Esquina');
    expect(response.body).toContain('chat-item-active');
    await app.close();
  });

  it('troca de SDR pelo seletor e mostra so os chats dele', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({ method: 'GET', url: `/conversations?sdr=${portal.mariana.id}`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Padaria da Esquina');
    expect(response.body).toContain('Pode mandar os precos da padaria');
    expect(response.body).not.toContain('Acaiteria Central');
    await app.close();
  });

  it('a busca filtra a lista no servidor', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const semResultado = await app.inject({
      method: 'GET',
      url: `/conversations?sdr=${portal.mariana.id}&q=confeitaria`,
      headers: { cookie },
    });

    expect(semResultado.statusCode).toBe(200);
    expect(semResultado.body).toContain('Nenhuma conversa encontrada para essa busca.');
    await app.close();
  });

  it('link antigo /conversations/:id abre a mesma conversa dentro da caixa', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({ method: 'GET', url: `/conversations/${portal.chatCarlos.id}`, headers: { cookie } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/conversations?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}`);
    await app.close();
  });

  it('conversa inexistente continua respondendo 404', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/conversations/22222222-2222-4222-8222-222222222222',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('sem login a caixa de conversas manda para o /login', async () => {
    const portal = await buildPortal();
    const app = buildApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({ method: 'GET', url: '/conversations' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    await app.close();
  });
});

describe('pausa da IA na caixa de conversas', () => {
  it('conversa pausada mostra o motivo e o botao de liberar', async () => {
    const portal = await buildPortal();
    await portal.leadRepository.pauseAi(portal.chatCarlos.leadId, new Date('2026-08-20T17:20:00Z'), 'lead_image_message');
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/conversations?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('o lead enviou uma imagem');
    expect(response.body).toContain('Liberar IA');
    expect(response.body).toContain(`/conversations/${portal.chatCarlos.id}/ia`);
    await app.close();
  });

  it('o botao libera a IA e devolve o lead para a conversa', async () => {
    const portal = await buildPortal();
    await portal.leadRepository.pauseAi(portal.chatCarlos.leadId, new Date('2026-08-20T17:20:00Z'), 'manual_whatsapp_message');
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${portal.chatCarlos.id}/ia`,
      headers: { cookie },
      payload: { acao: 'liberar' },
    });
    const lead = await portal.leadRepository.findById(portal.chatCarlos.leadId);

    // sem JS o formulario volta para a mesma conversa dentro da caixa
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/conversations?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}`);
    expect(lead?.aiPausedAt).toBeNull();
    expect(lead?.aiPauseReason).toBeNull();
    expect(lead?.status).toBe('in_conversation');
    await app.close();
  });

  it('o mesmo botao pausa a IA quando ela esta ativa', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${portal.chatCarlos.id}/ia`,
      headers: { cookie, accept: 'application/json' },
      payload: { acao: 'pausar' },
    });
    const lead = await portal.leadRepository.findById(portal.chatCarlos.leadId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, acao: 'pausar' });
    expect(lead?.status).toBe('human_paused');
    expect(lead?.aiPauseReason).toBe('portal_manual');
    // pausa sem prazo: nada expira sozinho
    expect(lead?.humanPausedUntil).toBeNull();
    await app.close();
  });

  it('sem login o botao nao pausa nada', async () => {
    const portal = await buildPortal();
    const app = buildApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${portal.chatCarlos.id}/ia`,
      payload: { acao: 'pausar' },
    });
    const lead = await portal.leadRepository.findById(portal.chatCarlos.leadId);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    expect(lead?.aiPausedAt).toBeNull();
    await app.close();
  });
});

describe('conversas em tempo real sem recarregar a pagina', () => {
  it('abre outra conversa pelo /conversations/updates, sem HTML da pagina inteira', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/conversations/updates?sdr=${portal.mariana.id}&chat=${portal.chatMariana.id}`,
      headers: { cookie },
    });
    const dados = response.json();

    expect(response.statusCode).toBe(200);
    expect(dados.chat).toBe(portal.chatMariana.id);
    expect(dados.threadHtml).toContain('Pode mandar os precos da padaria');
    expect(dados.chatsHtml).toContain('Padaria da Esquina');
    // fragmento, nao pagina: nada de <html> nem do menu lateral
    expect(dados.threadHtml).not.toContain('<html');
    expect(dados.chatsHtml).not.toContain('sidebar');
    await app.close();
  });

  it('assinatura igual devolve resposta vazia, para a tela nao piscar a cada rodada', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const primeira = await app.inject({
      method: 'GET',
      url: `/conversations/updates?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}`,
      headers: { cookie },
    });
    const assinaturas = primeira.json();
    const segunda = await app.inject({
      method: 'GET',
      url: `/conversations/updates?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}&chatsSig=${assinaturas.chatsSig}&threadSig=${assinaturas.threadSig}`,
      headers: { cookie },
    });
    const dados = segunda.json();

    expect(segunda.statusCode).toBe(200);
    expect(dados.chatsHtml).toBeUndefined();
    expect(dados.threadHtml).toBeUndefined();
    expect(dados.chatsSig).toBe(assinaturas.chatsSig);
    await app.close();
  });

  it('mensagem nova muda a assinatura e volta com o HTML atualizado', async () => {
    const portal = await buildPortal();
    const { app, cookie } = await loggedInApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const primeira = await app.inject({
      method: 'GET',
      url: `/conversations/updates?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}`,
      headers: { cookie },
    });
    const assinaturas = primeira.json();
    await portal.conversationRepository.createMessage({
      conversationId: portal.chatCarlos.id,
      leadId: portal.chatCarlos.leadId,
      sdrAgentId: portal.carlos.id,
      direction: 'inbound',
      senderType: 'lead',
      messageType: 'conversation',
      text: 'Chegou agora, em tempo real',
    });

    const segunda = await app.inject({
      method: 'GET',
      url: `/conversations/updates?sdr=${portal.carlos.id}&chat=${portal.chatCarlos.id}&chatsSig=${assinaturas.chatsSig}&threadSig=${assinaturas.threadSig}`,
      headers: { cookie },
    });
    const dados = segunda.json();

    expect(dados.threadHtml).toContain('Chegou agora, em tempo real');
    expect(dados.chatsHtml).toContain('Chegou agora, em tempo real');
    expect(dados.threadSig).not.toBe(assinaturas.threadSig);
    await app.close();
  });

  it('sem login a atualizacao manda para o /login em vez de vazar conversa', async () => {
    const portal = await buildPortal();
    const app = buildApp({
      conversationRepository: portal.conversationRepository,
      leadRepository: portal.leadRepository,
      sdrAgentRepository: portal.sdrAgentRepository,
    });

    const response = await app.inject({ method: 'GET', url: '/conversations/updates' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    await app.close();
  });
});
