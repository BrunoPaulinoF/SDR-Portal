#!/usr/bin/env node
// Varre o Google Maps via Apify (compass/crawler-google-places) atras de operacoes
// de gastronomia com delivery na praca de Sao Paulo (capital, ABC e interior).
//
// O actor cobra por lugar entregue (US$ 0.004 no free tier) e mais US$ 0.001 por
// filtro aplicado do lado deles. Por isso nao usamos filtro nenhum na Apify:
// tudo (fechados, sem telefone, fora do ICP) e descartado depois, de graca, pelo
// rank-leads-gastro.mjs. O gasto e conferido entre um municipio e outro e a
// varredura aborta sozinha se encostar no teto.
//
//   node scripts/apify-leads-gastro.mjs [--budget=4.20] [--dry-run]
//
// Token: local-secrets/apify-token ou a variavel APIFY_TOKEN.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://api.apify.com/v2';
const ACTOR = 'compass~crawler-google-places';
const OUT = 'local-secrets/raw-places.json';

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

// Cota por municipio = lugares por termo de busca. Capital pesa mais.
const CITIES = [
  { location: 'Sao Paulo, Sao Paulo, Brazil', perSearch: 30 },
  { location: 'Campinas, Sao Paulo, Brazil', perSearch: 20 },
  { location: 'Guarulhos, Sao Paulo, Brazil', perSearch: 15 },
  { location: 'Santo Andre, Sao Paulo, Brazil', perSearch: 15 },
  { location: 'Ribeirao Preto, Sao Paulo, Brazil', perSearch: 15 },
  { location: 'Sorocaba, Sao Paulo, Brazil', perSearch: 15 },
  { location: 'Sao Jose dos Campos, Sao Paulo, Brazil', perSearch: 15 },
];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const BUDGET_USD = Number(args.get('budget') ?? 4.2);
const DRY_RUN = args.get('dry-run') === 'true';

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

async function api(path, init = {}) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Apify ${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function spentUsd() {
  const { data } = await api('/users/me/limits');
  return Number(data?.current?.monthlyUsageUsd ?? 0);
}

async function scrapeCity({ location, perSearch }) {
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
  const planned = CITIES.reduce((n, c) => n + c.perSearch * TERMS.length, 0);
  log(`Plano: ${CITIES.length} municipios x ${TERMS.length} termos = ate ${planned} lugares`);
  log(`Custo maximo estimado: US$ ${(planned * 0.004).toFixed(2)} | teto de aborto: US$ ${BUDGET_USD}`);
  if (DRY_RUN) return;

  const start = await spentUsd();
  log(`Gasto atual na conta: US$ ${start.toFixed(4)}\n`);

  const all = [];
  for (const city of CITIES) {
    const spent = await spentUsd();
    if (spent >= BUDGET_USD) {
      log(`ABORTANDO antes de ${city.location}: gasto US$ ${spent.toFixed(2)} >= teto US$ ${BUDGET_USD}`);
      break;
    }
    log(`${city.location} (gasto ate aqui US$ ${spent.toFixed(2)})`);
    try {
      all.push(...(await scrapeCity(city)));
    } catch (err) {
      log(`  ERRO em ${city.location}: ${err.message}`);
    }
    mkdirSync('local-secrets', { recursive: true });
    writeFileSync(OUT, JSON.stringify(all, null, 1));
  }

  const end = await spentUsd();
  log(`\n${all.length} lugares brutos -> ${OUT}`);
  log(`Gasto na varredura: US$ ${(end - start).toFixed(3)} (total do mes: US$ ${end.toFixed(3)})`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
