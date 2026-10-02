import { env } from '../../config/env.js';
import type { Conversation, Lead, SdrAgent } from '../../db/schema.js';
import { whatsappDestination } from '../phone/whatsapp-number.js';
import { decryptSecret } from '../security/secrets.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import { tradeBusinessName } from './lead-display-name.js';

/**
 * Texto do aviso de "a IA parou nesta conversa". Vai para o WhatsApp de handoff do SDR, o mesmo
 * que recebe o lead pronto: quem atende o lead e quem precisa olhar a foto.
 */
export function aiPauseNoticeText(agent: SdrAgent, lead: Lead, conversation: Conversation): string {
  const name = tradeBusinessName(lead) || lead.companyName;
  const portal = env.APP_URL ? env.APP_URL.replace(/\/+$/, '') : '';
  const link = portal ? `\n${portal}/conversations?sdr=${agent.id}&chat=${conversation.id}` : '';
  return [
    `A IA da ${agent.displayName} parou na conversa com ${name} (${lead.whatsappNumber}).`,
    'O lead mandou uma foto e a IA nao enxerga imagem: responda pelo WhatsApp do SDR ou libere a IA no portal.',
  ].join('\n') + link;
}

/**
 * Avisa que a IA pausou numa conversa com gente. Devolve o motivo quando nao deu para avisar
 * (SDR sem WhatsApp de handoff, UAZAPI recusou), para quem chama registrar; `null` = avisado.
 *
 * Sem este aviso a pausa por foto era silenciosa: o lead ficava esperando e ninguem sabia.
 */
export async function sendAiPauseNotice(
  uazapiClient: UazapiClient,
  agent: SdrAgent,
  lead: Lead,
  conversation: Conversation,
): Promise<string | null> {
  if (!agent.handoffPhone?.trim()) return 'SDR sem WhatsApp de handoff cadastrado';
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return 'SDR sem instancia UAZAPI';

  try {
    const result = await uazapiClient.sendText({
      baseUrl: agent.uazapiBaseUrl,
      token: decryptSecret(agent.uazapiInstanceTokenEncrypted),
      number: whatsappDestination(agent.handoffPhone),
      text: aiPauseNoticeText(agent, lead, conversation),
      readchat: true,
      trackSource: 'sdr-portal-ai-pause',
      trackId: `ai-pause-${lead.id}`,
    });
    return result.ok ? null : `UAZAPI respondeu HTTP ${result.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Erro desconhecido ao avisar a pausa';
  }
}
