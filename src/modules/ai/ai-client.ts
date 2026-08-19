import { env } from '../../config/env.js';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiWebSearchOptions {
  searchContextSize?: 'low' | 'medium' | 'high';
  userLocation?: {
    city?: string;
    country?: string;
    region?: string;
    timezone?: string;
  };
}

export type AiReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export const aiReasoningEfforts: readonly AiReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export function isAiReasoningEffort(value: string): value is AiReasoningEffort {
  return (aiReasoningEfforts as readonly string[]).includes(value);
}

export interface AiGenerateInput {
  apiKey: string;
  maxTokens: number;
  messages: AiChatMessage[];
  model: string;
  provider: string;
  /** So tem efeito em modelo reasoning da OpenAI; os demais providers ignoram. */
  reasoningEffort?: AiReasoningEffort;
  temperature: number;
  webSearch?: AiWebSearchOptions;
}

export interface AiGenerateResult {
  outputText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
}

export interface AiClient {
  generate(input: AiGenerateInput): Promise<AiGenerateResult>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; type?: string; code?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface ResponsesApiResponse {
  error?: { message?: string; type?: string; code?: string };
  incomplete_details?: { reason?: string };
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  status?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

type AiProviderResponse = ChatCompletionResponse & ResponsesApiResponse;

async function readResponseBody(response: Response): Promise<AiProviderResponse> {
  try {
    return (await response.json()) as AiProviderResponse;
  } catch {
    return {};
  }
}

function isOpenAiReasoningModel(provider: string, model: string): boolean {
  return provider === 'openai' && (/^gpt-5/i.test(model) || /^o\d/i.test(model));
}

function endpointFor(provider: string, model: string): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  if (provider === 'deepseek') return 'https://api.deepseek.com/chat/completions';
  if (isOpenAiReasoningModel(provider, model)) return 'https://api.openai.com/v1/responses';
  return 'https://api.openai.com/v1/chat/completions';
}

function webSearchTool(input: AiGenerateInput): Record<string, unknown> | null {
  if (!input.webSearch || !isOpenAiReasoningModel(input.provider, input.model)) return null;

  const tool: Record<string, unknown> = {
    type: 'web_search',
    search_context_size: input.webSearch.searchContextSize ?? 'low',
  };

  if (input.webSearch.userLocation) {
    tool.user_location = {
      type: 'approximate',
      ...input.webSearch.userLocation,
    };
  }

  return tool;
}

function buildRequestBody(input: AiGenerateInput): Record<string, unknown> {
  if (isOpenAiReasoningModel(input.provider, input.model)) {
    const tool = webSearchTool(input);
    return {
      model: input.model,
      input: input.messages,
      reasoning: { effort: input.reasoningEffort ?? 'low' },
      max_output_tokens: Math.max(input.maxTokens, 2000),
      ...(tool ? { tools: [tool], tool_choice: 'auto' } : {}),
      ...(tool ? {} : { text: { format: { type: 'json_object' } } }),
    };
  }

  return {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    response_format: { type: 'json_object' },
  };
}

function outputTextFromResponsesApi(body: ResponsesApiResponse): string {
  if (typeof body.output_text === 'string') return body.output_text;

  return (body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
}

function resultFromResponse(input: AiGenerateInput, body: AiProviderResponse): AiGenerateResult {
  if (isOpenAiReasoningModel(input.provider, input.model)) {
    const outputText = outputTextFromResponsesApi(body);
    if (!outputText && body.status === 'incomplete') {
      throw new Error(`AI provider response incomplete: ${body.incomplete_details?.reason ?? 'unknown reason'}`);
    }

    return {
      outputText,
      promptTokens: body.usage?.input_tokens ?? null,
      completionTokens: body.usage?.output_tokens ?? null,
      totalTokens: body.usage?.total_tokens ?? null,
      promptCacheHitTokens: null,
    };
  }

  return {
    outputText: body.choices?.[0]?.message?.content ?? '',
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
    totalTokens: body.usage?.total_tokens ?? null,
    promptCacheHitTokens: body.usage?.prompt_cache_hit_tokens ?? body.usage?.prompt_tokens_details?.cached_tokens ?? null,
  };
}

export function createHttpAiClient(): AiClient {
  return {
    async generate(input) {
      // Sem timeout, um provedor pendurado segura o tick do scheduler ate o processo morrer.
      const response = await fetch(endpointFor(input.provider, input.model), {
        method: 'POST',
        signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
          ...(input.provider === 'openrouter' ? { 'HTTP-Referer': 'https://sdr-portal.local', 'X-Title': 'SDR Portal' } : {}),
        },
        body: JSON.stringify(buildRequestBody(input)),
      });

      const body = await readResponseBody(response);
      if (!response.ok) {
        const detail = body.error?.message ? `: ${body.error.message}` : '';
        throw new Error(`AI provider returned HTTP ${response.status}${detail}`);
      }

      return resultFromResponse(input, body);
    },
  };
}
