// api/cotacao.js — Vercel Edge Function
// Busca cotações de commodities no Yahoo Finance e converte para R$/unidade BR
//
// IMPORTANTE — Fórmula de conversão:
// O Yahoo Finance retorna preços de grãos em US¢/bushel (CENTAVOS de dólar, não dólares).
// Exemplo: ZC=F (milho) retorna 458.75, que significa US$ 4.5875/bushel.
//
// Conversão padrão para R$/saca (60kg):
//   R$/sc = (preço_em_centavos ÷ 100) × câmbio_USD_BRL × (kg_por_bushel ÷ 60)
//
// Fatores oficiais (CBOT/USDA):
//   Soja:  1 bushel = 27.216 kg → fator = 27.216 / 60 = 0.4536
//   Milho: 1 bushel = 25.401 kg → fator = 25.401 / 60 = 0.4234  ← CORRIGIDO
//   Trigo: 1 bushel = 27.216 kg → fator = 27.216 / 60 = 0.4536
//
// Café ICE NY (KC=F): cotado em US¢/libra.
//   1 saca de 60kg = 132.277 libras → R$/sc = (p/100) × cambio × 132.277

export const config = { runtime: 'edge' }

const CULTURAS = {
  soja: {
    ticker: 'ZS=F',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bu',
    unidadeBR: 'R$/sc',
    // (centavos ÷ 100) × cambio × (27.216 kg/bu ÷ 60 kg/sc)
    converter: (preco, cambio) => (preco / 100) * cambio * (27.216 / 60),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/bu`,
  },
  milho: {
    ticker: 'ZC=F',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bu',
    unidadeBR: 'R$/sc',
    // (centavos ÷ 100) × cambio × (25.401 kg/bu ÷ 60 kg/sc)
    // Milho tem bushel MENOR que soja (25.4 vs 27.2 kg), então vale menos por saca
    converter: (preco, cambio) => (preco / 100) * cambio * (25.401 / 60),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/bu`,
  },
  cafe: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidadeOriginal: 'US¢/lb',
    unidadeBR: 'R$/sc',
    // Café cotado em centavos de dólar por libra-peso
    // 1 saca café = 60kg = 60 ÷ 0.453592 libras = 132.277 libras
    converter: (preco, cambio) => (preco / 100) * cambio * (60 / 0.453592),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/lb`,
  },
  cafe_arabica: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidadeOriginal: 'US¢/lb',
    unidadeBR: 'R$/sc',
    converter: (preco, cambio) => (preco / 100) * cambio * (60 / 0.453592),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/lb`,
  },
  cafe_conilon: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidadeOriginal: 'US¢/lb',
    unidadeBR: 'R$/sc',
    converter: (preco, cambio) => (preco / 100) * cambio * (60 / 0.453592),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/lb`,
  },
  trigo: {
    ticker: 'ZW=F',
    bolsa: 'CBOT Chicago',
    unidadeOriginal: 'US¢/bu',
    unidadeBR: 'R$/sc',
    converter: (preco, cambio) => (preco / 100) * cambio * (27.216 / 60),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/bu`,
  },
  algodao: {
    ticker: 'CT=F',
    bolsa: 'ICE',
    unidadeOriginal: 'US¢/lb',
    unidadeBR: 'R$/@',
    // Algodão cotado em US¢/libra; arroba = 15kg = 33.069 libras
    converter: (preco, cambio) => (preco / 100) * cambio * (15 / 0.453592),
    formatarOriginal: (p) => `${p.toFixed(2)} US¢/lb`,
  },
  boi_gordo: {
    ticker: 'LE=F',
    bolsa: 'CME',
    unidadeOriginal: 'US$/cwt',
    unidadeBR: 'R$/@',
    // Boi cotado em US$ por cwt (hundredweight = 100 libras = 45.359 kg)
    // 1 arroba = 15kg → arrobas por cwt = 45.359 / 15 = 3.024
    // ATENÇÃO: LE=F retorna em dólares (não centavos), então NÃO dividir por 100
    converter: (preco, cambio) => preco * cambio * (45.359 / 15),
    formatarOriginal: (p) => `${p.toFixed(2)} US$/cwt`,
  },
}

async function fetchPreco(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d&includePrePost=false`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${ticker}`)
  const data = await res.json()
  const preco = data?.chart?.result?.[0]?.meta?.regularMarketPrice
  if (!preco) throw new Error(`Sem preço disponível para ${ticker}`)
  return preco
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800', // cache 15 minutos
    'Access-Control-Allow-Origin': '*',
  }

  const url = new URL(req.url)
  const culturaSolicitada = url.searchParams.get('cultura') // filtro opcional

  try {
    // Câmbio USD/BRL — sempre busca primeiro
    const cambio = await fetchPreco('USDBRL=X')

    const culturasFiltradas = culturaSolicitada && CULTURAS[culturaSolicitada]
      ? { [culturaSolicitada]: CULTURAS[culturaSolicitada] }
      : CULTURAS

    // Tickers únicos para evitar chamadas duplicadas (café usa mesmo ticker em 3 chaves)
    const tickersUnicos = [...new Set(Object.values(culturasFiltradas).map(c => c.ticker))]
    const precosPorTicker = {}
    await Promise.allSettled(
      tickersUnicos.map(async (ticker) => {
        try {
          precosPorTicker[ticker] = await fetchPreco(ticker)
        } catch (err) {
          precosPorTicker[ticker] = null
        }
      })
    )

    const resultados = {}
    for (const [key, cfg] of Object.entries(culturasFiltradas)) {
      const preco = precosPorTicker[cfg.ticker]
      if (preco == null) {
        resultados[key] = { ok: false, erro: `Preço indisponível para ${cfg.ticker}` }
        continue
      }
      const valorBR = cfg.converter(preco, cambio)
      resultados[key] = {
        ok: true,
        ticker: cfg.ticker,
        bolsa: cfg.bolsa,
        precoOriginal: preco,
        precoOriginalFormatado: cfg.formatarOriginal(preco),
        unidadeOriginal: cfg.unidadeOriginal,
        valorBR: Math.round(valorBR * 100) / 100,
        unidadeBR: cfg.unidadeBR,
        cambio: Math.round(cambio * 100) / 100,
        timestamp: new Date().toISOString(),
      }
    }

    return new Response(
      JSON.stringify({ ok: true, cambio: Math.round(cambio * 100) / 100, culturas: resultados }),
      { headers }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, erro: err.message }),
      { status: 500, headers }
    )
  }
}