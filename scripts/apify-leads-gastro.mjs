#!/usr/bin/env node
// Varre o Google Maps via Apify (compass/crawler-google-places) atras de operacoes
// de gastronomia com delivery no estado de Sao Paulo (capital, Grande SP/ABC,
// interior e litoral).
//
// O actor cobra por lugar entregue (US$ 0.004 no free tier) e mais US$ 0.001 por
// filtro aplicado do lado deles. Por isso nao usamos filtro nenhum na Apify:
// tudo (fechados, sem telefone, fora do ICP) e descartado depois, de graca, pelo
// rank-leads-gastro.mjs. O gasto e conferido entre um municipio e outro e a
// varredura aborta sozinha se encostar no teto.
//
// O plano de gasto sai da propria conta (/users/me/limits): o teto padrao e 98%
// do limite mensal MENOS o que ja foi gasto no ciclo, e a cota por busca encolhe
// sozinha para caber nesse saldo. Numa conta free que ja gastou US$ 4 dos US$ 5,
// isso significa varrer ~240 lugares em vez de estourar o limite no meio.
//
//   node scripts/apify-leads-gastro.mjs --dry-run          # so o plano e o custo
//   node scripts/apify-leads-gastro.mjs                    # varre cidades novas
//   node scripts/apify-leads-gastro.mjs --todas-cidades    # inclui as ja varridas
//   node scripts/apify-leads-gastro.mjs --cidades=Santos,Osasco --per-search=10
//
// Token: local-secrets/apify-token ou a variavel APIFY_TOKEN.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const API = 'https://api.apify.com/v2';
const ACTOR = 'compass~crawler-google-places';
const OUT = 'local-secrets/raw-places.json';
const USD_POR_LUGAR = 0.004;

// 8 categorias que casam com a oferta da KyberFood: delivery de pequeno e medio
// porte que vende por WhatsApp. Sao tambem as categorias mais franqueadas do pais.
const TERMS = [
  'pizzaria delivery',
  'hamburgueria delivery',
  'acai delivery',
  'marmitaria delivery',
  'comida japonesa delivery',
  'lanchonete delivery',
  'doceria delivery',
  'pastelaria delivery',
];

// Municipios do estado de SP, do mais para o menos denso em delivery.
// `varridoEm` marca o que ja entrou numa varredura anterior: por padrao o script
// pula essas cidades, porque uma segunda passada rasa nelas devolve quase os
// mesmos lugares e o pedido aqui e lead NOVO. `--todas-cidades` reabre.
const CITIES = [
  // Ja varridas em 26/08/2026 (viraram os 500 de docs/leads/leads-gastro-delivery-sp.xlsx)
  { nome: 'Sao Paulo', perSearch: 30, varridoEm: '2026-08-26' },
  { nome: 'Campinas', perSearch: 20, varridoEm: '2026-08-26' },
  { nome: 'Guarulhos', perSearch: 15, varridoEm: '2026-08-26' },
  { nome: 'Santo Andre', perSearch: 15, varridoEm: '2026-08-26' },
  { nome: 'Ribeirao Preto', perSearch: 15, varridoEm: '2026-08-26' },
  { nome: 'Sorocaba', perSearch: 15, varridoEm: '2026-08-26' },
  { nome: 'Sao Jose dos Campos', perSearch: 15, varridoEm: '2026-08-26' },
  // Ainda nao varridas: e daqui que sai lead novo.
  { nome: 'Sao Bernardo do Campo', perSearch: 15 },
  { nome: 'Osasco', perSearch: 15 },
  { nome: 'Santos', perSearch: 15 },
  { nome: 'Jundiai', perSearch: 12 },
  { nome: 'Piracicaba', perSearch: 12 },
  { nome: 'Sao Jose do Rio Preto', perSearch: 12 },
  { nome: 'Bauru', perSearch: 12 },
  { nome: 'Mogi das Cruzes', perSearch: 12 },
  { nome: 'Diadema', perSearch: 10 },
  { nome: 'Barueri', perSearch: 10 },
  { nome: 'Sao Vicente', perSearch: 10 },
  { nome: 'Praia Grande', perSearch: 10 },
  { nome: 'Taubate', perSearch: 10 },
  { nome: 'Limeira', perSearch: 10 },
  { nome: 'Americana', perSearch: 10 },
  { nome: 'Indaiatuba', perSearch: 10 },
  { nome: 'Franca', perSearch: 10 },
  { nome: 'Maua', perSearch: 10 },
  { nome: 'Suzano', perSearch: 10 },
  { nome: 'Carapicuiba', perSearch: 10 },
  { nome: 'Araraquara', perSearch: 10 },
  { nome: 'Marilia', perSearch: 10 },
  { nome: 'Presidente Prudente', perSearch: 10 },
  { nome: 'Sao Caetano do Sul', perSearch: 10 },
];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const DRY_RUN = args.get('dry-run') === 'true';
const TODAS = args.get('todas-cidades') === 'true';
const APENAS = (args.get('cidades') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PER_SEARCH = args.has('per-search') ? Number(args.get('per-search')) : null;

function token() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN.trim();
  try {
    return readFileSync('local-secrets/apify-token', 'utf8').trim();
  } catch {
    throw new Error('Sem token: crie local-secrets/apify-token ou exporte APIFY_TOKEN.');
  }
}
const TOKEN = token();

const log = (...m) => process.stdout.write(`${m.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deaccent = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function api(path, init = {}) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Apify ${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** Saldo do ciclo corrente: quanto ja foi gasto, o teto do plano e o que sobra. */
async function saldo() {
  const { data } = await api('/users/me/limits');
  const gasto = Number(data?.current?.monthlyUsageUsd ?? 0);
  const teto = Number(data?.limits?.maxMonthlyUsageUsd ?? 5);
  const fim = data?.monthlyUsageCycle?.endAt ?? '';
  return { gasto, teto, restante: Math.max(0, teto - gasto), fim };
}

function cidadesAlvo() {
  if (APENAS.length) {
    const querido = APENAS.map(deaccent);
    return CITIES.filter((c) => querido.some((q) => deaccent(c.nome).includes(q)));
  }
  return TODAS ? CITIES : CITIES.filter((c) => !c.varridoEm);
}

/**
 * Ajusta o plano ao saldo. A ordem importa: primeiro encolhe a cota por busca ate
 * um piso, e so depois corta municipio do fim da fila. Espalhar 1 lugar por busca
 * em 24 cidades caberia no orcamento e nao serviria para nada — com uma amostra
 * dessas nenhuma marca aparece duas vezes, entao rede/franquia nunca e detectada
 * e o ranking perde o fator que mais pesa depois do celular. Melhor menos cidades
 * com profundidade do que o estado inteiro de raspao.
 */
const PISO_POR_BUSCA = 8;

function planejar(cidades, orcamento) {
  const cap = Math.floor(orcamento / USD_POR_LUGAR);
  let plano = cidades.map((c) => ({ ...c, perSearch: PER_SEARCH ?? c.perSearch }));
  const total = () => plano.reduce((n, c) => n + c.perSearch * TERMS.length, 0);

  const piso = PER_SEARCH ?? PISO_POR_BUSCA;
  while (total() > cap && plano.some((c) => c.perSearch > piso)) {
    const maior = plano.reduce((a, b) => (b.perSearch > a.perSearch ? b : a));
    maior.perSearch -= 1;
  }
  while (total() > cap && plano.length > 1) plano = plano.slice(0, -1);
  if (total() > cap) plano = [];
  return { plano, cap };
}

async function scrapeCity({ nome, perSearch }) {
  const location = `${nome}, Sao Paulo, Brazil`;
  const input = {
    searchStringsArray: TERMS,
    locationQuery: location,
    maxCrawledPlacesPerSearch: perSearch,
    language: 'pt-BR',
    countryCode: 'br',
    searchMatching: 'all',
    // Nenhum filtro pago: skipClosedPlaces/placeMinimumStars/categoryFilterWords
    // custariam US$ 0.001 por lugar cada um. Filtramos localmente.
    skipClosedPlaces: false,
    scrapeContacts: false,
    maxReviews: 0,
    maxImages: 0,
  };

  const { data: run } = await api(`/acts/${ACTOR}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  log(`  run ${run.id} iniciado (ate ${perSearch * TERMS.length} lugares)`);

  let status = run.status;
  let last = run;
  while (['READY', 'RUNNING'].includes(status)) {
    await sleep(10_000);
    const { data } = await api(`/actor-runs/${run.id}`);
    last = data;
    status = data.status;
  }
  if (status !== 'SUCCEEDED') log(`  aviso: run terminou como ${status}`);

  const items = await api(`/datasets/${last.defaultDatasetId}/items?clean=true&format=json&limit=5000`);
  log(`  ${items.length} lugares coletados (${status})`);
  return items.map((it) => ({ ...it, _searchCity: location }));
}

async function main() {
  const conta = await saldo();
  const orcamento = args.has('budget')
    ? Number(args.get('budget'))
    : Math.max(0, conta.restante - conta.teto * 0.02);

  const alvo = cidadesAlvo();
  if (!alvo.length) throw new Error('Nenhuma cidade selecionada. Veja --cidades= e --todas-cidades.');
  const { plano } = planejar(alvo, orcamento);
  const previstos = plano.reduce((n, c) => n + c.perSearch * TERMS.length, 0);

  log(`Ciclo da conta termina em ${conta.fim.slice(0, 10)}`);
  log(`Gasto no ciclo: US$ ${conta.gasto.toFixed(2)} de US$ ${conta.teto} -> sobra US$ ${conta.restante.toFixed(2)}`);
  log(`Orcamento desta varredura: US$ ${orcamento.toFixed(2)}`);
  log(`Plano: ${plano.length} de ${alvo.length} municipios x ${TERMS.length} termos = ate ${previstos} lugares`);
  for (const c of plano) log(`  ${c.nome}: ${c.perSearch} por busca (ate ${c.perSearch * TERMS.length})`);
  log(`Custo maximo estimado: US$ ${(previstos * USD_POR_LUGAR).toFixed(2)}`);
  if (plano.length < alvo.length) {
    log(`AVISO: ${alvo.length - plano.length} municipios ficaram de fora por falta de saldo.`);
  }
  if (DRY_RUN) return;
  if (previstos === 0) throw new Error('Saldo insuficiente para varrer qualquer coisa.');

  // Sempre acumula: o dump anterior continua valendo e o rank dedupe por placeId.
  const all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const antes = all.length;

  for (const city of plano) {
    const agora = await saldo();
    if (agora.gasto >= conta.gasto + orcamento) {
      log(`ABORTANDO antes de ${city.nome}: gasto US$ ${agora.gasto.toFixed(2)} encostou no orcamento`);
      break;
    }
    log(`${city.nome} (gasto ate aqui US$ ${agora.gasto.toFixed(2)})`);
    try {
      all.push(...(await scrapeCity(city)));
    } catch (err) {
      log(`  ERRO em ${city.nome}: ${err.message}`);
    }
    mkdirSync('local-secrets', { recursive: true });
    writeFileSync(OUT, JSON.stringify(all, null, 1));
  }

  const fim = await saldo();
  log(`\n${all.length - antes} lugares novos (${all.length} no total) -> ${OUT}`);
  log(`Gasto na varredura: US$ ${(fim.gasto - conta.gasto).toFixed(3)} (total do ciclo: US$ ${fim.gasto.toFixed(3)})`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
