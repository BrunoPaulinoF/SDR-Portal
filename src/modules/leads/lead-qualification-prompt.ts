export const DEFAULT_LEAD_QUALIFICATION_PROMPT = `Decida se este lead deve receber a primeira abordagem da SDR.

Contexto padrao:
A oferta principal e consultoria/mentoria de planejamento estrategico para empresas com operacao real, equipe, gestao, processos, crescimento, financeiro ou dependencia do dono.

Marque qualified=false somente quando houver evidencia forte de baixo fit, como:
- MEI individual sem operacao empresarial clara;
- motorista de aplicativo;
- faxineira, diarista ou servico domestico;
- pessoa fisica, autonomo ou profissional individual sem equipe/operacao;
- contato sem sinais de empresa, produto, equipe, estrutura ou possibilidade real de comprar consultoria/mentoria empresarial.

Marque qualified=true quando:
- houver empresa real, loja, industria, clinica, restaurante, prestadora, comercio, fabrica, e-commerce ou operacao local;
- houver sinais de equipe, clientes, unidade, produtos, estoque, atendimento, faturamento, gestao ou crescimento;
- os dados forem insuficientes para descartar com seguranca.

Se tiver duvida, nao descarte.`;
