import { describe, expect, it } from 'vitest';

import { AI_PAUSE_REASONS, followupDisabledAfterAiResume } from '../src/modules/leads/ai-pause.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';

async function leadInConversation() {
  const repository = createMemoryLeadRepository();
  const lead = await repository.create({
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber: '5519999990000',
    companyName: 'Sabor Divino',
    status: 'in_conversation',
    source: 'manual',
  });
  return { lead, repository };
}

describe('liberar a IA depois da pausa', () => {
  it('religa o follow-up que a propria pausa desligou', async () => {
    const { lead, repository } = await leadInConversation();
    await repository.pauseAi(lead.id, new Date('2026-09-28T12:00:00Z'), AI_PAUSE_REASONS.leadImage);

    const resumed = await repository.resumeAi(lead.id, new Date('2026-09-29T12:00:00Z'));

    expect(resumed?.followupDisabledAt).toBeNull();
    expect(resumed?.aiPausedAt).toBeNull();
  });

  it('mantem desligado o follow-up que ja estava desligado antes da pausa', async () => {
    const { lead, repository } = await leadInConversation();
    const recusa = new Date('2026-09-20T12:00:00Z');
    await repository.disableFollowup(lead.id, recusa);
    await repository.pauseAi(lead.id, new Date('2026-09-28T12:00:00Z'), AI_PAUSE_REASONS.portal);

    const resumed = await repository.resumeAi(lead.id, new Date('2026-09-29T12:00:00Z'));

    expect(resumed?.followupDisabledAt).toEqual(recusa);
  });

  it('nao inventa data quando nao havia pausa', () => {
    expect(followupDisabledAfterAiResume({ aiPausedAt: null, followupDisabledAt: null })).toBeNull();
  });
});
