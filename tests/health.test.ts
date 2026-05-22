import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import type { AiClient, AiGenerateResult } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryAuthRepository, type AuthUser } from '../src/modules/auth/auth-repository.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { importLeadsFromExcel } from '../src/modules/leads/lead-importer.js';
import { createMemoryLeadResearchRepository } from '../src/modules/leads/lead-research-repository.js';
import type { LeadResearchProvider, LeadResearchResult } from '../src/modules/leads/lead-research-service.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import { normalizeUazapiWebhook } from '../src/modules/webhooks/uazapi-normalizer.js';
import { createMemoryWebhookEventRepository } from '../src/modules/webhooks/webhook-event-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import writeXlsxFile from 'write-excel-file/node';

let app: AppInstance | undefined;

async function createTestUser(): Promise<AuthUser> {
  return {
    id: '8bfcf9a6-38f9-4a0d-8f4d-7818adf99680',
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('password123'),
    role: 'admin',
  };
}

async function login(): Promise<string> {
  const loginResponse = await app?.inject({
    method: 'POST',
    url: '/login',
    payload: 'email=admin%40example.com&password=password123',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });

  const cookie = loginResponse?.cookies[0];
  expect(loginResponse?.statusCode).toBe(302);
  expect(cookie?.name).toBe('sdr_portal_session');
  return cookie?.value ?? '';
}

function formPayload(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function multipartPayload(
  boundary: string,
  parts: Array<{ contentType?: string; data?: Buffer; filename?: string; name: string; value?: string }>,
): Buffer {
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));

    if (part.filename) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
      chunks.push(Buffer.from(`Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`));
      chunks.push(part.data ?? Buffer.alloc(0));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ''}\r\n`));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function createMockUazapiClient(
  calls: string[],
  whatsappExistsByNumber: Record<string, boolean> = {},
  sentChatIdByNumber: Record<string, string> = {},
): UazapiClient {
  const ok = (body: unknown): UazapiResult => ({ status: 200, ok: true, body });

  return {
    async checkChats(input) {
      calls.push(`check:${input.numbers.join(',')}:${input.token}`);
      return ok(
        input.numbers.map((number) => ({
          query: number,
          jid: whatsappExistsByNumber[number] === false ? undefined : `${number}@s.whatsapp.net`,
          isInWhatsapp: whatsappExistsByNumber[number] ?? true,
          verifiedName: whatsappExistsByNumber[number] === false ? undefined : 'Contato Teste',
        })),
      );
    },

    async configureWebhook(input) {
      calls.push(`webhook:${input.url}:${input.token}`);
      return ok({ response: 'webhook configured' });
    },

    async downloadMessage(input) {
      calls.push(`download:${input.id}:${input.transcribe ? 'transcribe' : 'raw'}:${input.token}`);
      return ok({ fileURL: 'https://api.uazapi.com/files/audio.mp3', transcription: 'Texto transcrito do audio' });
    },

    async getInstanceStatus(input) {
      calls.push(`status:${input.baseUrl}:${input.token}`);
      return ok({ connected: true, loggedIn: true });
    },

    async sendPresence(input) {
      calls.push(`presence:${input.number}:${input.presence}:${input.token}`);
      return ok({ response: 'presence sent' });
    },

    async sendText(input) {
      calls.push(`text:${input.number}:${input.text}:${input.token}`);
      return ok({ chatid: `${sentChatIdByNumber[input.number] ?? input.number}@s.whatsapp.net`, response: 'message sent' });
    },
  };
}

function createMockAiClient(calls: string[], outputText: string): AiClient {
  return {
    async generate(input) {
      const webSearch = input.webSearch ? `web:${input.webSearch.searchContextSize ?? 'low'}` : 'web:none';
      calls.push(`${input.provider}:${input.model}:${webSearch}:${input.messages.map((message) => message.content).join('\n---\n')}`);
      return {
        outputText,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      } satisfies AiGenerateResult;
    },
  };
}

function createSequencedMockAiClient(calls: string[], outputTexts: string[]): AiClient {
  let index = 0;
  return {
    async generate(input) {
      const webSearch = input.webSearch ? `web:${input.webSearch.searchContextSize ?? 'low'}` : 'web:none';
      calls.push(`${input.provider}:${input.model}:${webSearch}:${input.messages.map((message) => message.content).join('\n---\n')}`);
      const outputText = outputTexts[Math.min(index, outputTexts.length - 1)] ?? outputTexts[0] ?? '{}';
      index += 1;
      return {
        outputText,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      } satisfies AiGenerateResult;
    },
  };
}

function createMockLeadResearchProvider(calls: string[], result: LeadResearchResult | null): LeadResearchProvider {
  return {
    async research(input) {
      calls.push(input.query);
      return result;
    },
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('health route', () => {
  it('returns service status', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<{ status: string; timestamp: string; uptime: number }>();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });
});

describe('auth routes', () => {
  it('requires login to access dashboard', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  it('logs in and renders dashboard', async () => {
    const user = await createTestUser();

    app = buildApp({ authRepository: createMemoryAuthRepository([user]) });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/login',
      payload: 'email=admin%40example.com&password=password123',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    const cookie = loginResponse.cookies[0];
    expect(loginResponse.statusCode).toBe(302);
    expect(loginResponse.headers.location).toBe('/dashboard');
    expect(cookie?.name).toBe('sdr_portal_session');

    const dashboardResponse = await app.inject({
      method: 'GET',
      url: '/dashboard',
      cookies: {
        [cookie?.name ?? '']: cookie?.value ?? '',
      },
    });

    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.body).toContain('SDR Portal');
    expect(dashboardResponse.body).toContain('admin@example.com');
  });

  it('renders dashboard KPIs from repository data', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Kyane',
      isActive: true,
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const pendingLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      companyName: 'Restaurante Pendente',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const handoffLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511888888888',
      companyName: 'Restaurante Handoff',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const followupLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511777777777',
      companyName: 'Restaurante Followup',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const discardedLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511666666666',
      companyName: 'Contato Descartado',
      cnpj: null,
      tradeName: null,
      segment: 'MEI',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const invalidPhoneLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511555555555',
      companyName: 'Contato Sem WhatsApp',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const now = new Date();
    await leadRepository.markInitialSent(handoffLead.id, new Date(now.getTime() - 90 * 60 * 1000), null);
    await leadRepository.markInboundReceived(handoffLead.id, new Date(now.getTime() - 80 * 60 * 1000));
    await leadRepository.markTransferred(handoffLead.id, new Date(now.getTime() - 60 * 60 * 1000), 'Lead pediu contato comercial.');
    await leadRepository.markInitialSent(followupLead.id, new Date(now.getTime() - 48 * 60 * 60 * 1000), new Date(now.getTime() - 60 * 60 * 1000));
    await leadRepository.markFollowupSent(followupLead.id, new Date(now.getTime() - 30 * 60 * 1000));
    await leadRepository.markDiscarded(discardedLead.id, new Date(now.getTime() - 20 * 60 * 1000));
    await leadRepository.markInvalidPhone(invalidPhoneLead.id, new Date(now.getTime() - 10 * 60 * 1000));
    const conversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: handoffLead.id,
      whatsappNumber: handoffLead.whatsappNumber,
      status: 'open',
      lastMessageAt: now,
    });
    await conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: handoffLead.id,
      sdrAgentId: agent.id,
      direction: 'inbound',
      senderType: 'lead',
      whatsappMessageId: 'in-1',
      messageType: 'conversation',
      text: 'Tenho interesse',
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: false,
      fromMe: false,
    });
    await conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: handoffLead.id,
      sdrAgentId: agent.id,
      direction: 'outbound',
      senderType: 'ai',
      whatsappMessageId: 'out-1',
      messageType: 'conversation',
      text: 'Vou te encaminhar.',
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: true,
      fromMe: true,
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'GET',
      url: '/dashboard?period=7d',
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Mensagens enviadas');
    expect(response.body).toContain('Responderam');
    expect(response.body).toContain('Handoffs');
    expect(response.body).toContain('Follow-ups feitos');
    expect(response.body).toContain('Descartados');
    expect(response.body).toContain('Telefone inexistente');
    expect(response.body).toContain('Tel. inexistente');
    expect(response.body).toContain('Proximos disparos por SDR');
    expect(response.body).toContain('Pendentes');
    expect(response.body).toContain('1 SDR(s) com menos de 100 leads pendentes');
    expect(response.body).toContain('abaixo de 100');
    expect(response.body).toContain('Restaurante Pendente');
    expect(response.body).toContain(`/leads/${pendingLead.id}`);
    expect(response.body).toContain('pronto agora');
    expect(response.body).toContain('Insumo Smart');
  });
});

describe('company routes', () => {
  it('requires login to list companies', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/companies' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  it('creates, updates and deletes a company', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    app = buildApp({ authRepository: createMemoryAuthRepository([user]), companyRepository });
    const sessionCookie = await login();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/companies',
      payload: 'name=Insumo%20Smart&segment=Gastronomia&cnpj=12345678000199&defaultHandoffName=Fernando',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(createResponse.statusCode).toBe(302);
    expect(createResponse.headers.location).toBe('/companies');

    const [createdCompany] = await companyRepository.list();
    expect(createdCompany?.name).toBe('Insumo Smart');

    const listResponse = await app.inject({
      method: 'GET',
      url: '/companies',
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.body).toContain('Insumo Smart');
    expect(listResponse.body).toContain('Gastronomia');

    const updateResponse = await app.inject({
      method: 'POST',
      url: `/companies/${createdCompany?.id}`,
      payload: 'name=Insumo%20Smart%20Consultoria&segment=Restaurantes',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(updateResponse.statusCode).toBe(302);
    expect(updateResponse.headers.location).toBe('/companies');

    const updatedCompany = createdCompany ? await companyRepository.findById(createdCompany.id) : null;
    expect(updatedCompany?.name).toBe('Insumo Smart Consultoria');
    expect(updatedCompany?.segment).toBe('Restaurantes');

    const deleteResponse = await app.inject({
      method: 'POST',
      url: `/companies/${createdCompany?.id}/delete`,
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(deleteResponse.statusCode).toBe(302);
    expect(await companyRepository.list()).toHaveLength(0);
  });
});

describe('SDR agent routes', () => {
  it('requires login to list SDRs', async () => {
    app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/sdr-agents' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  it('creates, updates, toggles and deletes an SDR', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: 'Fernando',
      defaultHandoffPhone: '5511999999999',
    });

    app = buildApp({ authRepository: createMemoryAuthRepository([user]), companyRepository, sdrAgentRepository });
    const sessionCookie = await login();

    const newPageResponse = await app.inject({
      method: 'GET',
      url: '/sdr-agents/new',
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(newPageResponse.statusCode).toBe(200);
    expect(newPageResponse.body).toContain('Direcionamento estrategico gratuito');
    expect(newPageResponse.body).toContain('Prompt editavel do SDR');
    expect(newPageResponse.body).toContain('Prompt de qualificacao e descarte do lead');
    expect(newPageResponse.body).toContain('gpt-5.4-mini');
    expect(newPageResponse.body).toContain('{{companyName}}');
    expect(newPageResponse.body).toContain('help-tooltip');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/sdr-agents',
      payload: formPayload({
        companyId: company.id,
        name: 'sdr-insumo-smart',
        displayName: 'Franciely',
        productName: 'Consultoria CMV',
        leadQualificationPrompt: 'Descartar apenas leads sem empresa estruturada.',
        aiProvider: 'openai',
        aiModel: 'gpt-4o-mini',
        aiTemperature: '0.4',
        aiMaxOutputTokens: '800',
        timezone: 'America/Sao_Paulo',
        sendWindowStart: '08:00',
        sendWindowEnd: '18:00',
        sendDaysOfWeek: '1,2,3,4,5',
        initialCooldownMinMinutes: '5',
        initialCooldownMaxMinutes: '15',
        followupEnabled: 'on',
        followupAfterHours: '24',
        followupCooldownMinMinutes: '10',
        followupCooldownMaxMinutes: '30',
        dailyInitialSendLimit: '50',
        dailyFollowupSendLimit: '50',
        responseDelayBaseMs: '1200',
        responseDelayPerCharMs: '35',
        responseDelayMaxMs: '12000',
        messageSplitMaxChars: '450',
        humanPauseHours: '24',
        handoffName: 'Fernando',
        handoffPhone: '5511999999999',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(createResponse.statusCode).toBe(302);
    expect(createResponse.headers.location).toBe('/sdr-agents');

    const [createdAgent] = await sdrAgentRepository.list();
    expect(createdAgent?.displayName).toBe('Franciely');
    expect(createdAgent?.companyId).toBe(company.id);
    expect(createdAgent?.followupEnabled).toBe(true);
    expect(createdAgent?.leadQualificationPrompt).toBe('Descartar apenas leads sem empresa estruturada.');

    const listResponse = await app.inject({
      method: 'GET',
      url: '/sdr-agents',
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.body).toContain('Franciely');
    expect(listResponse.body).toContain('Insumo Smart');

    const updateResponse = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${createdAgent?.id}`,
      payload: formPayload({
        companyId: company.id,
        name: 'sdr-insumo-smart-v2',
        displayName: 'Fran',
        leadQualificationPrompt: 'Aceitar domesticas neste SDR.',
        aiProvider: 'openrouter',
        aiModel: 'openai/gpt-4o-mini',
        aiTemperature: '0.5',
        aiMaxOutputTokens: '900',
        timezone: 'America/Sao_Paulo',
        sendWindowStart: '09:00',
        sendWindowEnd: '17:00',
        sendDaysOfWeek: '1,2,3,4,5',
        initialCooldownMinMinutes: '6',
        initialCooldownMaxMinutes: '16',
        followupAfterHours: '36',
        followupCooldownMinMinutes: '11',
        followupCooldownMaxMinutes: '31',
        dailyInitialSendLimit: '40',
        dailyFollowupSendLimit: '20',
        responseDelayBaseMs: '1300',
        responseDelayPerCharMs: '40',
        responseDelayMaxMs: '13000',
        messageSplitMaxChars: '400',
        humanPauseHours: '24',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(updateResponse.statusCode).toBe(302);
    const updatedAgent = createdAgent ? await sdrAgentRepository.findById(createdAgent.id) : null;
    expect(updatedAgent?.displayName).toBe('Fran');
    expect(updatedAgent?.aiProvider).toBe('openrouter');
    expect(updatedAgent?.followupEnabled).toBe(false);
    expect(updatedAgent?.leadQualificationPrompt).toBe('Aceitar domesticas neste SDR.');

    const toggleResponse = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${createdAgent?.id}/toggle`,
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(toggleResponse.statusCode).toBe(302);
    expect((await sdrAgentRepository.findById(createdAgent?.id ?? ''))?.isActive).toBe(true);

    const deleteResponse = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${createdAgent?.id}/delete`,
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(deleteResponse.statusCode).toBe(302);
    expect(await sdrAgentRepository.list()).toHaveLength(0);
  });
});

describe('UAZAPI routes', () => {
  it('tests instance status using saved SDR credentials', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}/uazapi/status`,
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Status UAZAPI');
    expect(response.body).toContain('connected');
    expect(calls).toContain('status:https://api.uazapi.com:instance-token');
  });

  it('sends test message with composing presence first', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}/uazapi/send-test`,
      payload: formPayload({ number: '5511999999999', text: 'Teste do portal' }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      cookies: {
        sdr_portal_session: sessionCookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviar teste UAZAPI');
    expect(calls).toEqual([
      'presence:5511999999999:composing:instance-token',
      'text:5511999999999:Teste do portal:instance-token',
    ]);
  });
});

describe('lead routes and import', () => {
  it('creates, updates and deletes a lead', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });

    app = buildApp({ authRepository: createMemoryAuthRepository([user]), companyRepository, sdrAgentRepository, leadRepository });
    const sessionCookie = await login();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: formPayload({
        companyId: company.id,
        sdrAgentId: agent.id,
        whatsappNumber: '(11) 99999-9999',
        companyName: 'Restaurante Bom Prato',
        segment: 'Restaurante',
        status: 'pending',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(createResponse.statusCode).toBe(302);
    const [createdLead] = await leadRepository.list();
    expect(createdLead?.whatsappNumber).toBe('5511999999999');
    expect(createdLead?.companyName).toBe('Restaurante Bom Prato');

    const listResponse = await app.inject({ method: 'GET', url: '/leads', cookies: { sdr_portal_session: sessionCookie } });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.body).toContain('Restaurante Bom Prato');

    const updateResponse = await app.inject({
      method: 'POST',
      url: `/leads/${createdLead?.id}`,
      payload: formPayload({
        companyId: company.id,
        sdrAgentId: agent.id,
        whatsappNumber: '5511888888888',
        companyName: 'Restaurante Bom Prato LTDA',
        segment: 'Food service',
        status: 'waiting_reply',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(updateResponse.statusCode).toBe(302);
    const updatedLead = createdLead ? await leadRepository.findById(createdLead.id) : null;
    expect(updatedLead?.companyName).toBe('Restaurante Bom Prato LTDA');
    expect(updatedLead?.status).toBe('waiting_reply');

    const deleteResponse = await app.inject({
      method: 'POST',
      url: `/leads/${createdLead?.id}/delete`,
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(deleteResponse.statusCode).toBe(302);
    expect(await leadRepository.list()).toHaveLength(0);
  });

  it('imports leads from Excel rows', async () => {
    const leadRepository = createMemoryLeadRepository();
    const companyId = '56e5c1d4-bdb2-45ff-8cf4-23282a1969e5';
    const sdrAgentId = '59ecb448-9f01-4f65-a728-b925db6ed082';
    const buffer = await writeXlsxFile([
      ['numero_whatsapp', 'CNPJ', 'nome_empresa', 'segmento'],
      ['(11) 99999-9999', '12345678000199', 'Restaurante A', 'Gastronomia'],
      ['11888888888', '12345678000198', 'Restaurante B', 'Food service'],
      ['', '123', 'Sem telefone', 'Teste'],
    ]).toBuffer();

    const result = await importLeadsFromExcel({ buffer, companyId, fileName: 'leads.xlsx', leadRepository, sdrAgentId });
    const leads = await leadRepository.list();

    expect(result.totalRows).toBe(3);
    expect(result.successRows).toBe(2);
    expect(result.errorRows).toBe(1);
    expect(leads).toHaveLength(2);
    expect(leads[0]?.whatsappNumber).toBe('5511999999999');
    expect(leads[0]?.source).toBe('import:leads.xlsx');
  });

  it('imports leads from Excel rows with manual column mapping', async () => {
    const leadRepository = createMemoryLeadRepository();
    const companyId = '56e5c1d4-bdb2-45ff-8cf4-23282a1969e5';
    const sdrAgentId = '59ecb448-9f01-4f65-a728-b925db6ed082';
    const buffer = await writeXlsxFile([
      ['Cliente', 'Fone principal', 'Ramo'],
      ['Mercado Central', '(11) 97777-7777', 'Varejo'],
    ]).toBuffer();

    const result = await importLeadsFromExcel({
      buffer,
      companyId,
      fileName: 'leads-custom.xlsx',
      leadRepository,
      mapping: { companyName: 0, whatsappNumber: 1, segment: 2 },
      sdrAgentId,
    });
    const [lead] = await leadRepository.list();

    expect(result.successRows).toBe(1);
    expect(result.errorRows).toBe(0);
    expect(lead?.companyName).toBe('Mercado Central');
    expect(lead?.whatsappNumber).toBe('5511977777777');
    expect(lead?.segment).toBe('Varejo');
  });

  it('shows a column mapping screen before importing uploaded Excel leads', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });
    const buffer = await writeXlsxFile([
      ['Cliente', 'Fone principal'],
      ['Padaria Centro', '(11) 96666-6666'],
    ]).toBuffer();

    app = buildApp({ authRepository: createMemoryAuthRepository([user]), companyRepository, sdrAgentRepository, leadRepository });
    const sessionCookie = await login();
    const boundary = '----sdrportaltestboundary';
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/leads/import',
      payload: multipartPayload(boundary, [
        { name: 'companyId', value: company.id },
        { name: 'sdrAgentId', value: agent.id },
        { name: 'file', filename: 'leads.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buffer },
      ]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(uploadResponse.statusCode).toBe(200);
    expect(uploadResponse.body).toContain('Mapear colunas');
    expect(uploadResponse.body).toContain('Cliente');
    expect(await leadRepository.list()).toHaveLength(0);

    const token = uploadResponse.body.match(/name="token" value="([^"]+)"/)?.[1];
    expect(token).toBeTruthy();

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/leads/import/confirm',
      payload: formPayload({ token: token ?? '', companyName: '0', whatsappNumber: '1' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { sdr_portal_session: sessionCookie },
    });
    const [lead] = await leadRepository.list();

    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.body).toContain('Importacao concluida');
    expect(lead?.companyName).toBe('Padaria Centro');
    expect(lead?.whatsappNumber).toBe('5511966666666');
  });
});

describe('initial outreach scheduler', () => {
  it('sends the first pending lead message and marks lead as contacted', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const jobLogRepository = createMemoryJobLogRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      firstMessagePrompt: 'Olá {{companyName}}, aqui é {{sdrName}}. Posso fazer uma pergunta rápida?',
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      conversationRepository,
      jobLogRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls, {}, { '5534999969911': '553499969911' }),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const updatedLead = await leadRepository.findById(lead.id);
    const logs = await jobLogRepository.list();
    const conversationsAfterInitial = await conversationRepository.list();
    const initialMessages = conversationsAfterInitial[0]
      ? await conversationRepository.listMessages(conversationsAfterInitial[0].id)
      : [];

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 1');
    expect(updatedLead?.status).toBe('initial_sent');
    expect(updatedLead?.firstMessageSentAt).toBeInstanceOf(Date);
    expect(updatedLead?.followupDueAt).toBeInstanceOf(Date);
    expect(calls).toEqual([
      'check:5534999969911:instance-token',
      'presence:5534999969911:composing:instance-token',
      'text:5534999969911:Olá, tudo bem? Aqui é Franciely. Estava olhando empresas do setor de Gastronomia e encontrei a Restaurante A. Posso te fazer uma pergunta rápida sobre o dia a dia da Restaurante A?:instance-token',
    ]);
    expect(conversationsAfterInitial).toHaveLength(1);
    expect(conversationsAfterInitial[0]?.leadId).toBe(lead.id);
    expect(conversationsAfterInitial[0]?.whatsappNumber).toBe('553499969911');
    expect(initialMessages).toHaveLength(1);
    expect(initialMessages[0]?.leadId).toBe(lead.id);
    expect(initialMessages[0]?.direction).toBe('outbound');
    expect(initialMessages[0]?.senderType).toBe('ai');
    expect(initialMessages[0]?.sentByApi).toBe(true);
    expect(initialMessages[0]?.text).toBe('Olá, tudo bem? Aqui é Franciely. Estava olhando empresas do setor de Gastronomia e encontrei a Restaurante A. Posso te fazer uma pergunta rápida sobre o dia a dia da Restaurante A?');
    expect(logs[0]?.status).toBe('completed');
    expect(logs[0]?.leadId).toBe(lead.id);

    await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'INBOUND-AFTER-INITIAL',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Pode sim',
        },
      },
    });

    const conversationsAfterInbound = await conversationRepository.list();
    const messagesAfterInbound = await conversationRepository.listMessages(conversationsAfterInitial[0]?.id ?? 'missing');
    const leadAfterInbound = await leadRepository.findById(lead.id);

    expect(conversationsAfterInbound).toHaveLength(1);
    expect(updatedLead?.whatsappJid).toBe('553499969911@s.whatsapp.net');
    expect(messagesAfterInbound).toHaveLength(2);
    expect(messagesAfterInbound[1]?.leadId).toBe(lead.id);
    expect(messagesAfterInbound[1]?.direction).toBe('inbound');
    expect(messagesAfterInbound[1]?.text).toBe('Pode sim');
    expect(leadAfterInbound?.status).toBe('in_conversation');
  });

  it('uses lead research in the first message when research is available', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const researchCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const leadResearchRepository = createMemoryLeadResearchRepository();
    const jobLogRepository = createMemoryJobLogRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      firstMessagePrompt: 'Olá {{companyName}}, vi que {{researchSummary}}. Posso te fazer uma pergunta rápida?',
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511888888888',
      companyName: 'Restaurante Pesquisa',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: 'Campinas',
      state: 'SP',
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      jobLogRepository,
      leadResearchProvider: createMockLeadResearchProvider(researchCalls, {
        summary: 'o restaurante abriu uma nova unidade em Campinas',
        sources: ['https://example.com/noticia'],
      }),
      leadResearchRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const research = await leadResearchRepository.findByLeadId(lead.id);

    expect(response.statusCode).toBe(200);
    expect(researchCalls[0]).toContain('Restaurante Pesquisa');
    expect(researchCalls[0]).toContain('Campinas');
    expect(calls).toContain(
      'text:5511888888888:Olá, tudo bem? Aqui é Franciely. Vi que o restaurante abriu uma nova unidade em Campinas. Posso te fazer uma pergunta rápida sobre o dia a dia da Restaurante Pesquisa?:instance-token',
    );
    expect(research?.status).toBe('completed');
    expect(research?.summary).toBe('o restaurante abriu uma nova unidade em Campinas');
    expect(research?.sources).toContain('example.com');
  });

  it('generates the first message with AI when prompt and API key are configured', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const aiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      prompt: 'PROMPT PRINCIPAL PESADO NAO DEVE ENTRAR NA PRIMEIRA MENSAGEM.',
      offerDescription: 'OFERTA LONGA NAO DEVE ENTRAR NA PRIMEIRA MENSAGEM.',
      firstMessagePrompt: 'Use um tom consultivo para {{companyName}}.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511777777777',
      companyName: 'Restaurante IA',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createSequencedMockAiClient(aiCalls, [
        JSON.stringify({ qualified: true, reason: 'Empresa com operacao real.' }),
        '{"mensagem_usuario":"Oi, tudo bem? Vi a Restaurante IA e queria entender a operação de vocês. Posso fazer uma pergunta rápida?","nao_responder":false,"status_sugerido":"initial_sent","actions":[]}',
      ]),
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(aiCalls[0]).toContain('openai:gpt-5.4-mini');
    expect(aiCalls[0]).toContain('web:low');
    expect(aiCalls[1]).toContain('openai:gpt-5.4-mini');
    expect(aiCalls[1]).toContain('web:medium');
    expect(aiCalls[1]).toContain('Voce escreve apenas a primeira mensagem de abordagem para WhatsApp.');
    expect(aiCalls[1]).toContain('Use um tom consultivo para Restaurante IA.');
    expect(aiCalls[1]).not.toContain('Comandos internos disponiveis');
    expect(aiCalls[1]).not.toContain('PROMPT PRINCIPAL PESADO NAO DEVE ENTRAR NA PRIMEIRA MENSAGEM.');
    expect(aiCalls[1]).not.toContain('OFERTA LONGA NAO DEVE ENTRAR NA PRIMEIRA MENSAGEM.');
    expect(calls).toContain(
      'text:5511777777777:Oi, tudo bem? Vi a Restaurante IA e queria entender a operação de vocês. Posso fazer uma pergunta rápida?:instance-token',
    );
    expect(aiRuns.map((run) => run.purpose).sort()).toEqual(['first_message_generation', 'lead_fit_assessment']);
    const firstMessageRun = aiRuns.find((run) => run.purpose === 'first_message_generation');
    expect(firstMessageRun?.leadId).toBe(lead.id);
    expect(firstMessageRun?.error).toBeNull();
  });

  it('uses web search to discard low-fit leads before sending the first message', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const aiCalls: string[] = [];
    const researchCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const leadResearchRepository = createMemoryLeadResearchRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const jobLogRepository = createMemoryJobLogRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      productName: 'Mentoria de Planejamento Estrategico',
      firstMessagePrompt: 'Crie uma abordagem personalizada para {{companyName}}.',
      leadQualificationPrompt: 'Descartar perfis individuais sem operacao empresarial clara.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511555555555',
      companyName: 'Contato Individual',
      cnpj: null,
      tradeName: null,
      segment: 'Servico individual',
      city: 'Leme',
      state: 'SP',
      contactName: 'Maria',
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({ qualified: false, reason: 'Atuacao individual sem operacao empresarial estruturada.' }),
      ),
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      jobLogRepository,
      leadResearchProvider: createMockLeadResearchProvider(researchCalls, null),
      leadResearchRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const updatedLead = await leadRepository.findById(lead.id);
    const logs = await jobLogRepository.list();
    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 0');
    expect(response.body).toContain('Ignoradas: 1');
    expect(updatedLead?.status).toBe('discarded');
    expect(updatedLead?.conversationStage).toBe('discarded');
    expect(updatedLead?.followupDisabledAt).toBeInstanceOf(Date);
    expect(calls).toEqual(['check:5511555555555:instance-token']);
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]).toContain('web:low');
    expect(aiCalls[0]).toContain('lead deve receber abordagem fria');
    expect(aiCalls[0]).toContain('Descartar perfis individuais sem operacao empresarial clara.');
    expect(aiCalls[0]).not.toContain('Crie uma primeira mensagem para este lead.');
    expect(aiRuns[0]?.purpose).toBe('lead_fit_assessment');
    expect(logs[0]?.status).toBe('skipped');
    expect(logs[0]?.result).toContain('Atuacao individual sem operacao empresarial estruturada.');
  });

  it('skips invalid WhatsApp phones and sends to the next pending lead', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const researchCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const jobLogRepository = createMemoryJobLogRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    const invalidLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511444444444',
      companyName: 'Contato Sem WhatsApp',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const validLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511333333333',
      companyName: 'Restaurante Valido',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      jobLogRepository,
      leadResearchProvider: createMockLeadResearchProvider(researchCalls, null),
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls, { [invalidLead.whatsappNumber]: false }),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const invalidUpdated = await leadRepository.findById(invalidLead.id);
    const validUpdated = await leadRepository.findById(validLead.id);
    const logs = await jobLogRepository.list();
    const logByKey = new Map(logs.map((log) => [log.jobKey, log]));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 1');
    expect(response.body).toContain('Ignoradas: 1');
    expect(invalidUpdated?.status).toBe('invalid_phone');
    expect(invalidUpdated?.conversationStage).toBe('discarded');
    expect(invalidUpdated?.followupDisabledAt).toBeInstanceOf(Date);
    expect(validUpdated?.status).toBe('initial_sent');
    expect(validUpdated?.firstMessageSentAt).toBeInstanceOf(Date);
    expect(researchCalls.join('\n')).not.toContain('Contato Sem WhatsApp');
    expect(researchCalls.join('\n')).toContain('Restaurante Valido');
    expect(calls).toEqual([
      'check:5511444444444:instance-token',
      'check:5511333333333:instance-token',
      'presence:5511333333333:composing:instance-token',
      'text:5511333333333:Olá, tudo bem? Aqui é Franciely. Estava olhando empresas do setor de Gastronomia e encontrei a Restaurante Valido. Posso te fazer uma pergunta rápida sobre o dia a dia da Restaurante Valido?:instance-token',
    ]);
    expect(logByKey.get(`invalid-phone-${invalidLead.id}`)?.status).toBe('skipped');
    expect(logByKey.get(`invalid-phone-${invalidLead.id}`)?.result).toContain('phoneExists');
    expect(logByKey.get(`initial-${validLead.id}`)?.status).toBe('completed');
  });

  it('continues to the next lead after a low-fit discard', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const aiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      firstMessagePrompt: 'Crie uma abordagem personalizada para {{companyName}}.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 120,
      initialCooldownMaxMinutes: 120,
      dailyInitialSendLimit: 10,
    });
    const lowFitLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511222222222',
      companyName: 'Contato Individual',
      cnpj: null,
      tradeName: null,
      segment: 'Servico individual',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    const qualifiedLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511111111111',
      companyName: 'Empresa Qualificada',
      cnpj: null,
      tradeName: null,
      segment: 'Industria',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createSequencedMockAiClient(aiCalls, [
        JSON.stringify({ qualified: false, reason: 'Perfil individual sem operacao empresarial.' }),
        JSON.stringify({ qualified: true, reason: 'Empresa com operacao.' }),
        '{"mensagem_usuario":"Oi, vi a Empresa Qualificada e queria entender a operação. Posso fazer uma pergunta rápida?","nao_responder":false,"status_sugerido":"initial_sent","actions":[]}',
      ]),
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const lowFitUpdated = await leadRepository.findById(lowFitLead.id);
    const qualifiedUpdated = await leadRepository.findById(qualifiedLead.id);
    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 1');
    expect(response.body).toContain('Ignoradas: 1');
    expect(lowFitUpdated?.status).toBe('discarded');
    expect(qualifiedUpdated?.status).toBe('initial_sent');
    expect(calls).toEqual([
      'check:5511222222222:instance-token',
      'check:5511111111111:instance-token',
      'presence:5511111111111:composing:instance-token',
      'text:5511111111111:Oi, vi a Empresa Qualificada e queria entender a operação. Posso fazer uma pergunta rápida?:instance-token',
    ]);
    expect(aiCalls).toHaveLength(3);
    expect(aiCalls[0]).toContain('web:low');
    expect(aiCalls[1]).toContain('web:low');
    expect(aiCalls[2]).toContain('web:medium');
    expect(aiRuns.map((run) => run.purpose).sort()).toEqual([
      'first_message_generation',
      'lead_fit_assessment',
      'lead_fit_assessment',
    ]);
  });

  it('falls back to a safe first message when AI generation fails', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      productName: 'Mentoria de Planejamento Estrategico',
      firstMessagePrompt: 'Nao envie este prompt literal.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: 0,
      dailyInitialSendLimit: 10,
    });
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511666666666',
      companyName: 'Restaurante Fallback',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });

    app = buildApp({
      aiClient: {
        async generate() {
          throw new Error('AI provider returned HTTP 400');
        },
      },
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/initial-outreach/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(calls).toContain(
      'text:5511666666666:Olá, tudo bem? Aqui é Franciely. Estava olhando empresas do setor de Gastronomia e encontrei a Restaurante Fallback. Posso te fazer uma pergunta rápida sobre o dia a dia da Restaurante Fallback?:instance-token',
    );
    expect(calls.join('\n')).not.toContain('Nao envie este prompt literal.');
    expect(calls.join('\n')).not.toContain('Mentoria de Planejamento Estrategico');
    expect(aiRuns[0]?.error).toBe('AI provider returned HTTP 400');
  });
});

describe('UAZAPI normalizer', () => {
  it('prefers real phone fields over @lid identifiers', () => {
    const normalized = normalizeUazapiWebhook({
      event: 'messages',
      data: {
        id: 'MSG-LID',
        sender: '137499217248386@lid',
        sender_pn: '553499969911@s.whatsapp.net',
        chatid: '137499217248386@lid',
        fromMe: false,
        type: 'conversation',
        text: 'Oi',
      },
    });

    expect(normalized?.whatsappNumber).toBe('553499969911');
  });
});

describe('follow-up scheduler', () => {
  it('sends one due follow-up and disables future follow-ups for the lead', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const jobLogRepository = createMemoryJobLogRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      followupPrompt: 'Oi {{companyName}}, posso retomar nossa conversa?',
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      followupCooldownMinMinutes: 0,
      followupCooldownMaxMinutes: 0,
      dailyFollowupSendLimit: 10,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    await leadRepository.markInitialSent(lead.id, new Date('2026-05-19T10:00:00.000Z'), new Date('2026-05-19T11:00:00.000Z'));

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      jobLogRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/followup/run',
      cookies: { sdr_portal_session: sessionCookie },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/scheduler/followup/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const updatedLead = await leadRepository.findById(lead.id);
    const logs = await jobLogRepository.list();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 1');
    expect(secondResponse.body).toContain('Enviadas: 0');
    expect(updatedLead?.status).toBe('followup_sent');
    expect(updatedLead?.followupSentAt).toBeInstanceOf(Date);
    expect(updatedLead?.followupDisabledAt).toBeInstanceOf(Date);
    expect(calls).toEqual([
      'presence:5511999999999:composing:instance-token',
      'text:5511999999999:Oi Restaurante A, posso retomar nossa conversa?:instance-token',
    ]);
    expect(logs[0]?.jobName).toBe('followup-outreach');
    expect(logs[0]?.status).toBe('completed');
  });

  it('does not send follow-up when the lead already replied', async () => {
    const user = await createTestUser();
    const calls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      followupCooldownMinMinutes: 0,
      followupCooldownMaxMinutes: 0,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511888888888',
      companyName: 'Restaurante B',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'pending',
      source: 'manual',
    });
    await leadRepository.markInitialSent(lead.id, new Date('2026-05-19T10:00:00.000Z'), new Date('2026-05-19T11:00:00.000Z'));
    await leadRepository.markInboundReceived(lead.id, new Date('2026-05-19T10:30:00.000Z'));

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(calls),
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/scheduler/followup/run',
      cookies: { sdr_portal_session: sessionCookie },
    });

    const updatedLead = await leadRepository.findById(lead.id);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Enviadas: 0');
    expect(updatedLead?.status).toBe('in_conversation');
    expect(updatedLead?.followupSentAt).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('UAZAPI webhook routes', () => {
  it('stores raw webhook, message and updates existing lead conversation', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        instance: 'instancia-1',
        data: {
          id: 'MSG-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Oi, pode falar',
        },
      },
    });

    const events = await webhookEventRepository.list();
    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];
    const updatedLead = await leadRepository.findById(lead.id);

    expect(response.statusCode).toBe(200);
    expect(events[0]?.processingStatus).toBe('processed');
    expect(events[0]?.rawBody).toContain('Oi, pode falar');
    expect(conversations).toHaveLength(1);
    expect(messages[0]?.text).toBe('Oi, pode falar');
    expect(messages[0]?.senderType).toBe('lead');
    expect(updatedLead?.status).toBe('in_conversation');
    expect(updatedLead?.followupDisabledAt).toBeInstanceOf(Date);

    const sessionCookie = await login();
    const conversationsPage = await app.inject({ method: 'GET', url: '/conversations', cookies: { sdr_portal_session: sessionCookie } });
    const webhookLogsPage = await app.inject({ method: 'GET', url: '/webhook-events', cookies: { sdr_portal_session: sessionCookie } });
    expect(conversationsPage.body).toContain('Restaurante A');
    expect(webhookLogsPage.body).toContain('Oi, pode falar');
  });

  it('matches inbound replies by stored UAZAPI JID before number fallback', async () => {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });
    const realLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511888888888',
      whatsappJid: '553499969911@s.whatsapp.net',
      companyName: 'Leley Gelato',
      cnpj: null,
      tradeName: null,
      segment: 'Gelateria',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });
    await leadRepository.markInitialSent(realLead.id, new Date(), null);
    const realConversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: realLead.id,
      whatsappNumber: realLead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });
    const unknownLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '553499969911',
      companyName: '553499969911',
      cnpj: null,
      tradeName: null,
      segment: null,
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'in_conversation',
      source: 'inbound_unknown',
    });
    const unknownConversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: unknownLead.id,
      whatsappNumber: unknownLead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });

    app = buildApp({
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'CANONICAL-REPLY',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Boa tarde. Pode sim',
        },
      },
    });

    const realMessages = await conversationRepository.listMessages(realConversation.id);
    const unknownMessages = await conversationRepository.listMessages(unknownConversation.id);
    const updatedRealLead = await leadRepository.findById(realLead.id);

    expect(response.statusCode).toBe(200);
    expect(realMessages).toHaveLength(1);
    expect(realMessages[0]?.leadId).toBe(realLead.id);
    expect(realMessages[0]?.text).toBe('Boa tarde. Pode sim');
    expect(unknownMessages).toHaveLength(0);
    expect(updatedRealLead?.status).toBe('in_conversation');
  });

  it('prefers the contacted lead over a previous inbound_unknown when matching number variants', async () => {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });
    const contactedLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      companyName: 'Leley Gelato',
      cnpj: null,
      tradeName: null,
      segment: 'Gelateria',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });
    await leadRepository.markInitialSent(contactedLead.id, new Date(), null);
    const contactedConversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: contactedLead.id,
      whatsappNumber: '553499969911',
      status: 'open',
      lastMessageAt: new Date(),
    });
    await waitMs(1);
    const unknownLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '553499969911',
      companyName: '553499969911',
      cnpj: null,
      tradeName: null,
      segment: null,
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'in_conversation',
      source: 'inbound_unknown',
    });
    const unknownConversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: unknownLead.id,
      whatsappNumber: unknownLead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });

    app = buildApp({
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'VARIANT-REPLY',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Boa tarde. Pode sim',
        },
      },
    });

    const contactedMessages = await conversationRepository.listMessages(contactedConversation.id);
    const unknownMessages = await conversationRepository.listMessages(unknownConversation.id);

    expect(response.statusCode).toBe(200);
    expect(contactedMessages).toHaveLength(1);
    expect(contactedMessages[0]?.leadId).toBe(contactedLead.id);
    expect(contactedMessages[0]?.text).toBe('Boa tarde. Pode sim');
    expect(unknownMessages).toHaveLength(0);
  });

  it('creates an inbound unknown lead when the number is not registered', async () => {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });

    app = buildApp({ companyRepository, conversationRepository, leadRepository, sdrAgentRepository, webhookEventRepository });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          key: { remoteJid: '5511888888888@s.whatsapp.net', id: 'MSG-2', fromMe: false },
          message: { conversation: 'Olá, tudo bem?' },
        },
      },
    });

    const leads = await leadRepository.list();
    const conversations = await conversationRepository.list();

    expect(response.statusCode).toBe(200);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.source).toBe('inbound_unknown');
    expect(leads[0]?.whatsappNumber).toBe('5511888888888');
    expect(conversations).toHaveLength(1);
  });

  it('pauses AI when a manual WhatsApp message is sent from the phone', async () => {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      humanPauseHours: 2,
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({ companyRepository, conversationRepository, leadRepository, sdrAgentRepository, webhookEventRepository });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'HUMAN-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: true,
          wasSentByApi: false,
          type: 'conversation',
          text: 'Eu assumo daqui.',
        },
      },
    });

    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];
    const updatedLead = await leadRepository.findById(lead.id);

    expect(response.statusCode).toBe(200);
    expect(messages[0]?.senderType).toBe('human');
    expect(messages[0]?.direction).toBe('outbound');
    expect(updatedLead?.status).toBe('human_paused');
    expect(updatedLead?.aiPauseReason).toBe('manual_whatsapp_message');
    expect(updatedLead?.humanPausedUntil).toBeInstanceOf(Date);
    expect(updatedLead?.humanPausedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not trigger AI while human pause is active', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511777777777',
      companyName: 'Restaurante Pausado',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });
    await leadRepository.markHumanPaused(
      lead.id,
      new Date('2026-05-20T10:00:00.000Z'),
      new Date(Date.now() + 60 * 60 * 1000),
      'manual_whatsapp_message',
    );

    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ mensagem_usuario: 'Nao deve enviar', nao_responder: false, actions: [] })),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'PAUSED-1',
          from: '5511777777777@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Ainda esta ai?',
        },
      },
    });

    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(aiCalls).toEqual([]);
    expect(aiRuns).toEqual([]);
    expect(uazapiCalls).toEqual([]);
  });

  it('triggers AI again after human pause expires', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511666666666',
      companyName: 'Restaurante Expirado',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });
    await leadRepository.markHumanPaused(
      lead.id,
      new Date('2026-05-20T10:00:00.000Z'),
      new Date(Date.now() - 60 * 1000),
      'manual_whatsapp_message',
    );

    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ mensagem_usuario: 'Voltei a responder.', nao_responder: false, actions: [] })),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'EXPIRED-1',
          from: '5511666666666@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Pode continuar?',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(aiCalls[0]).toContain('Pode continuar?');
    expect(uazapiCalls).toContain('text:5511666666666:Voltei a responder.:instance-token');
  });

  it('generates and sends an AI response for inbound messages on active SDRs', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      prompt: 'Responda de forma breve.',
      firstMessagePrompt: 'PROMPT DA PRIMEIRA MENSAGEM NAO DEVE ENTRAR EM RESPOSTAS.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({ mensagem_usuario: 'Claro, posso te fazer uma pergunta rápida?', nao_responder: false, actions: [] }),
      ),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'MSG-IA-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Pode sim',
        },
      },
    });

    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];
    const aiRuns = await aiRunRepository.list();

    expect(response.statusCode).toBe(200);
    expect(aiCalls[0]).toContain('openai:gpt-5.4-mini');
    expect(aiCalls[0]).toContain('web:none');
    expect(aiCalls[0]).toContain('notify_handoff');
    expect(aiCalls[0]).toContain('Responda de forma breve.');
    expect(aiCalls[0]).not.toContain('PROMPT DA PRIMEIRA MENSAGEM NAO DEVE ENTRAR EM RESPOSTAS.');
    expect(uazapiCalls).toContain('text:5511999999999:Claro, posso te fazer uma pergunta rápida?:instance-token');
    expect(aiRuns[0]?.parsedJson).toContain('mensagem_usuario');
    expect(messages.some((message) => message.senderType === 'ai' && message.text === 'Claro, posso te fazer uma pergunta rápida?')).toBe(true);
  });

  it('notifies a human and marks the lead as transferred when AI requests handoff', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      handoffName: 'Gerente',
      handoffPhone: '(11) 98888-7777',
      handoffMessageTemplate: 'Handoff para {{handoffName}}: {{companyName}} / {{whatsappNumber}} / {{summary}}',
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante Handoff',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({
          mensagem_usuario: 'Vou chamar uma pessoa do nosso time para continuar por aqui.',
          nao_responder: false,
          actions: [{ type: 'notify_handoff', summary: 'Lead pediu atendimento humano para negociar valores.' }],
        }),
      ),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'HANDOFF-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Quero falar com uma pessoa.',
        },
      },
    });

    const updatedLead = await leadRepository.findById(lead.id);
    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];

    expect(response.statusCode).toBe(200);
    expect(uazapiCalls).toContain(
      'text:5511999999999:Vou chamar uma pessoa do nosso time para continuar por aqui.:instance-token',
    );
    expect(uazapiCalls).toContain(
      'text:5511988887777:Handoff para Gerente: Restaurante Handoff / 5511999999999 / Lead pediu atendimento humano para negociar valores.:instance-token',
    );
    expect(updatedLead?.status).toBe('transferred');
    expect(updatedLead?.handoffRequestedAt).toBeInstanceOf(Date);
    expect(updatedLead?.handoffSummary).toBe('Lead pediu atendimento humano para negociar valores.');
    expect(updatedLead?.followupDisabledAt).toBeInstanceOf(Date);
    expect(messages.some((message) => message.senderType === 'ai' && message.text === 'Vou chamar uma pessoa do nosso time para continuar por aqui.')).toBe(true);
  });

  it('keeps responding after handoff without notifying the human again', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      handoffName: 'Gerente',
      handoffPhone: '(11) 98888-7777',
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante Handoff',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createSequencedMockAiClient(aiCalls, [
        JSON.stringify({
          mensagem_usuario: 'Vou chamar uma pessoa do nosso time para continuar por aqui.',
          nao_responder: false,
          actions: [{ type: 'notify_handoff', summary: 'Lead pediu atendimento humano.' }],
        }),
        JSON.stringify({
          mensagem_usuario: 'Entendi. Vou continuar por aqui enquanto isso.',
          nao_responder: false,
          actions: [{ type: 'notify_handoff', summary: 'Nao deve notificar de novo.' }],
        }),
      ]),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'HANDOFF-ONCE-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Quero falar com uma pessoa.',
        },
      },
    });

    const secondResponse = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'HANDOFF-ONCE-2',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Pode me explicar melhor?',
        },
      },
    });

    const updatedLead = await leadRepository.findById(lead.id);
    const humanNotifications = uazapiCalls.filter((call) => call.startsWith('text:5511988887777:'));

    expect(secondResponse.statusCode).toBe(200);
    expect(aiCalls).toHaveLength(2);
    expect(updatedLead?.status).toBe('transferred');
    expect(uazapiCalls).toContain('text:5511999999999:Entendi. Vou continuar por aqui enquanto isso.:instance-token');
    expect(humanNotifications).toHaveLength(1);
  });

  it('applies AI actions to update stage and mark not interested', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Lead Sem Interesse',
      cnpj: null,
      tradeName: null,
      segment: 'Servicos',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({
          mensagem_usuario: 'Entendi, obrigado pelo retorno. Fico à disposição se fizer sentido no futuro.',
          nao_responder: false,
          status_sugerido: 'not_interested',
          stage_sugerido: 'not_interested',
          actions: [{ type: 'mark_not_interested' }, { type: 'disable_followup' }],
        }),
      ),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'NO-INTEREST-1',
          from: '5511999999999@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Nao tenho interesse, obrigado.',
        },
      },
    });

    const updatedLead = await leadRepository.findById(lead.id);

    expect(response.statusCode).toBe(200);
    expect(updatedLead?.status).toBe('not_interested');
    expect(updatedLead?.conversationStage).toBe('not_interested');
    expect(updatedLead?.notInterestedAt).toBeInstanceOf(Date);
    expect(updatedLead?.followupDisabledAt).toBeInstanceOf(Date);
    expect(uazapiCalls).toContain(
      'text:5511999999999:Entendi, obrigado pelo retorno. Fico à disposição se fizer sentido no futuro.:instance-token',
    );
  });

  it('buffers inbound messages before responding once', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Lead Buffer',
      cnpj: null,
      tradeName: null,
      segment: 'Servicos',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ mensagem_usuario: 'Resposta unica.', nao_responder: false, actions: [] })),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      inboundResponseBufferMs: 100,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: { event: 'messages', data: { id: 'BUFFER-1', from: '5511999999999@s.whatsapp.net', fromMe: false, type: 'conversation', text: 'Primeira parte' } },
    });
    await waitMs(20);
    await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: { event: 'messages', data: { id: 'BUFFER-2', from: '5511999999999@s.whatsapp.net', fromMe: false, type: 'conversation', text: 'Segunda parte' } },
    });

    await waitMs(50);
    expect(aiCalls).toHaveLength(0);

    await waitMs(80);

    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]).toContain('Primeira parte');
    expect(aiCalls[0]).toContain('Segunda parte');
  });

  it('resets a test conversation with !reset and uses the latest lead afterwards', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      productName: 'Mentoria Presencial em Planejamento Estrategico',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const oldLead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      whatsappJid: '553499969911@s.whatsapp.net',
      whatsappLid: '137499217248386@lid',
      companyName: 'Lead Teste',
      cnpj: '12345678000190',
      tradeName: 'Lead Teste Fantasia',
      segment: 'Servicos',
      city: 'Leme',
      state: 'SP',
      contactName: 'Maria',
      extraData: 'Cliente antigo com dados completos',
      status: 'in_conversation',
      source: 'manual',
    });
    const oldConversation = await conversationRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      leadId: oldLead.id,
      whatsappNumber: oldLead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });
    await conversationRepository.createMessage({
      conversationId: oldConversation.id,
      leadId: oldLead.id,
      sdrAgentId: agent.id,
      direction: 'inbound',
      senderType: 'lead',
      whatsappMessageId: 'OLD-1',
      messageType: 'conversation',
      text: 'Mensagem antiga',
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: false,
      fromMe: false,
    });

    await waitMs(1);
    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ mensagem_usuario: 'Resposta do novo ciclo.', nao_responder: false, actions: [] })),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const resetResponse = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'RESET-1',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: '!reset',
        },
      },
    });

    const latestLead = await leadRepository.findBySdrAndWhatsapp(agent.id, '553499969911');
    const latestConversation = await conversationRepository.findBySdrAndWhatsapp(agent.id, '553499969911');
    const conversations = await conversationRepository.list();

    expect(resetResponse.statusCode).toBe(200);
    expect(latestLead?.id).not.toBe(oldLead.id);
    expect(latestLead?.source).toBe('reset_command');
    expect(latestLead?.companyName).toBe(oldLead.companyName);
    expect(latestLead?.whatsappJid).toBe(oldLead.whatsappJid);
    expect(latestLead?.whatsappLid).toBe(oldLead.whatsappLid);
    expect(latestLead?.tradeName).toBe(oldLead.tradeName);
    expect(latestLead?.cnpj).toBe(oldLead.cnpj);
    expect(latestLead?.segment).toBe(oldLead.segment);
    expect(latestLead?.city).toBe(oldLead.city);
    expect(latestLead?.state).toBe(oldLead.state);
    expect(latestLead?.contactName).toBe(oldLead.contactName);
    expect(latestLead?.extraData).toBe(oldLead.extraData);
    expect(latestLead?.status).toBe('initial_sent');
    expect(latestLead?.conversationStage).toBe('permission');
    expect(latestConversation?.id).not.toBe(oldConversation.id);
    expect(latestConversation?.leadId).toBe(latestLead?.id);
    expect(conversations).toHaveLength(2);
    expect(aiCalls).toHaveLength(0);
    expect(uazapiCalls.some((call) => call.startsWith('text:553499969911:Olá, tudo bem? Aqui é Kyane.'))).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'RESET-2',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Agora vou responder o novo teste',
        },
      },
    });

    const latestMessages = latestConversation ? await conversationRepository.listMessages(latestConversation.id) : [];
    const oldMessages = await conversationRepository.listMessages(oldConversation.id);

    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]).toContain('Agora vou responder o novo teste');
    expect(latestMessages.some((message) => message.text === 'Agora vou responder o novo teste')).toBe(true);
    expect(oldMessages.some((message) => message.text === 'Mensagem antiga')).toBe(true);
    expect(oldMessages.some((message) => message.text === 'Agora vou responder o novo teste')).toBe(false);
  });

  it('does not use the WhatsApp number as company name when reset has no previous lead', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: 'Consultoria',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      productName: 'Mentoria Presencial em Planejamento Estrategico',
      firstMessagePrompt: 'Empresa: {{companyName}}. Fantasia: {{tradeName}}.',
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    app = buildApp({
      aiClient: {
        async generate(input) {
          const webSearch = input.webSearch ? `web:${input.webSearch.searchContextSize ?? 'low'}` : 'web:none';
          aiCalls.push(`${input.provider}:${input.model}:${webSearch}:${input.messages.map((message) => message.content).join('\n---\n')}`);
          throw new Error('AI provider returned HTTP 400');
        },
      },
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'RESET-NO-LEAD',
          from: '553499969911@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: '!reset',
        },
      },
    });

    const latestLead = await leadRepository.findBySdrAndWhatsapp(agent.id, '553499969911');
    const sentCall = uazapiCalls.find((call) => call.startsWith('text:553499969911:')) ?? '';
    const sentText = sentCall.replace(/^text:553499969911:/, '').replace(/:instance-token$/, '');

    expect(response.statusCode).toBe(200);
    expect(latestLead?.companyName).toBe('Lead sem cadastro');
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]).not.toContain('Empresa: 553499969911');
    expect(aiCalls[0]).not.toContain('Empresa lead: 553499969911');
    expect(sentText).toBe('Olá, tudo bem? Aqui é Kyane. Posso te fazer uma pergunta rápida sobre o dia a dia da sua empresa?');
    expect(sentText).not.toContain('553499969911');
    expect(sentText).not.toContain('Mentoria Presencial em Planejamento Estrategico');
  });

  it('transcribes inbound audio before sending it to the AI response flow', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511666666666',
      companyName: 'Restaurante Audio',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({ mensagem_usuario: 'Entendi seu audio.', nao_responder: false, actions: [] }),
      ),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'AUDIO-1',
          chatid: '5511666666666@s.whatsapp.net',
          content: {
            URL: 'https://meta.example/audio.ogg',
            PTT: true,
            mimetype: 'audio/ogg; codecs=opus',
          },
          fromMe: false,
          mediaType: 'audio',
          messageType: 'AudioMessage',
          sender: '123456789@lid',
          sender_pn: '5511666666666@s.whatsapp.net',
          type: 'media',
        },
      },
    });

    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];

    expect(response.statusCode).toBe(200);
    expect(uazapiCalls).toContain('download:AUDIO-1:transcribe:instance-token');
    expect(aiCalls[0]).toContain('Texto transcrito do audio');
    expect(messages.some((message) => message.messageType === 'audio' && message.transcription === 'Texto transcrito do audio')).toBe(true);
  });

  it('stores unsupported media without calling AI when there is no text or transcription', async () => {
    const aiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ mensagem_usuario: 'Nao deveria responder.', nao_responder: false })),
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'STICKER-1',
          chatid: '5511555555555@s.whatsapp.net',
          content: { URL: 'https://meta.example/sticker.webp', mimetype: 'image/webp' },
          fromMe: false,
          messageType: 'StickerMessage',
          sender_pn: '5511555555555@s.whatsapp.net',
          type: 'media',
        },
      },
    });

    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];

    expect(response.statusCode).toBe(200);
    expect(aiCalls).toHaveLength(0);
    expect(messages[0]?.messageType).toBe('media');
  });

  it('splits long AI responses and sends each part with composing presence', async () => {
    const aiCalls: string[] = [];
    const uazapiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const webhookEventRepository = createMemoryWebhookEventRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
      uazapiBaseUrl: 'https://api.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
      messageSplitMaxChars: 40,
      responseDelayBaseMs: 10,
      responseDelayPerCharMs: 2,
      responseDelayMaxMs: 60,
    });
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511777777777',
      companyName: 'Restaurante B',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'initial_sent',
      source: 'manual',
    });

    app = buildApp({
      aiClient: createMockAiClient(
        aiCalls,
        JSON.stringify({
          mensagem_usuario: 'Primeira parte curta. Segunda parte tambem curta.',
          nao_responder: false,
          actions: [],
        }),
      ),
      aiRunRepository,
      companyRepository,
      conversationRepository,
      leadRepository,
      sdrAgentRepository,
      uazapiClient: createMockUazapiClient(uazapiCalls),
      webhookEventRepository,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: {
          id: 'MSG-SPLIT-1',
          from: '5511777777777@s.whatsapp.net',
          fromMe: false,
          type: 'conversation',
          text: 'Pode explicar?',
        },
      },
    });

    const conversations = await conversationRepository.list();
    const messages = conversations[0] ? await conversationRepository.listMessages(conversations[0].id) : [];

    expect(response.statusCode).toBe(200);
    expect(uazapiCalls).toEqual([
      'presence:5511777777777:composing:instance-token',
      'text:5511777777777:Primeira parte curta.:instance-token',
      'presence:5511777777777:composing:instance-token',
      'text:5511777777777:Segunda parte tambem curta.:instance-token',
    ]);
    expect(messages.filter((message) => message.senderType === 'ai').map((message) => message.text)).toEqual([
      'Primeira parte curta.',
      'Segunda parte tambem curta.',
    ]);
  });
});

describe('IA auxiliar de prompt', () => {
  it('renders the prompt assistant form after login', async () => {
    const user = await createTestUser();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();

    await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });

    app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      sdrAgentRepository,
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-assistant',
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('IA auxiliar de prompt');
    expect(response.body).toContain('Selecione um SDR');
  });

  it('generates a prompt via AI with brief and can apply it', async () => {
    const user = await createTestUser();
    const aiCalls: string[] = [];
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'sdr-insumo-smart',
      displayName: 'Franciely',
      isActive: true,
      openaiApiKeyEncrypted: encryptSecret('openai-key'),
    });

    app = buildApp({
      aiClient: createMockAiClient(aiCalls, JSON.stringify({ prompt: 'Voce e um SDR consultivo para restaurantes. Use tom amigavel.' })),
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      sdrAgentRepository,
    });
    const sessionCookie = await login();

    const generateResponse = await app.inject({
      method: 'POST',
      url: '/prompt-assistant/generate',
      cookies: { sdr_portal_session: sessionCookie },
      payload: `sdrAgentId=${agent.id}&briefing=Restaurantes em SP, tom consultivo`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(generateResponse.statusCode).toBe(200);
    expect(generateResponse.body).toContain('Voce e um SDR consultivo');
    expect(generateResponse.body).toContain('Aplicar prompt ao SDR');
    expect(aiCalls[0]).toContain('Restaurantes em SP');
    expect(aiCalls[0]).toContain('(sem prompt)');
    expect(aiCalls[0]).toContain('Nao repita essas regras tecnicas');

    const aiRuns = await aiRunRepository.list();
    expect(aiRuns[0]?.purpose).toBe('prompt_generation');
    expect(aiRuns[0]?.parsedJson).toContain('SDR consultivo');

    const applyResponse = await app.inject({
      method: 'POST',
      url: '/prompt-assistant/apply',
      cookies: { sdr_portal_session: sessionCookie },
      payload: `sdrAgentId=${agent.id}&prompt=${encodeURIComponent('Voce e um SDR consultivo para restaurantes. Use tom amigavel.')}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(applyResponse.statusCode).toBe(302);

    const updatedAgent = await sdrAgentRepository.findById(agent.id);
    expect(updatedAgent?.prompt).toBe('Voce e um SDR consultivo para restaurantes. Use tom amigavel.');
  });
});

describe('telas de diagnostico', () => {
  it('shows AI runs logs page', async () => {
    const user = await createTestUser();
    const aiRunRepository = createMemoryAiRunRepository();

    await aiRunRepository.create({
      sdrAgentId: null,
      leadId: null,
      conversationId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      purpose: 'reply_generation',
      inputMessages: '{}',
      outputText: '{"mensagem_usuario":"Oi"}',
      parsedJson: null,
      error: null,
      promptTokens: 5,
      completionTokens: 10,
      totalTokens: 15,
      latencyMs: 200,
    });

    app = buildApp({ aiRunRepository, authRepository: createMemoryAuthRepository([user]) });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'GET',
      url: '/ai-runs',
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Logs de IA');
    expect(response.body).toContain('reply_generation');
    expect(response.body).toContain('gpt-4o-mini');
    expect(response.body).toContain('5 / 10');
  });

  it('shows job logs page', async () => {
    const user = await createTestUser();
    const jobLogRepository = createMemoryJobLogRepository();

    await jobLogRepository.create({
      jobName: 'initial-outreach',
      jobKey: 'test-key',
      sdrAgentId: null,
      leadId: null,
      status: 'completed',
      attempt: 1,
      payload: '{"number":"5511"}',
      result: '{"ok":true}',
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    app = buildApp({ authRepository: createMemoryAuthRepository([user]), jobLogRepository });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'GET',
      url: '/job-logs',
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Logs de jobs');
    expect(response.body).toContain('initial-outreach');
    expect(response.body).toContain('completed');
  });

  it('shows lead detail page with AI runs and job logs', async () => {
    const user = await createTestUser();
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const aiRunRepository = createMemoryAiRunRepository();
    const jobLogRepository = createMemoryJobLogRepository();

    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'sdr-insumo-smart', displayName: 'Franciely' });
    const lead = await leadRepository.create({
      companyId: company.id,
      sdrAgentId: agent.id,
      whatsappNumber: '5511999999999',
      companyName: 'Restaurante A',
      cnpj: null,
      tradeName: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'in_conversation',
      source: 'manual',
    });

    await aiRunRepository.create({
      sdrAgentId: agent.id,
      leadId: lead.id,
      conversationId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      purpose: 'reply_generation',
      inputMessages: '{}',
      outputText: '{"mensagem_usuario":"Teste"}',
      parsedJson: null,
      error: null,
      promptTokens: 5,
      completionTokens: 10,
      totalTokens: 15,
      latencyMs: 100,
    });

    await jobLogRepository.create({
      jobName: 'initial-outreach',
      jobKey: 'test',
      sdrAgentId: agent.id,
      leadId: lead.id,
      status: 'completed',
      attempt: 1,
      payload: '{}',
      result: null,
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    app = buildApp({
      aiRunRepository,
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      jobLogRepository,
      leadRepository,
      sdrAgentRepository,
    });
    const sessionCookie = await login();

    const response = await app.inject({
      method: 'GET',
      url: `/leads/${lead.id}`,
      cookies: { sdr_portal_session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Restaurante A');
    expect(response.body).toContain('reply_generation');
    expect(response.body).toContain('initial-outreach');
    expect(response.body).toContain('Dados do lead');
    expect(response.body).toContain('Chamadas de IA');
    expect(response.body).toContain('Jobs');
  });
});
