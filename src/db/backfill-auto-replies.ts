import { and, eq, inArray, sql } from 'drizzle-orm';

import { closeDb, db } from './client.js';
import { leads, messages, sdrAgents, type Message } from './schema.js';
import { isStoreAutoReply } from '../modules/conversations/store-auto-reply.js';

/**
 * Marca como automatica da loja as mensagens recebidas ANTES do filtro existir e devolve ao
 * funil os leads que so tinham robo do outro lado.
 *
 * Por que precisa existir: `messages.auto_reply` nasceu em 02/09 e vale so para o que chegou
 * depois. Tudo que veio antes esta gravado como se fosse fala de gente — e e esse historico que
 * alimenta a taxa de resposta do painel (60% na tela contra 27% de gente de verdade) e o modo do
 * follow-up (`reengage`, "retomando nossa conversa", para quem nunca falou). Sem essa passagem, a
 * correcao do painel so aparece daqui a alguns meses, quando o historico velho sair do periodo.
 *
 * Uso (dentro do container do app, que e quem enxerga o banco):
 *   node dist/src/db/backfill-auto-replies.js                     # so mostra o plano
 *   node dist/src/db/backfill-auto-replies.js --apply             # grava
 *   node dist/src/db/backfill-auto-replies.js --agent="Mariana"   # limita a um SDR
 *
 * O criterio e o mesmo do webhook (`isStoreAutoReply`), entao o que ele erra aqui e o mesmo que
 * ele erraria ao vivo — e o erro dele e sempre para o lado de "e gente".
 */

interface Args {
  agent: string | null;
  apply: boolean;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  let apply = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] && match[2] !== undefined) flags.set(match[1], match[2]);
  }

  return { agent: flags.get('agent') ?? process.env.SDR_AGENT ?? null, apply: apply || process.env.APPLY === 'true' };
}

async function resolveAgentIds(reference: string | null): Promise<string[] | null> {
  if (reference === null) return null;

  const agents = await db.select().from(sdrAgents);
  const matches = agents.filter(
    (agent) =>
      agent.id === reference ||
      agent.name.toLowerCase().includes(reference.toLowerCase()) ||
      agent.displayName.toLowerCase().includes(reference.toLowerCase()),
  );

  if (matches.length === 0) throw new Error(`Nenhum SDR encontrado para "${reference}"`);
  return matches.map((agent) => agent.id);
}

/** Recebidas que o filtro de hoje reconheceria como automatica e que estao gravadas como gente. */
function autoRepliesAmong(inbound: Message[]): Message[] {
  return inbound.filter((message) =>
    isStoreAutoReply({ messageType: message.messageType, text: message.text, transcription: message.transcription }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const agentIds = await resolveAgentIds(args.agent);

  const inbound = await db
    .select()
    .from(messages)
    .where(
      agentIds
        ? and(eq(messages.direction, 'inbound'), eq(messages.autoReply, false), inArray(messages.sdrAgentId, agentIds))
        : and(eq(messages.direction, 'inbound'), eq(messages.autoReply, false)),
    );

  const toFlag = autoRepliesAmong(inbound);
  const flaggedIds = new Set(toFlag.map((message) => message.id));

  // Lead que so ouviu robo: nenhuma recebida sobra depois de tirar as automaticas. Ele voltou
  // para `initial_sent` para o follow-up trata-lo como segundo toque (`bump`), que e o texto
  // escrito para quem nunca respondeu, em vez de retomar uma conversa que nunca existiu.
  const humanLeadIds = new Set(inbound.filter((message) => !flaggedIds.has(message.id)).map((message) => message.leadId));
  const robotOnlyLeadIds = [...new Set(toFlag.map((message) => message.leadId))].filter((leadId) => !humanLeadIds.has(leadId));

  const leadsToReset =
    robotOnlyLeadIds.length > 0
      ? await db
          .select()
          .from(leads)
          .where(and(inArray(leads.id, robotOnlyLeadIds), eq(leads.status, 'in_conversation')))
      : [];

  out(`Mensagens recebidas sem marca: ${inbound.length}`);
  out(`Reconhecidas como automatica da loja: ${toFlag.length}`);
  out(`Leads "Em conversa" sem nenhuma fala de gente: ${leadsToReset.length}`);
  for (const lead of leadsToReset.slice(0, 20)) out(`  ${lead.id}  ${lead.companyName}`);
  if (leadsToReset.length > 20) out(`  ... e mais ${leadsToReset.length - 20}`);
  out('');

  if (toFlag.length === 0 && leadsToReset.length === 0) {
    out('Nada a mudar.');
    return;
  }

  if (!args.apply) {
    out('Nada foi gravado. Rode de novo com --apply para aplicar.');
    return;
  }

  // Tudo na mesma transacao: mensagem marcada com lead nao devolvido (ou o contrario) deixaria
  // o painel e o follow-up contando coisas diferentes.
  await db.transaction(async (tx) => {
    for (let index = 0; index < toFlag.length; index += 500) {
      const batch = toFlag.slice(index, index + 500).map((message) => message.id);
      await tx.update(messages).set({ autoReply: true }).where(inArray(messages.id, batch));
    }

    if (leadsToReset.length > 0) {
      await tx
        .update(leads)
        .set({ status: 'initial_sent', lastInboundAt: null, updatedAt: sql`now()` })
        .where(inArray(leads.id, leadsToReset.map((lead) => lead.id)));
    }
  });

  out('Aplicado.');
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
