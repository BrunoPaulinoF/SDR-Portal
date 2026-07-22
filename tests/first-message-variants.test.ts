import { describe, expect, it } from 'vitest';

import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { resolveFirstMessage } from '../src/modules/scheduler/initial-outreach.js';
import type { SdrAgent } from '../src/db/schema.js';

const aiClientThatMustNotRun: AiClient = {
  async generate() {
    throw new Error('AI client should not be called in A/B fixed mode');
  },
};

async function makeAgent(overrides: Partial<SdrAgent> = {}): Promise<SdrAgent> {
  const repo = createMemorySdrAgentRepository();
  const agent = await repo.create({ companyId: 'company-1', name: 'Mariana', displayName: 'Mariana' });
  return { ...agent, ...overrides };
}

describe('first message A/B variants', () => {
  it('distributes picks evenly across active variants (round-robin)', async () => {
    const repo = createMemoryFirstMessageVariantRepository();
    const a = await repo.create({ sdrAgentId: 'sdr-1', label: 'A', body: 'msg A', sortOrder: 0 });
    const b = await repo.create({ sdrAgentId: 'sdr-1', label: 'B', body: 'msg B', sortOrder: 1 });
    const c = await repo.create({ sdrAgentId: 'sdr-1', label: 'C', body: 'msg C', sortOrder: 2 });

    const counts: Record<string, number> = { [a.id]: 0, [b.id]: 0, [c.id]: 0 };
    for (let i = 0; i < 9; i += 1) {
      const picked = await repo.pickNextForAgent('sdr-1');
      expect(picked).not.toBeNull();
      counts[picked!.id] += 1;
    }

    expect(counts[a.id]).toBe(3);
    expect(counts[b.id]).toBe(3);
    expect(counts[c.id]).toBe(3);
  });

  it('skips paused variants when picking', async () => {
    const repo = createMemoryFirstMessageVariantRepository();
    const a = await repo.create({ sdrAgentId: 'sdr-1', label: 'A', body: 'msg A' });
    await repo.create({ sdrAgentId: 'sdr-1', label: 'B', body: 'msg B', isActive: false });

    for (let i = 0; i < 3; i += 1) {
      const picked = await repo.pickNextForAgent('sdr-1');
      expect(picked!.id).toBe(a.id);
    }
  });

  it('resolveFirstMessage in ab_test mode uses a fixed variant and interpolates placeholders', async () => {
    const variantRepo = createMemoryFirstMessageVariantRepository();
    await variantRepo.create({
      sdrAgentId: 'sdr-1',
      label: 'A',
      body: 'Boa tarde, {{nome}}! Falo do {{restaurante}}.',
    });
    const agent = await makeAgent({ id: 'sdr-1', firstMessageMode: 'ab_test' });
    const leadRepo = createMemoryLeadRepository();
    const lead = await leadRepo.create({
      companyId: 'company-1',
      sdrAgentId: 'sdr-1',
      whatsappNumber: '5519999999999',
      companyName: 'Bruno ME',
      tradeName: 'Leley Gelato',
      contactName: null,
      status: 'pending',
      source: 'manual',
    });

    const { text, variantId } = await resolveFirstMessage(
      { aiClient: aiClientThatMustNotRun, aiRunRepository: createMemoryAiRunRepository(), firstMessageVariantRepository: variantRepo },
      agent,
      lead,
      null,
    );

    expect(variantId).not.toBeNull();
    expect(text).toBe('Boa tarde! Falo do Leley Gelato.');
  });

  it('resolveFirstMessage in ai mode returns no variant id', async () => {
    const variantRepo = createMemoryFirstMessageVariantRepository();
    const agent = await makeAgent({ id: 'sdr-1', firstMessageMode: 'ai', firstMessagePrompt: null });
    const leadRepo = createMemoryLeadRepository();
    const lead = await leadRepo.create({
      companyId: 'company-1',
      sdrAgentId: 'sdr-1',
      whatsappNumber: '5519999999999',
      companyName: 'Bruno ME',
      status: 'pending',
      source: 'manual',
    });

    const { variantId } = await resolveFirstMessage(
      { aiClient: aiClientThatMustNotRun, aiRunRepository: createMemoryAiRunRepository(), firstMessageVariantRepository: variantRepo },
      agent,
      lead,
      null,
    );

    expect(variantId).toBeNull();
  });
});
