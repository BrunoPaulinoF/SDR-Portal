/**
 * Cada provider tem a sua propria escala de esforco de raciocinio, com nomes e padrao
 * diferentes. O portal guarda o valor cru e resolve na hora da chamada, para nunca
 * mandar um nivel que o provider nao conhece.
 *
 * - DeepSeek: low | high | max, padrao high (thinking ligado por padrao).
 * - OpenAI: minimal | low | medium | high nos modelos GPT-5; xhigh e max so nos mais novos.
 * - OpenRouter: repassa a escala do modelo de destino, incluindo none.
 */

/** Guardado quando o usuario nao escolhe nada: o parametro nao e enviado e vale o padrao do provider. */
export const providerDefaultEffort = 'default';

export interface ReasoningEffortOption {
  value: string;
  label: string;
}

interface ProviderEfforts {
  options: ReasoningEffortOption[];
}

const defaultOption: ReasoningEffortOption = { value: providerDefaultEffort, label: 'Padrao do modelo' };

const catalog: Record<string, ProviderEfforts> = {
  deepseek: {
    options: [
      defaultOption,
      { value: 'low', label: 'low - mais rapido e barato' },
      { value: 'high', label: 'high - padrao do DeepSeek' },
      { value: 'max', label: 'max - so para tarefa complexa' },
    ],
  },
  openai: {
    options: [
      defaultOption,
      { value: 'minimal', label: 'minimal - quase sem raciocinio' },
      { value: 'low', label: 'low' },
      { value: 'medium', label: 'medium - padrao da OpenAI' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh - so em modelos 5.6+' },
      { value: 'max', label: 'max - so em modelos 5.6+' },
    ],
  },
  openrouter: {
    options: [
      defaultOption,
      { value: 'none', label: 'none - desliga o raciocinio' },
      { value: 'minimal', label: 'minimal' },
      { value: 'low', label: 'low' },
      { value: 'medium', label: 'medium - padrao do OpenRouter' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
      { value: 'max', label: 'max' },
    ],
  },
};

export function reasoningEffortOptions(provider: string): ReasoningEffortOption[] {
  return catalog[provider]?.options ?? [defaultOption];
}

export function isReasoningEffortValidFor(provider: string, value: string): boolean {
  return reasoningEffortOptions(provider).some((option) => option.value === value);
}

/** Todos os valores aceitos por qualquer provider, para validar o formulario. */
export function allReasoningEffortValues(): string[] {
  const values = new Set<string>([providerDefaultEffort]);
  for (const provider of Object.values(catalog)) {
    for (const option of provider.options) values.add(option.value);
  }
  return [...values];
}

/**
 * Nivel a enviar ao provider, ou `null` quando o parametro nao deve ir na requisicao —
 * seja porque o usuario escolheu o padrao do modelo, seja porque o valor salvo nao
 * existe na escala do provider selecionado (ex.: trocaram de OpenAI para DeepSeek).
 */
export function resolveReasoningEffort(provider: string, value: string | null | undefined): string | null {
  if (!value || value === providerDefaultEffort) return null;
  return isReasoningEffortValidFor(provider, value) ? value : null;
}

/** Catalogo em JSON para o formulario trocar as opcoes quando muda o provider. */
export function reasoningEffortCatalogJson(): string {
  return JSON.stringify(Object.fromEntries(Object.entries(catalog).map(([provider, { options }]) => [provider, options])));
}
