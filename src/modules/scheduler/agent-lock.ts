/**
 * Trava por SDR dentro do processo. O cron e o botao "rodar agora" do portal usam instancias
 * diferentes do mesmo servico, no mesmo processo: sem trava os dois podiam pegar o mesmo lead
 * `pending` no mesmo segundo e mandar a primeira mensagem duas vezes — e mensagem repetida de
 * numero desconhecido e o que faz o WhatsApp marcar a conta.
 *
 * O portal roda numa instancia so (um servico no EasyPanel); com mais de uma, a trava teria de
 * ir para o banco.
 */
const running = new Set<string>();

/** Roda `task` se ninguem estiver rodando a mesma chave; senao devolve `null` sem esperar. */
export async function withAgentLock<T>(key: string, task: () => Promise<T>): Promise<T | null> {
  if (running.has(key)) return null;
  running.add(key);
  try {
    return await task();
  } finally {
    running.delete(key);
  }
}
