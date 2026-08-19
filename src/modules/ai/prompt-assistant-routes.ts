import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SdrAgent } from '../../db/schema.js';
import type { AiClient } from '../ai/ai-client.js';
import { resolveReasoningEffort } from '../ai/reasoning-effort.js';
import type { AiRunRepository } from '../ai/ai-run-repository.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { requireUser } from '../auth/access.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { renderPromptAssistantFormPage } from './prompt-assistant-pages.js';
import { resolveAiApiKey } from './resolve-api-key.js';

/** Resolve o nivel salvo para a escala do provider deste SDR; `null` omite o parametro. */
function reasoningEffortOf(agent: Pick<SdrAgent, 'aiProvider' | 'aiReasoningEffort'>): string | null {
  return resolveReasoningEffort(agent.aiProvider, agent.aiReasoningEffort);
}


const generateSchema = z.object({
  sdrAgentId: z.string().uuid(),
  briefing: z.string().trim().min(10).max(5000),
});

const applySchema = z.object({
  sdrAgentId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(10000),
});

function systemPrompt(): string {
  return `Voce e um especialista em criar prompts para agentes SDR que atuam via WhatsApp.
O usuario vai fornecer um briefing descrevendo o que o SDR precisa fazer (produto, publico, tom, regras, etc).
Com base nesse briefing, voce deve gerar apenas o prompt editavel do SDR, claro, objetivo e pronto para uso em producao.
Retorne APENAS um JSON estrito no formato: {"prompt":"texto completo do prompt"}.
O sistema ja possui instrucoes fixas nao editaveis sobre JSON, seguranca, comandos internos, handoff, nao_responder e uso de transcricoes de audio. Nao repita essas regras tecnicas no prompt gerado.
O prompt gerado deve:
- Definir com clareza o papel do SDR, o produto/servico, o publico-alvo e o tom de voz.
- Incluir regras claras de conduta (o que fazer e o que nao fazer).
- Complementar as instrucoes fixas do sistema com contexto comercial especifico.
- Usar pt-BR, frases curtas e diretas.
- Ter entre 300 e 2000 caracteres.`;
}

function parsePromptJson(outputText: string): string | null {
  try {
    const trimmed = outputText.trim();
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;
    const parsed = JSON.parse(jsonText) as { prompt?: string };
    return typeof parsed.prompt === 'string' && parsed.prompt.trim() ? parsed.prompt.trim() : null;
  } catch {
    return null;
  }
}

export function registerPromptAssistantRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  aiClient: AiClient,
  aiRunRepository: AiRunRepository,
): void {
  app.get('/prompt-assistant', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const agents = await sdrAgentRepository.list();
    return reply.type('text/html').send(renderPromptAssistantFormPage(agents));
  });

  app.post('/prompt-assistant/generate', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      const agents = await sdrAgentRepository.list();
      const body = request.body as { sdrAgentId?: string; briefing?: string } | undefined;
      return reply
        .status(400)
        .type('text/html')
        .send(renderPromptAssistantFormPage(agents, body?.sdrAgentId, body?.briefing, undefined, 'Preencha SDR e briefing (minimo 10 caracteres).'));
    }

    const agent = await sdrAgentRepository.findById(parsed.data.sdrAgentId);
    if (!agent) {
      const agents = await sdrAgentRepository.list();
      return reply.status(404).type('text/html').send(renderPromptAssistantFormPage(agents, undefined, parsed.data.briefing, undefined, 'SDR nao encontrado.'));
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt() },
      { role: 'user' as const, content: `Briefing:\n${parsed.data.briefing}\n\nPrompt atual do SDR (use como referencia para melhoria ou substituicao):\n${agent.prompt ?? '(sem prompt)'}` },
    ];
    const startedAt = Date.now();

    try {
      const apiKey = resolveAiApiKey(agent);

      if (!apiKey) {
        const agentsList = await sdrAgentRepository.list();
        return reply
          .status(400)
          .type('text/html')
          .send(
            renderPromptAssistantFormPage(
              agentsList,
              agent.id,
              parsed.data.briefing,
              undefined,
              `Configure uma chave ${agent.aiProvider} no SDR ou no ambiente para gerar o prompt.`,
            ),
          );
      }

      const aiResult = await aiClient.generate({
        apiKey,
        maxTokens: agent.aiMaxOutputTokens,
        messages,
        model: agent.aiModel,
        provider: agent.aiProvider,
        reasoningEffort: reasoningEffortOf(agent),
        temperature: agent.aiTemperature,
      });

      const prompt = parsePromptJson(aiResult.outputText);
      await aiRunRepository.create({
        sdrAgentId: agent.id,
        leadId: null,
        conversationId: null,
        provider: agent.aiProvider,
        model: agent.aiModel,
        purpose: 'prompt_generation',
        inputMessages: JSON.stringify(messages),
        outputText: aiResult.outputText,
        parsedJson: prompt ? JSON.stringify({ prompt }) : null,
        error: null,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        totalTokens: aiResult.totalTokens,
        promptCacheHitTokens: aiResult.promptCacheHitTokens,
        latencyMs: Date.now() - startedAt,
      });

      if (!prompt) {
        const agentsList = await sdrAgentRepository.list();
        return reply
          .status(400)
          .type('text/html')
          .send(
            renderPromptAssistantFormPage(
              agentsList,
              agent.id,
              parsed.data.briefing,
              undefined,
              'A IA nao gerou um prompt valido. Tente um briefing mais detalhado.',
            ),
          );
      }

      const agentsList = await sdrAgentRepository.list();
      return reply
        .type('text/html')
        .send(renderPromptAssistantFormPage(agentsList, agent.id, parsed.data.briefing, prompt));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      await aiRunRepository.create({
        sdrAgentId: agent.id,
        leadId: null,
        conversationId: null,
        provider: agent.aiProvider,
        model: agent.aiModel,
        purpose: 'prompt_generation',
        inputMessages: JSON.stringify(messages),
        outputText: null,
        parsedJson: null,
        error: message,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        promptCacheHitTokens: null,
        latencyMs: Date.now() - startedAt,
      });

      const agentsList = await sdrAgentRepository.list();
      return reply
        .status(500)
        .type('text/html')
        .send(renderPromptAssistantFormPage(agentsList, agent.id, parsed.data.briefing, undefined, `Erro ao gerar prompt: ${message}`));
    }
  });

  app.post('/prompt-assistant/apply', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Dados invalidos' });
    }

    const agent = await sdrAgentRepository.findById(parsed.data.sdrAgentId);
    if (!agent) {
      return reply.status(404).send({ ok: false, error: 'SDR nao encontrado' });
    }

    await sdrAgentRepository.update(agent.id, {
      companyId: agent.companyId,
      name: agent.name,
      displayName: agent.displayName,
      prompt: parsed.data.prompt,
    });

    return reply.redirect('/prompt-assistant');
  });
}
