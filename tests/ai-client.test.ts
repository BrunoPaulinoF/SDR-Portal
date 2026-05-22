import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpAiClient } from '../src/modules/ai/ai-client.js';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

const baseInput = {
  apiKey: 'test-key',
  maxTokens: 800,
  messages: [
    { role: 'system' as const, content: 'Responda apenas JSON.' },
    { role: 'user' as const, content: 'Oi' },
  ],
  provider: 'openai',
  temperature: 0.4,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP AI client', () => {
  it('uses Chat Completions payload for regular OpenAI models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: '{"mensagem_usuario":"Oi","nao_responder":false}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHttpAiClient().generate({ ...baseInput, model: 'gpt-4o-mini' });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;

    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body.max_tokens).toBe(800);
    expect(body.temperature).toBe(0.4);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(result.outputText).toContain('mensagem_usuario');
    expect(result.promptTokens).toBe(11);
  });

  it('uses Responses API without exposing reasoning fields for OpenAI reasoning models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        output_text: '{"mensagem_usuario":"Oi com reasoning","nao_responder":false,"actions":[]}',
        status: 'completed',
        usage: { input_tokens: 12, output_tokens: 9, total_tokens: 21 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHttpAiClient().generate({ ...baseInput, model: 'gpt-5.4-mini' });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;

    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.input).toEqual(baseInput.messages);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.max_output_tokens).toBe(2000);
    expect(body.text).toEqual({ format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('include');
    expect(result.outputText).toContain('Oi com reasoning');
    expect(result.promptTokens).toBe(12);
    expect(result.completionTokens).toBe(9);
  });

  it('enables Responses API web search when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        output_text: '{"mensagem_usuario":"Oi com pesquisa","nao_responder":false,"actions":[]}',
        status: 'completed',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createHttpAiClient().generate({
      ...baseInput,
      model: 'gpt-5.4-mini',
      webSearch: { searchContextSize: 'medium', userLocation: { country: 'BR' } },
    });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;

    expect(body.tools).toEqual([
      {
        type: 'web_search',
        search_context_size: 'medium',
        user_location: { type: 'approximate', country: 'BR' },
      },
    ]);
    expect(body.tool_choice).toBe('auto');
  });

  it('keeps Chat Completions payload for OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ choices: [{ message: { content: '{"mensagem_usuario":"Oi","nao_responder":false}' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createHttpAiClient().generate({ ...baseInput, model: 'gpt-5.4-mini', provider: 'openrouter' });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    const headers = request.headers as Record<string, string>;

    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(body.max_tokens).toBe(800);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(headers['HTTP-Referer']).toBe('https://sdr-portal.local');
  });

  it('surfaces detailed provider errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ error: { message: "Unsupported parameter: 'max_tokens'" } }, 400),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHttpAiClient().generate({ ...baseInput, model: 'gpt-4o-mini' })).rejects.toThrow(
      "AI provider returned HTTP 400: Unsupported parameter: 'max_tokens'",
    );
  });
});
