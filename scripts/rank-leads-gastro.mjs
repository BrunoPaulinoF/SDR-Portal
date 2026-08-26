#!/usr/bin/env node
// Transforma o dump bruto do Google Maps (apify-leads-gastro.mjs) na lista
// ranqueada de leads. Roda offline, quantas vezes for preciso, sem custo.
//
//   node scripts/rank-leads-gastro.mjs [--top=500] [--in=...] [--out=...]
//
// O criterio sai do que a analise da Mariana (docs/analises/mariana-2026-08.md)
// mostrou queimar a base: 18 dos 82 leads dela morreram como `invalid_phone`, e
// 27 das 33 "respostas" eram o robo da propria loja, nao gente. Entao o que pesa
// aqui e, nesta ordem: numero que e celular (tem WhatsApp), sinal de delivery,
// porte compativel com a oferta, e ser rede/franquia.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const IN = args.get('in') ?? 'local-secrets/raw-places.json';
const OUT = args.get('out') ?? 'local-secrets/leads-ranked.json';
const TOP = Number(args.get('top') ?? 500);

const log = (...m) => process.stdout.write(`${m.join(' ')}\n`);

const deaccent = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Redes grandes demais para esta oferta: o numero publicado e central de
// atendimento ou robo de pedido, e a unidade nao decide sozinha sobre tecnologia.
// Ficam na planilha (o pedido foi ranquear, nao filtrar), mas no fim da fila.
const MEGA_REDES = [
  'mcdonald', 'burger king', 'subway', "bob's", 'bobs ', 'habib', 'kfc',
  'pizza hut', 'domino', 'starbucks', 'outback', 'madero', 'giraffas',
  'spoleto', 'china in box', 'ragazzo', 'montana grill', 'popeyes',
  'coco bambu', "applebee", 'jeronimo', 'the fifties', 'divino fogao',
  'vivenda do camarao', 'casa do pao de queijo', 'rei do mate', 'cacau show',
];

// Redes de porte medio: franqueado decide a propria operacao e o numero costuma
// ser o do dono ou do gerente da unidade. Sao o alvo preferido do pedido.
const FRANQUIAS = [
  'jin jin', 'gendai', 'temakeria', 'mr cheney', 'chiquinho sorvetes', 'oakberry',
  'sodie doces', 'casa de bolos', 'patroni', 'mania de churrasco', 'griletto',
  'croasonho', 'los paleteros', 'grand gelato', 'bella capri', 'pizza prime',
  'sterna', 'acai concept', 'the best acai',
];

// Plataformas de pedido: presenca delas e prova de que a casa ja vende delivery.
const PLATAFORMAS = [
  ['ifood', 'iFood'], ['anota.ai', 'Anota AI'], ['anotaai', 'Anota AI'],
  ['goomer', 'Goomer'], ['aiqfome', 'aiqfome'], ['rappi', 'Rappi'],
  ['neemo', 'Neemo'], ['cardapioweb', 'Cardapio Web'], ['menudino', 'Menudino'],
  ['delivery.much', 'DeliveryMuch'], ['saipos', 'Saipos'], ['abrahao', 'Abrahao'],
  ['linkkuis', 'Linkkuis'], ['delivery direto', 'Delivery Direto'],
  ['deliverydireto', 'Delivery Direto'], ['pedidoja', 'PedidoJa'],
];

// Palavras genericas: "pizzaria" sozinho nao identifica rede nenhuma.
const GENERICOS = new Set([
  'pizzaria', 'pizza', 'hamburgueria', 'burger', 'acai', 'acaiteria',
  'marmitaria', 'marmita', 'lanchonete', 'lanches', 'doceria', 'pastelaria',
  'pastel', 'restaurante', 'delivery', 'sushi', 'temakeria', 'sorveteria',
  'padaria', 'bar', 'cafe', 'cafeteria', 'esfiharia', 'espetinho',
]);

// A busca vai sem acento para a Apify; quando o lugar nao traz `city`, cai aqui
// para nao misturar "Santo Andre" e "Santo Andre" acentuado como cidades diferentes.
const CIDADE_CANONICA = {
  'sao paulo': 'São Paulo',
  'campinas': 'Campinas',
  'guarulhos': 'Guarulhos',
  'santo andre': 'Santo André',
  'ribeirao preto': 'Ribeirão Preto',
  'sorocaba': 'Sorocaba',
  'sao jose dos campos': 'São José dos Campos',
};

// O Google devolve o estado por extenso ("Sao Paulo"), mas o import de leads do
// portal espera UF. Mapa completo para nao quebrar se a varredura mudar de praca.
const UF = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
  pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
  tocantins: 'TO',
};

/** Telefone BR -> {e164, ddd, celular}. Celular = 9 digitos comecando em 9. */
function analisarTelefone(bruto) {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return null;
  const nac = d.startsWith('55') ? d.slice(2) : d;
  if (nac.length < 10 || nac.length > 11) return null;
  const ddd = nac.slice(0, 2);
  const num = nac.slice(2);
  if (Number(ddd) < 11 || Number(ddd) > 99) return null;
  return {
    e164: `+55${ddd}${num}`,
    exibicao: `(${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`,
    ddd,
    celular: num.length === 9 && num.startsWith('9'),
  };
}

/** Nome-base da marca, para agrupar unidades da mesma rede. */
function marcaDe(title) {
  // Mantemos o termo generico dentro da marca de proposito: remove-lo fazia
  // "Doceria Ribeirao Preto" virar "ribeirao preto" e casar com "Marmitaria
  // Ribeirao Preto", duas casas sem relacao nenhuma. Unidade de franquia no
  // Google Maps carrega a marca inteira ("Kuba Burguer - Campo Limpo"), entao
  // basta cortar o sufixo de unidade.
  return deaccent(title)
    .split(/\s+[-\u2013|]\s+|\s*[(/]/)[0]
    .replace(/[^a-z0-9\s&']/g, ' ')
    .replace(/\b(delivery|ifood|oficial|matriz|filial|unidade|loja|shopping|express|drive thru)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sinalDelivery(p) {
  const motivos = [];
  // 81% dos lugares marcam entrega no perfil, entao isso sozinho quase nao separa
  // ninguem. O que separa e ter plataforma de pedido: prova de operacao digital
  // rodando, que e exatamente onde a oferta encaixa.
  let noPerfil = false;
  for (const grupo of Object.values(p.additionalInfo ?? {})) {
    if (!Array.isArray(grupo)) continue;
    for (const item of grupo) {
      for (const [k, v] of Object.entries(item ?? {})) {
        if (v === true && /entrega|delivery/i.test(k)) noPerfil = true;
      }
    }
  }
  const texto = deaccent([p.title, p.categoryName, ...(p.categories ?? [])].join(' '));
  const noNome = /delivery|entrega|tele.?entrega|dark kitchen/.test(texto);
  const site = deaccent(String(p.website ?? ''));
  const plats = [...new Set(PLATAFORMAS.filter(([k]) => site.includes(k)).map(([, n]) => n))];

  if (plats.length) {
    motivos.push(`vende em ${plats.join(', ')}`);
    return { nivel: 'Confirmado (plataforma)', pontos: 25, motivos, plataformas: plats };
  }
  if (noPerfil) {
    motivos.push('perfil do Google marca entrega');
    return { nivel: 'Sim (perfil Google)', pontos: 16, motivos, plataformas: [] };
  }
  if (noNome) {
    motivos.push('nome/categoria de delivery');
    return { nivel: 'Provavel', pontos: 10, motivos, plataformas: [] };
  }
  return { nivel: 'Nao identificado', pontos: 0, motivos, plataformas: [] };
}

function pontuar(p, redes) {
  const pontos = [];
  const ressalvas = [];
  let score = 0;

  const tel = analisarTelefone(p.phoneUnformatted ?? p.phone);
  if (tel?.celular) { score += 30; pontos.push('celular (WhatsApp provavel)'); }
  else if (tel) { score += 4; ressalvas.push('numero fixo: risco de nao ter WhatsApp'); }

  const del = sinalDelivery(p);
  score += del.pontos;
  if (del.nivel === 'Nao identificado') ressalvas.push('nenhum sinal de delivery no perfil');
  pontos.push(...del.motivos);

  // Porte: a oferta e para pequeno e medio. Avaliacoes como proxy de volume.
  const n = Number(p.reviewsCount ?? 0);
  if (n >= 80 && n <= 900) { score += 20; pontos.push(`${n} avaliacoes: porte na faixa da oferta`); }
  else if (n >= 25 && n < 80) { score += 14; pontos.push(`${n} avaliacoes`); }
  else if (n > 900 && n <= 2500) { score += 9; ressalvas.push(`${n} avaliacoes: operacao grande`); }
  else if (n > 2500) { score += 3; ressalvas.push(`${n} avaliacoes: grande demais para a oferta`); }
  else { score += 3; ressalvas.push(`so ${n} avaliacoes: casa nova ou pouco ativa`); }

  const nota = Number(p.totalScore ?? 0);
  if (nota >= 4.0 && nota <= 4.9) { score += 10; pontos.push(`nota ${nota.toFixed(1)}`); }
  else if (nota >= 3.5) { score += 6; }
  else if (nota > 0) { score += 2; ressalvas.push(`nota baixa (${nota.toFixed(1)})`); }
  else { score += 4; }

  const marca = marcaDe(p.title ?? '');
  const unidades = redes.get(marca)?.size ?? 1;
  const megaRede = MEGA_REDES.some((m) => deaccent(p.title ?? '').includes(m));
  let tipo = 'Independente';
  if (megaRede) {
    tipo = 'Rede nacional';
    score -= 25;
    ressalvas.push('rede nacional: numero costuma ser central/robo e a unidade nao decide');
  } else if (unidades >= 2 && !GENERICOS.has(marca) && marca.length > 2) {
    tipo = `Rede/franquia (${unidades} unidades na base)`;
    score += 15;
    pontos.push(`${unidades} unidades encontradas na varredura: rede`);
  } else if (FRANQUIAS.some((f) => deaccent(p.title ?? '').includes(f))) {
    tipo = 'Franquia (marca conhecida)';
    score += 15;
    pontos.push('unidade de franquia de porte medio');
  }

  const site = String(p.website ?? '');
  const siteProprio = site && !PLATAFORMAS.some(([k]) => deaccent(site).includes(k));
  if (siteProprio) { score += 5; pontos.push('site proprio'); }

  return { score: Math.min(100, Math.max(0, Math.round(score))), pontos, ressalvas, tel, del, tipo, marca, unidades };
}

function main() {
  const brutos = JSON.parse(readFileSync(IN, 'utf8'));
  log(`${brutos.length} lugares brutos`);

  // Dedupe por placeId e depois por telefone (a mesma casa aparece em varias buscas).
  const porId = new Map();
  for (const p of brutos) {
    const id = p.placeId ?? p.url ?? p.title;
    if (id && !porId.has(id)) porId.set(id, p);
  }
  log(`${porId.size} apos dedupe por placeId`);

  // Redes: quantas unidades distintas por marca.
  const redes = new Map();
  for (const p of porId.values()) {
    const m = marcaDe(p.title ?? '');
    if (!m) continue;
    if (!redes.has(m)) redes.set(m, new Set());
    redes.get(m).add(p.placeId ?? p.url);
  }

  const descartes = { fechado: 0, semTelefone: 0, foraDoRamo: 0, telDuplicado: 0 };
  const vistos = new Set();
  const leads = [];

  for (const p of porId.values()) {
    if (p.permanentlyClosed || p.temporarilyClosed) { descartes.fechado += 1; continue; }

    const cat = deaccent([p.categoryName, ...(p.categories ?? [])].join(' '));
    if (/hotel|posto de gasolina|supermercado|farmacia|academia|igreja|escola|oficina/.test(cat)) {
      descartes.foraDoRamo += 1; continue;
    }

    const r = pontuar(p, redes);
    if (!r.tel) { descartes.semTelefone += 1; continue; }
    if (vistos.has(r.tel.e164)) { descartes.telDuplicado += 1; continue; }
    vistos.add(r.tel.e164);

    leads.push({
      score: r.score,
      nome: p.title ?? '',
      tipo: r.tipo,
      marca: r.marca,
      unidades: r.unidades,
      categoria: p.categoryName ?? '',
      cidade: p.city || CIDADE_CANONICA[deaccent((p._searchCity ?? '').split(',')[0])] || '',
      estado: UF[deaccent(p.state ?? '')] ?? p.state ?? 'SP',
      bairro: p.neighborhood ?? '',
      endereco: p.address ?? '',
      telefone: r.tel.exibicao,
      telefone_e164: r.tel.e164,
      whatsapp_provavel: r.tel.celular ? 'Sim' : 'Duvidoso (fixo)',
      nota: Number(p.totalScore ?? 0) || '',
      avaliacoes: Number(p.reviewsCount ?? 0),
      delivery: r.del.nivel,
      plataformas: r.del.plataformas.join(', '),
      site: p.website ?? '',
      maps: p.url ?? '',
      porque: r.pontos.join('; '),
      ressalvas: r.ressalvas.join('; '),
    });
  }

  leads.sort((a, b) => b.score - a.score || b.avaliacoes - a.avaliacoes);
  const top = leads.slice(0, TOP).map((l, i) => ({ rank: i + 1, ...l }));

  log(`descartes: ${JSON.stringify(descartes)}`);
  log(`${leads.length} leads validos -> gravando ${top.length}`);
  log(`  com celular: ${top.filter((l) => l.whatsapp_provavel === 'Sim').length}`);
  log(`  delivery por plataforma: ${top.filter((l) => l.delivery.startsWith('Confirmado')).length}`);
  log(`  redes/franquias: ${top.filter((l) => /^(Rede\/franquia|Franquia)/.test(l.tipo)).length}`);

  mkdirSync('local-secrets', { recursive: true });
  writeFileSync(OUT, JSON.stringify(top, null, 1));
}

main();
