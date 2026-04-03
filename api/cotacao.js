// api/cotacao.js — Vercel Edge Function CORRIGIDA
// Busca cotação de commodities no Yahoo Finance e converte para R$/unidade BR

export const config = { runtime: 'edge' };

// Fatores de conversão: cada cultura tem seu ticker, unidade original e fator para R$/saca
// Soja  CBOT: US¢/bushel → saca 60kg: 1 bushel = 27.2155 kg → sacas/bushel = 27.2155/60
// Milho CBOT: US¢/bushel → saca 60kg: 1 bushel = 25.4012 kg → sacas/bushel = 25.4012/60
// Café  ICE NY: US¢/libra → saca 60kg: 1 libra = 0.453592kg → kg/libra * 60 = 132.276 libras/saca
// Boi   CME: US$/cwt (100 libras) → arroba 15kg: 1 cwt = 45.3592kg → arrobas = 45.3592/15
const CULTURAS_CONFIG = {
  soja: {
    ticker: 'ZS=F',
    nome: 'Soja',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bushel',
    unidadeBR: 'R$/sc 60kg',
    // preço em US¢/bushel → R$/saca:
    // (centavos/100 = dólares) * câmbio * (27.2155kg/bushel) / (60kg/saca)
    converterParaBR: (preco, cambio) => (preco / 100) * cambio * (27.2155 / 60),
    formatarOriginal: (v) => `${v.toFixed(2)} US¢/bu`,
  },
  milho: {
    ticker: 'ZC=F',
    nome: 'Milho',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bushel',
    unidadeBR: 'R$/sc 60kg',
    converterParaBR: (preco, cambio) => (preco / 100) * cambio * (25.4012 / 60),
    formatarOriginal: (v) => `${v.toFixed(2)} US¢/bu`,
  },
  cafe: {
    ticker: 'KC=F',
    nome: 'Café',
    bolsa: 'ICE Nova York',
    unidadeOriginal: 'US¢/libra',
    unidadeBR: 'R$/sc 60kg',
    // (centavos/100) * câmbio * (60kg / 0.453592kg_por_libra)
    converterParaBR: (preco, cambio) => (preco / 100) * cambio * (60 / 0.453592),
    formatarOriginal: (v) => `${v.toFixed(2)} US¢/lb`,
  },
  boi_gordo: {
    ticker: 'LE=F',
    nome: 'Boi Gordo',
    bolsa: 'CME',
    unidadeOriginal: 'US$/cwt',
    unidadeBR: 'R$/@',
    // (dólares/cwt) * câmbio * (45.3592kg/cwt) / (15kg/arroba)
    converterParaBR: (preco, cambio) => preco * cambio * (45.3592 / 15),
    formatarOriginal: (v) => `${v.toFixed(2)} US$/cwt`,
  },
  algodao: {
    ticker: 'CT=F',
    nome: 'Algodão',
    bolsa: 'ICE',
    unidadeOriginal: 'US¢/libra',
    unidadeBR: 'R$/@ (15kg)',
    converterParaBR: (preco, cambio) => (preco / 100) * cambio * 15 / 0.453592,
    formatarOriginal: (v) => `${v.toFixed(2)} US¢/lb`,
  },
  trigo: {
    ticker: 'ZW=F',
    nome: 'Trigo',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bushel',
    unidadeBR: 'R$/sc 60kg',
    // 1 bushel de trigo = 27.2155 kg
    converterParaBR: (preco, cambio) => (preco / 100) * cambio * (27.2155 / 60),
    formatarOriginal: (v) => `${v.toFixed(2)} US¢/bu`,
  },
};

async function fetchYahooPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Sem dados para ' + ticker);
  // Usar regularMarketPrice do meta (preço mais recente disponível)
  const price = result.meta?.regularMarketPrice;
  if (!price) throw new Error('Preço não encontrado para ' + ticker);
  return price;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const cultura = url.searchParams.get('cultura');

  // Permite buscar todas as culturas de uma vez (para o dashboard)
  const culturasSolicitadas = cultura
    ? [cultura]
    : Object.keys(CULTURAS_CONFIG);

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800', // cache 15min
    'Access-Control-Allow-Origin': '*',
  };

  try {
    // Buscar câmbio USD/BRL sempre
    const cambio = await fetchYahooPrice('USDBRL=X');

    const resultados = {};

    await Promise.allSettled(
      culturasSolicitadas.map(async (c) => {
        const cfg = CULTURAS_CONFIG[c];
        if (!cfg) return;
        try {
          const precoOriginal = await fetchYahooPrice(cfg.ticker);
          const valorBR = cfg.converterParaBR(precoOriginal, cambio);
          resultados[c] = {
            ticker: cfg.ticker,
            bolsa: cfg.bolsa,
            nome: cfg.nome,
            precoOriginal,
            precoOriginalFormatado: cfg.formatarOriginal(precoOriginal),
            unidadeOriginal: cfg.unidadeOriginal,
            valorBR: Math.round(valorBR * 100) / 100,
            unidadeBR: cfg.unidadeBR,
            cambio: Math.round(cambio * 4) / 4,
            timestamp: new Date().toISOString(),
            ok: true,
          };
        } catch (err) {
          resultados[c] = { ok: false, erro: err.message, nome: cfg.nome };
        }
      })
    );

    return new Response(
      JSON.stringify({ ok: true, cambio, culturas: resultados }),
      { headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, erro: err.message }),
      { status: 500, headers }
    );
  }
}