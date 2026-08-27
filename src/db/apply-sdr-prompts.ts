import { existsSync } from 'node:fs';

import { and, asc, eq, ilike, or } from 'drizzle-orm';

import { closeDb, db } from './client.js';
import { firstMessageVariants, sdrAgents, type NewSdrAgent, type SdrAgent } from './schema.js';
import { isSdrPlaybook, type SdrPlaybook } from '../modules/ai/sdr-playbooks.js';
import {
  FIRST_MESSAGE_FILE,
  FIRST_MESSAGE_LABEL,
  PROMPT_FILES,
  planPromptUpdate,
  readPromptBundle,
  type PromptUpdatePlan,
  promptDirNameFor,
} from '../modules/sdr-agents/prompt-bundle.js';

/**
 * Aplica no banco os prompts revisados de docs/prompts/<sdr>/.
 *
 * A tela do portal continua sendo a forma normal de editar prompt; este script existe para
 * o caso em que o texto revisado ja esta no repositorio e ninguem quer colar seis campos a
 * mao — e porque colar a mao foi o que deixou um SDR de convite com a abertura consultiva.
 *
 * Uso (dentro do container do app, que e quem enxerga o banco):
 *   node dist/src/db/apply-sdr-prompts.js --agent="Francielly"            # so mostra o plano
 *   node dist/src/db/apply-sdr-prompts.js --agent="Francielly" --apply    # grava
 *
 * Opcoes: --agent=<id|nome>, --dir=<diretorio de prompts>, --playbook=<consultivo|convite>,
 * --apply. Sem --apply nada e gravado.
 */

/**
 * Nao existe diretorio padrao, de proposito. Ele ja foi `docs/prompts/insumosmart`, e o efeito
 * era que `--agent="Mariana" --apply` — a forma documentada de usar o script — gravava os
 * prompts da Insumo Smart na Mariana e ainda trocava o playbook dela para `convite`. Foi o que
 * aconteceu em 27/08: a Mariana passou a se apresentar como SDR da Insumo Smart para os leads
 * da KyberFood. O diretorio agora sai do nome do proprio SDR, e `--dir` so entra quando alguem
 * escreve explicitamente qual bundle quer.
 */
const PROMPTS_ROOT = 'docs/prompts';


function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function parseArgs(argv: string[]): { agent: string | null; apply: boolean; dir: string | null; playbook: string | null } {
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

  return {
    agent: flags.get('agent') ?? process.env.SDR_AGENT ?? null,
    apply: apply || process.env.APPLY === 'true',
    dir: flags.get('dir') ?? process.env.PROMPTS_DIR ?? null,
    playbook: flags.get('playbook') ?? process.env.SDR_PLAYBOOK ?? null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita o id do SDR ou um pedaco do nome/nome de exibicao, mas so segue com um unico match. */
async function findAgent(reference: string): Promise<SdrAgent> {
  const matches = UUID.test(reference)
    ? await db.select().from(sdrAgents).where(eq(sdrAgents.id, reference)).limit(2)
    : await db
        .select()
        .from(sdrAgents)
        .where(or(ilike(sdrAgents.name, `%${reference}%`), ilike(sdrAgents.displayName, `%${reference}%`)))
        .orderBy(asc(sdrAgents.name))
        .limit(10);

  const first = matches[0];
  if (!first) throw new Error(`Nenhum SDR encontrado para "${reference}"`);
  if (matches.length > 1) {
    const list = matches.map((agent) => `  ${agent.id}  ${agent.name} (${agent.displayName})`).join('\n');
    throw new Error(`Mais de um SDR bate com "${reference}". Rode de novo com o id:\n${list}`);
  }

  return first;
}

/** Mensagem fixa que o SDR usa hoje: so ha uma quando existe exatamente uma variante ativa. */
async function currentFixedFirstMessage(agentId: string): Promise<string | null> {
  const active = await db
    .select()
    .from(firstMessageVariants)
    .where(and(eq(firstMessageVariants.sdrAgentId, agentId), eq(firstMessageVariants.isActive, true)));

  return active.length === 1 ? (active[0]?.body.trim() ?? null) : null;
}

function firstLine(text: string | null): string {
  if (text === null) return '(vazio)';
  const trimmed = text.trim();
  if (!trimmed) return '(vazio)';
  const [line = ''] = trimmed.split('\n');
  return line.length > 70 ? `${line.slice(0, 70)}...` : line;
}

function printPlan(agent: SdrAgent, dir: string, plan: PromptUpdatePlan): void {
  out(`SDR: ${agent.name} (${agent.displayName})  id=${agent.id}`);
  out(`Prompts: ${dir}`);
  out('');

  if (plan.changes.length === 0) {
    out('Nada a mudar: o banco ja esta igual aos arquivos.');
  } else {
    out(`Mudancas (${plan.changes.length}):`);
    for (const change of plan.changes) {
      out(`- ${change.field}`);
      out(`    antes: ${firstLine(change.before)}`);
      out(`    depois: ${firstLine(change.after)}`);
    }
  }

  if (plan.unchanged.length > 0) {
    out('');
    out(`Ja estavam iguais: ${plan.unchanged.join(', ')}`);
  }

  if (plan.warnings.length > 0) {
    out('');
    out('Avisos:');
    for (const warning of plan.warnings) out(`- ${warning}`);
  }
}

/**
 * Grava tudo numa transacao: prompt errado com mensagem certa (ou o contrario) e pior do
 * que nao ter aplicado nada.
 */
async function applyPlan(agent: SdrAgent, plan: PromptUpdatePlan): Promise<void> {
  const patch: Partial<NewSdrAgent> = {};
  for (const change of plan.changes) {
    if (change.field === FIRST_MESSAGE_FILE) continue;
    if (change.field === 'playbook') patch.playbook = change.after;
    else if (change.field === 'firstMessageMode') patch.firstMessageMode = change.after;
    else if (change.field in PROMPT_FILES) patch[change.field as keyof typeof PROMPT_FILES] = change.after;
  }

  await db.transaction(async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx
        .update(sdrAgents)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(sdrAgents.id, agent.id));
    }

    if (plan.firstMessage === null) return;

    // Mais de uma variante ativa vira rodizio, e o roteiro deixa de ser um so: as antigas
    // saem do ar mas continuam salvas, para nao perder as metricas ja coletadas.
    await tx
      .update(firstMessageVariants)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(firstMessageVariants.sdrAgentId, agent.id), eq(firstMessageVariants.isActive, true)));

    const [existing] = await tx
      .select()
      .from(firstMessageVariants)
      .where(
        and(eq(firstMessageVariants.sdrAgentId, agent.id), eq(firstMessageVariants.label, FIRST_MESSAGE_LABEL)),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(firstMessageVariants)
        .set({ body: plan.firstMessage, isActive: true, updatedAt: new Date() })
        .where(eq(firstMessageVariants.id, existing.id));
      return;
    }

    await tx.insert(firstMessageVariants).values({
      sdrAgentId: agent.id,
      label: FIRST_MESSAGE_LABEL,
      body: plan.firstMessage,
      isActive: true,
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.agent) {
    throw new Error('Informe o SDR: --agent="<id ou nome>" (ou a variavel SDR_AGENT)');
  }
  if (args.playbook !== null && !isSdrPlaybook(args.playbook)) {
    throw new Error(`Playbook invalido: "${args.playbook}". Use consultivo ou convite.`);
  }

  const agent = await findAgent(args.agent);

  // Sem `--dir`, o bundle e o do proprio SDR. Se ele nao existir, para aqui: escolher um
  // diretorio por conta propria e como o prompt de um SDR foi parar dentro de outro.
  const dir = args.dir ?? `${PROMPTS_ROOT}/${promptDirNameFor(agent.name)}`;
  if (args.dir === null && !existsSync(dir)) {
    throw new Error(
      `Nao existe ${dir} para o SDR "${agent.name}". Crie o diretorio ou passe --dir=<diretorio> apontando o bundle certo.`,
    );
  }

  // Sem `--playbook`, o do SDR fica como esta: trocar o funil de alguem sem ninguem pedir e
  // mudanca de comportamento silenciosa, nao aplicacao de prompt.
  // `playbook` e coluna de texto livre: se o que estiver gravado nao for um playbook conhecido,
  // cai no padrao documentado em vez de propagar lixo.
  const playbookAtual: SdrPlaybook = isSdrPlaybook(agent.playbook) ? agent.playbook : 'consultivo';
  const playbook: SdrPlaybook = args.playbook !== null && isSdrPlaybook(args.playbook) ? args.playbook : playbookAtual;

  const bundle = await readPromptBundle(dir);
  const plan = planPromptUpdate({
    agent,
    bundle,
    currentFirstMessage: await currentFixedFirstMessage(agent.id),
    playbook,
  });

  printPlan(agent, dir, plan);
  out('');

  if (plan.changes.length === 0) return;

  if (!args.apply) {
    out('Nada foi gravado. Rode de novo com --apply para aplicar.');
    return;
  }

  await applyPlan(agent, plan);
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
