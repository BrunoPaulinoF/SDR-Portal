import { afterEach, describe, expect, it } from 'vitest';

import type { Conversation, Lead, SdrAgent } from '../src/db/schema.js';
import {
  createReplyDispatcher,
  createReplyJobProcessor,
  createReplyTransportSlot,
  type ReplyJobData,
  type ReplyJobOutcome,
} from '../src/modules/ai/reply-queue.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { withAgentLock } from '../src/modules/scheduler/agent-lock.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

const SECOND = 1000;

async function buildScenario(conversationId = 'conversation-1') {
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const agent = await sdrAgentRepository.create({ companyId: 'company-1', name: 'mariana', displayName: 'Mariana', isActive: true });
  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5517997243506',
    companyName: 'Pazzi Per Gelato',
    status: 'in_conversation',
    source: 'manual',
  });
  const conversation: Conversation = {
    id: conversationId,
    companyId: 'company-1',
    sdrAgentId: agent.id,
    leadId: lead.id,
    whatsappNumber: lead.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const conversationRepository = createMemoryConversationRepository([conversation], []);
  const answered: { agent: SdrAgent; conversation: Conversation; lead: Lead }[] = [];
  const sent: { data: ReplyJobData; startAfterSeconds: number }[] = [];

  return {
    agent,
    answered,
    conversation,
    conversationRepository,
    lead,
    leadRepository,
    sdrAgentRepository,
    sent,
    aiResponseService: {
      async respondToInbound(input: { agent: SdrAgent; conversation: Conversation; lead: Lead }) {
        answered.push(input);
      },
    },
    transport: {
      async send(data: ReplyJobData, startAfterSeconds: number) {
        sent.push({ data, startAfterSeconds });
      },
    },
  };
}

function jobFor(scenario: Awaited<ReturnType<typeof buildScenario>>, firstAt: Date): ReplyJobData {
  return {
    agentId: scenario.agent.id,
    conversationId: scenario.conversation.id,
    leadId: scenario.lead.id,
    firstAt: firstAt.toISOString(),
  };
}

describe('fila de respostas: quem recebe o pedido', () => {
  it('sem fila ligada responde pelo buffer em memoria, como antes', async () => {
    const scenario = await buildScenario();
    const viaMemory: string[] = [];
    const dispatcher = createReplyDispatcher({
      delayMs: 20 * SECOND,
      fallback: { async respondToInbound(input) { viaMemory.push(input.conversation.id); }, close() {} },
      transport: createReplyTransportSlot(),
    });

    await dispatcher.respondToInbound(scenario);

    expect(viaMemory).toEqual(['conversation-1']);
  });

  it('com a fila ligada so grava o pedido, com a espera do buffer', async () => {
    const scenario = await buildScenario();
    const slot = createReplyTransportSlot();
    slot.attach(scenario.transport);
    const viaMemory: string[] = [];
    const dispatcher = createReplyDispatcher({
      delayMs: 20 * SECOND,
      fallback: { async respondToInbound(input) { viaMemory.push(input.conversation.id); }, close() {} },
      transport: slot,
    });

    await dispatcher.respondToInbound(scenario);

    expect(viaMemory).toEqual([]);
    expect(scenario.sent).toHaveLength(1);
    expect(scenario.sent[0]?.startAfterSeconds).toBe(20);
    expect(scenario.sent[0]?.data).toMatchObject({ conversationId: 'conversation-1', leadId: scenario.lead.id });
  });

  it('fila recusando o pedido nao deixa o lead sem resposta', async () => {
    const scenario = await buildScenario();
    const slot = createReplyTransportSlot();
    slot.attach({
      async send() {
        throw new Error('connection terminated');
      },
    });
    const viaMemory: string[] = [];
    const dispatcher = createReplyDispatcher({
      delayMs: 20 * SECOND,
      fallback: { async respondToInbound(input) { viaMemory.push(input.conversation.id); }, close() {} },
      transport: slot,
    });

    await dispatcher.respondToInbound(scenario);

    expect(viaMemory).toEqual(['conversation-1']);
  });
});

describe('fila de respostas: o job', () => {
  it('responde quando o lead parou de digitar', async () => {
    const scenario = await buildScenario();
    const now = new Date('2026-10-02T15:00:30Z');
    await scenario.leadRepository.markInboundReceived(scenario.lead.id, new Date('2026-10-02T15:00:00Z'));
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND, now: () => now });

    const outcome = await processor.process(jobFor(scenario, new Date('2026-10-02T15:00:00Z')));

    expect(outcome).toBe('answered');
    expect(scenario.answered).toHaveLength(1);
    expect(scenario.sent).toEqual([]);
  });

  it('lead ainda digitando: volta para a fila pelo tempo que falta', async () => {
    const scenario = await buildScenario();
    // Primeira mensagem as 15:00:00, a ultima as 15:00:15; o job roda as 15:00:20.
    await scenario.leadRepository.markInboundReceived(scenario.lead.id, new Date('2026-10-02T15:00:15Z'));
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND, now: () => new Date('2026-10-02T15:00:20Z') });

    const outcome = await processor.process(jobFor(scenario, new Date('2026-10-02T15:00:00Z')));

    expect(outcome).toBe('waiting');
    expect(scenario.answered).toEqual([]);
    expect(scenario.sent[0]?.startAfterSeconds).toBe(15);
    // O inicio do bloco viaja junto: e ele que limita a espera total.
    expect(scenario.sent[0]?.data.firstAt).toBe('2026-10-02T15:00:00.000Z');
  });

  it('lead que nao para de escrever recebe resposta no teto da espera', async () => {
    const scenario = await buildScenario();
    await scenario.leadRepository.markInboundReceived(scenario.lead.id, new Date('2026-10-02T15:01:25Z'));
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND, now: () => new Date('2026-10-02T15:01:30Z') });

    const outcome = await processor.process(jobFor(scenario, new Date('2026-10-02T15:00:00Z')));

    expect(outcome).toBe('answered');
    expect(scenario.answered).toHaveLength(1);
  });

  it('nao gera duas respostas da mesma conversa ao mesmo tempo', async () => {
    const scenario = await buildScenario();
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND });

    let outcome: ReplyJobOutcome | null = null;
    await withAgentLock(`reply:${scenario.conversation.id}`, async () => {
      outcome = await processor.process(jobFor(scenario, new Date()));
    });

    expect(outcome).toBe('busy');
    expect(scenario.answered).toEqual([]);
    expect(scenario.sent[0]?.startAfterSeconds).toBe(20);
  });

  it('le o SDR e o lead do banco na hora de responder', async () => {
    const scenario = await buildScenario();
    await scenario.sdrAgentRepository.update(scenario.agent.id, { companyId: 'company-1', name: 'mariana', displayName: 'Mariana', prompt: 'prompt novo' });
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND });

    await processor.process(jobFor(scenario, new Date()));

    expect(scenario.answered[0]?.agent.prompt).toBe('prompt novo');
  });

  it('conversa apagada no meio da espera so encerra o job', async () => {
    const scenario = await buildScenario();
    const processor = createReplyJobProcessor({ ...scenario, delayMs: 20 * SECOND });

    const outcome = await processor.process({ ...jobFor(scenario, new Date()), conversationId: 'sumiu' });

    expect(outcome).toBe('gone');
    expect(scenario.answered).toEqual([]);
  });
});

/**
 * A fila de verdade, no pg-boss, contra um Postgres de teste. O que so o banco garante e o que
 * importa aqui: um pedido esperando por conversa (o segundo e descartado) e o job em andamento
 * conseguindo pedir a proxima rodada da mesma conversa.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('fila de respostas no pg-boss', () => {
  const bosses: { stop(options?: object): Promise<void> }[] = [];

  // Cada teste com o seu boss: um worker do teste anterior ainda ligado pegaria o job do proximo
  // com os repositorios em memoria errados.
  afterEach(async () => {
    await Promise.all(bosses.splice(0).map((boss) => boss.stop({ graceful: false, wait: true })));
  });

  async function startQueue(processor: { process(data: ReplyJobData): Promise<ReplyJobOutcome> }) {
    const { default: PgBoss } = await import('pg-boss');
    const { attachReplyQueue } = await import('../src/modules/scheduler/pg-boss-scheduler.js');
    const boss = new PgBoss({ connectionString: TEST_DATABASE_URL });
    boss.on('error', () => {});
    await boss.start();
    bosses.push(boss);
    const slot = createReplyTransportSlot();
    await attachReplyQueue(boss, processor, slot);
    return { boss, slot };
  }

  async function waitFor(check: () => boolean, timeoutMs = 15 * SECOND): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('fila nao processou a tempo');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('rajada do lead vira um pedido so, e a resposta sai', async () => {
    const scenario = await buildScenario(`rajada-${Date.now()}`);
    const outcomes: ReplyJobOutcome[] = [];
    const slot = createReplyTransportSlot();
    const real = createReplyJobProcessor({ ...scenario, delayMs: 1 * SECOND, transport: slot });
    const { slot: queueSlot } = await startQueue({
      async process(data) {
        const outcome = await real.process(data);
        outcomes.push(outcome);
        return outcome;
      },
    });
    slot.attach(queueSlot);
    const dispatcher = createReplyDispatcher({
      delayMs: 1 * SECOND,
      fallback: { async respondToInbound() { throw new Error('nao devia cair na memoria'); }, close() {} },
      transport: slot,
    });

    for (let index = 0; index < 3; index += 1) await dispatcher.respondToInbound(scenario);
    await waitFor(() => outcomes.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(outcomes).toEqual(['answered']);
    expect(scenario.answered).toHaveLength(1);
  }, 30 * SECOND);

  it('lead que escreveu durante a espera: o job volta para a fila e responde uma vez', async () => {
    const scenario = await buildScenario(`digitando-${Date.now()}`);
    const outcomes: ReplyJobOutcome[] = [];
    const slot = createReplyTransportSlot();
    const real = createReplyJobProcessor({ ...scenario, delayMs: 2 * SECOND, transport: slot });
    const { slot: queueSlot } = await startQueue({
      async process(data) {
        const outcome = await real.process(data);
        outcomes.push(outcome);
        return outcome;
      },
    });
    slot.attach(queueSlot);
    // A ultima mensagem do lead chega 3s depois do pedido: quando o job acordar (2s), falta espera.
    await scenario.leadRepository.markInboundReceived(scenario.lead.id, new Date(Date.now() + 3 * SECOND));

    await queueSlot.send(jobFor(scenario, new Date()), 2);
    await waitFor(() => outcomes.includes('answered'));

    expect(outcomes).toEqual(['waiting', 'answered']);
    expect(scenario.answered).toHaveLength(1);
  }, 30 * SECOND);
});
