import { z } from 'zod';

/**
 * O modelo escreve `null` onde nao tem sugestao a dar, em vez de omitir a chave — para ele
 * as duas coisas sao a mesma. Se o schema recusar, a resposta inteira e descartada e o lead
 * fica sem mensagem por causa de um campo opcional. Entao `null` vira ausencia, em todo campo.
 */
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const aiResponseSchema = z.object({
  mensagem_usuario: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  nao_responder: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  status_sugerido: optionalText,
  stage_sugerido: optionalText,
  actions: z
    .array(z.union([z.string(), z.object({ type: z.string(), summary: z.string().optional() }).passthrough()]))
    .nullish()
    .transform((value) => value ?? []),
});

export type ParsedAiResponse = z.infer<typeof aiResponseSchema>;

export function parseAiResponse(outputText: string): ParsedAiResponse {
  const trimmed = outputText.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;
  return aiResponseSchema.parse(JSON.parse(jsonText));
}
