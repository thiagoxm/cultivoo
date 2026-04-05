// api/cotacao.js — Vercel Edge Function
// Cotações de commodities via Yahoo Finance → converte para R$/unidade BR
//
// FÓRMULA CORRETA (verificada e corrigida em 04/04/2026):
// US¢/bushel → R$/saca (60kg):
//   R$/sc = (centavos ÷ 100) × (60 ÷ kg_por_bushel) × câmbio_BRL
//
// Exemplos:
//   Milho CBOT = 450 US¢/bu → US$ 4,50/bu
//   US$/saca = 4,50 × (60 ÷ 25,401) = 4,50 × 2,362 = 10,63 US$/sc
//   R$/saca (cambio 5,80) = 10,63 × 5,80 = 61,65 R$/sc
//
//   Soja CBOT = 1174 US¢/bu → US$ 11,74/bu
//   R$/saca = 11,74 × (60 ÷ 27,216) × 5,80 = 150,11 R$/sc
//
// ERROS ANTERIORES (para referência):
//   Soja, milho e trigo tinham o fator INVERTIDO: (kg/60) ao invés de (60/kg)
//   Café, algodão e boi estavam corretos.

export const config = { runtime: 'edge' }

const CULTURAS = {
  soja: {
    ticker: 'ZS=F',
    bolsa: 'CBOT Chicago',
    unidBR: 'R$/sc',
    orig: 'US¢/bu',
    // 1 bushel soja = 27,216 kg → sacas/bu = 60/27,216 = 2,205
    conv: (p, fx) => (p / 100) * (60 / 27.216) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  milho: {
    ticker: 'ZC=F',
    bolsa: 'CBOT Chicago',
    unidBR: 'R$/sc',
    orig: 'US¢/bu',
    // 1 bushel milho = 25,401 kg → sacas/bu = 60/25,401 = 2,362
    conv: (p, fx) => (p / 100) * (60 / 25.401) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  cafe: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidBR: 'R$/sc',
    orig: 'US¢/lb',
    // 1 libra = 0,453592 kg → 1 saca 60kg = 60/0,453592 = 132,277 libras
    conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx,
    fmt: p => `${p.toFixed(2)} US¢/lb`,
  },
  cafe_arabica: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidBR: 'R$/sc',
    orig: 'US¢/lb',
    conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx,
    fmt: p => `${p.toFixed(2)} US¢/lb`,
  },
  cafe_conilon: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidBR: 'R$/sc',
    orig: 'US¢/lb',
    conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx,
    fmt: p => `${p.toFixed(2)} US¢/lb`,
  },
  trigo: {
    ticker: 'ZW=F',
    bolsa: 'CBOT Chicago',
    unidBR: 'R$/sc',
    orig: 'US¢/bu',
    // 1 bushel trigo = 27,216 kg (mesmo que soja)
    conv: (p, fx) => (p / 100) * (60 / 27.216) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  algodao: {
    ticker: 'CT=F',
    bolsa: 'ICE',
    unidBR: 'R$/@',
    orig: 'US¢/lb',
    // 1 arroba = 15 kg = 15/0,453592 = 33,069 libras
    conv: (p, fx) => (p / 100) * (15 / 0.453592) * fx,
    fmt: p => `${p.toFixed(2)} US¢/lb`,
  },
  boi_gordo: {
    ticker: 'LE=F',
    bolsa: 'CME',
    unidBR: 'R$/@',
    orig: 'US$/cwt',
    // Boi cotado em US$/cwt (100 libras = 45,359 kg); 1 arroba = 15 kg
    // ATENÇÃO: LE=F retorna em dólares (não centavos), sem dividir por 100
    conv: (p, fx) => p * (45.359 / 15) * fx,
    fmt: p => `${p.toFixed(2)} US$/cwt`,
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
  if (!preco) throw new Error(`Sem preço para ${ticker}`)
  return preco
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    // Câmbio USD/BRL
    const cambio = await fetchPreco('USDBRL=X')

    // Buscar tickers únicos (café usa o mesmo para 3 culturas)
    const tickersUnicos = [...new Set(Object.values(CULTURAS).map(c => c.ticker))]
    const precosPorTicker = {}
    await Promise.allSettled(
      tickersUnicos.map(async ticker => {
        try { precosPorTicker[ticker] = await fetchPreco(ticker) }
        catch { precosPorTicker[ticker] = null }
      })
    )

    const resultados = {}
    for (const [key, cfg] of Object.entries(CULTURAS)) {
      const preco = precosPorTicker[cfg.ticker]
      if (preco == null) {
        resultados[key] = { ok: false, erro: `Preço indisponível para ${cfg.ticker}` }
        continue
      }
      const valorBR = cfg.conv(preco, cambio)
      resultados[key] = {
        ok: true,
        ticker: cfg.ticker,
        bolsa: cfg.bolsa,
        precoOriginal: preco,
        precoOriginalFormatado: cfg.fmt(preco),
        unidadeOriginal: cfg.orig,
        valorBR: Math.round(valorBR * 100) / 100,
        unidadeBR: cfg.unidBR,
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