import { z } from 'zod';

const aiResponseSchema = z.object({
  mensagem_usuario: z.string().default(''),
  nao_responder: z.boolean().default(false),
  status_sugerido: z.string().optional(),
  actions: z.array(z.union([z.string(), z.object({ type: z.string(), summary: z.string().optional() }).passthrough()])).default([]),
});

export type ParsedAiResponse = z.infer<typeof aiResponseSchema>;

export function parseAiResponse(outputText: string): ParsedAiResponse {
  const trimmed = outputText.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;
  return aiResponseSchema.parse(JSON.parse(jsonText));
}
