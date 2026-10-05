/**
 * Filtro das listas da tela Registros. As tres tabelas de registro crescem a cada minuto de
 * operacao (o webhook guarda o corpo cru, a IA guarda o prompt inteiro): a tela le so uma
 * pagina por vez, do mais novo para o mais velho, e nunca a tabela inteira.
 */
export interface RecentLogFilter {
  /** So o que deu errado: tarefa `failed`, chamada de IA com erro, webhook `failed`. */
  onlyErrors?: boolean;
  sdrAgentId?: string;
}
