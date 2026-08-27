import { describe, expect, it } from 'vitest';

import type { JobLog } from '../src/db/schema.js';
import { renderJobLogsPage } from '../src/modules/jobs/job-log-pages.js';

function log(overrides: Partial<JobLog> = {}): JobLog {
  return {
    id: 'log-1',
    jobName: 'initial-outreach',
    jobKey: 'agent-1',
    sdrAgentId: 'sdr-1',
    leadId: 'lead-1',
    status: 'failed',
    attempt: 1,
    payload: JSON.stringify({ agentId: 'sdr-1' }),
    result: null,
    error: 'UAZAPI returned HTTP 500',
    startedAt: new Date('2026-08-27T18:27:00.000Z'),
    finishedAt: new Date('2026-08-27T18:27:01.000Z'),
    createdAt: new Date('2026-08-27T18:27:01.000Z'),
    ...overrides,
  };
}

/**
 * A coluna mostrava `payload ?? result`, entao a linha que tinha os dois so exibia o payload.
 * Em 27/08 isso escondeu o corpo do HTTP 500 que explicava o disparo travado — a resposta da
 * UAZAPI estava gravada no banco e invisivel na tela.
 */
describe('job logs mostram payload e resultado', () => {
  it('exibe a resposta da UAZAPI quando a linha tem payload e resultado', () => {
    const html = renderJobLogsPage([
      log({ result: JSON.stringify({ uazapiStatus: 500, uazapi: { error: 'chat not found' } }) }),
    ]);

    expect(html).toContain('agentId');
    expect(html).toContain('chat not found');
  });

  it('continua legivel quando so um dos dois existe', () => {
    expect(renderJobLogsPage([log()])).toContain('agentId');
    expect(renderJobLogsPage([log({ payload: null, result: '{"ok":true}' })])).toContain('ok');
  });
});
