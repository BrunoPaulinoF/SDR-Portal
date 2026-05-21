export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiGenerateInput {
  apiKey: string;
  maxTokens: number;
  messages: AiChatMessage[];
  model: string;
  provider: string;
  temperature: number;
}

export interface AiGenerateResult {
  outputText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiClient {
  generate(input: AiGenerateInput): Promise<AiGenerateResult>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; type?: string; code?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function readResponseBody(response: Response): Promise<ChatCompletionResponse> {
  try {
    return (await response.json()) as ChatCompletionResponse;
  } catch {
    return {};
  }
}

function endpointFor(provider: string): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  return 'https://api.openai.com/v1/chat/completions';
}

export function createHttpAiClient(): AiClient {
  return {
    async generate(input) {
      const response = await fetch(endpointFor(input.provider), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
          ...(input.provider === 'openrouter' ? { 'HTTP-Referer': 'https://sdr-portal.local', 'X-Title': 'SDR Portal' } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          response_format: { type: 'json_object' },
        }),
      });

      const body = await readResponseBody(response);
      if (!response.ok) {
        const detail = body.error?.message ? `: ${body.error.message}` : '';
        throw new Error(`AI provider returned HTTP ${response.status}${detail}`);
      }

      return {
        outputText: body.choices?.[0]?.message?.content ?? '',
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
        totalTokens: body.usage?.total_tokens ?? null,
      };
    },
  };
}
