// api/cotacao.js — Vercel Edge Function
// Cotações de commodities via Yahoo Finance → converte para R$/unidade BR
//
// Suporta parâmetros opcionais:
//   ?cultura=soja         → retorna histórico só desta cultura (mais rápido)
//   ?periodo=1M           → range do histórico: 1D, 5D, 1M, 6M, YTD, 1Y, 5Y, All
//
// FÓRMULA CORRETA (verificada e corrigida em 04/04/2026):
// US¢/bushel → R$/saca (60kg):
//   R$/sc = (centavos ÷ 100) × (60 ÷ kg_por_bushel) × câmbio_BRL

export const config = { runtime: 'edge' }

const CULTURAS = {
  soja: {
    ticker: 'ZS=F',
    bolsa: 'CBOT Chicago',
    unidBR: 'R$/sc',
    orig: 'US¢/bu',
    conv: (p, fx) => (p / 100) * (60 / 27.216) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  milho: {
    ticker: 'ZC=F',
    bolsa: 'CBOT Chicago',
    unidBR: 'R$/sc',
    orig: 'US¢/bu',
    conv: (p, fx) => (p / 100) * (60 / 25.401) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  cafe: {
    ticker: 'KC=F',
    bolsa: 'ICE Nova York',
    unidBR: 'R$/sc',
    orig: 'US¢/lb',
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
    conv: (p, fx) => (p / 100) * (60 / 27.216) * fx,
    fmt: p => `${p.toFixed(2)} US¢/bu`,
  },
  algodao: {
    ticker: 'CT=F',
    bolsa: 'ICE',
    unidBR: 'R$/@',
    orig: 'US¢/lb',
    conv: (p, fx) => (p / 100) * (15 / 0.453592) * fx,
    fmt: p => `${p.toFixed(2)} US¢/lb`,
  },
  boi_gordo: {
    ticker: 'LE=F',
    bolsa: 'CME',
    unidBR: 'R$/@',
    orig: 'US$/cwt',
    conv: (p, fx) => p * (45.359 / 15) * fx,
    fmt: p => `${p.toFixed(2)} US$/cwt`,
  },
}

// Mapeamento de período → { range, interval } do Yahoo Finance
const PERIODO_CONFIG = {
  '1D':  { range: '1d',  interval: '5m'  },
  '5D':  { range: '5d',  interval: '30m' },
  '1M':  { range: '1mo', interval: '1d'  },
  '6M':  { range: '6mo', interval: '1wk' },
  'YTD': { range: 'ytd', interval: '1d'  },
  '1Y':  { range: '1y',  interval: '1wk' },
  '5Y':  { range: '5y',  interval: '1mo' },
  'All': { range: 'max', interval: '3mo' },
}

const HEADERS_YAHOO = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
}

async function fetchPreco(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d&includePrePost=false`
  const res = await fetch(url, { headers: HEADERS_YAHOO })
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${ticker}`)
  const data = await res.json()
  const preco = data?.chart?.result?.[0]?.meta?.regularMarketPrice
  if (!preco) throw new Error(`Sem preço para ${ticker}`)
  return preco
}

async function fetchHistorico(ticker, periodo = '1M') {
  const cfg = PERIODO_CONFIG[periodo] || PERIODO_CONFIG['1M']
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${cfg.range}&interval=${cfg.interval}&includePrePost=false`
  try {
    const res = await fetch(url, { headers: HEADERS_YAHOO })
    if (!res.ok) return []
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return []

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    const opens = result.indicators?.quote?.[0]?.open || []
    const highs = result.indicators?.quote?.[0]?.high || []
    const lows = result.indicators?.quote?.[0]?.low || []

    // Para 1D, formatar como hora; para os demais, como data
    const ehIntraday = cfg.interval === '5m' || cfg.interval === '30m'

    return timestamps
      .map((ts, i) => ({
        ts,
        label: ehIntraday
          ? new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: periodo === '5Y' || periodo === 'All' ? '2-digit' : undefined }),
        close: closes[i],
        open: opens[i],
        high: highs[i],
        low: lows[i],
      }))
      .filter(h => h.close != null)
  } catch {
    return []
  }
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const { searchParams } = new URL(req.url)
    const culturaFiltro = searchParams.get('cultura') // ex: 'soja'
    const periodo = searchParams.get('periodo') || '1M'

    // Câmbio USD/BRL
    const cambio = await fetchPreco('USDBRL=X')

    // Filtrar culturas se solicitado
    const culturasFiltradas = culturaFiltro
      ? Object.fromEntries(Object.entries(CULTURAS).filter(([k]) => k === culturaFiltro))
      : CULTURAS

    // Tickers únicos das culturas filtradas
    const tickersUnicos = [...new Set(Object.values(culturasFiltradas).map(c => c.ticker))]

    // Buscar preços atuais e histórico em paralelo
    const [precosPorTicker, historicoPorTicker] = await Promise.all([
      Promise.allSettled(
        tickersUnicos.map(async ticker => {
          try { return [ticker, await fetchPreco(ticker)] }
          catch { return [ticker, null] }
        })
      ).then(results => Object.fromEntries(results.map(r => r.value || []))),

      Promise.allSettled(
        tickersUnicos.map(async ticker => {
          const hist = await fetchHistorico(ticker, periodo)
          return [ticker, hist]
        })
      ).then(results => Object.fromEntries(results.map(r => r.value || []))),
    ])

    const resultados = {}
    for (const [key, cfg] of Object.entries(culturasFiltradas)) {
      const preco = precosPorTicker[cfg.ticker]
      if (preco == null) {
        resultados[key] = { ok: false, erro: `Preço indisponível para ${cfg.ticker}` }
        continue
      }

      const valorBR = cfg.conv(preco, cambio)
      const historicoRaw = historicoPorTicker[cfg.ticker] || []

      // Converter histórico inteiro para R$/unidade BR
      const historico = historicoRaw.map(h => ({
        ts: h.ts,
        label: h.label,
        valor: Math.round(cfg.conv(h.close, cambio) * 100) / 100,
        // open/high/low também convertidos (úteis para futuras velas)
        valorOpen: h.open != null ? Math.round(cfg.conv(h.open, cambio) * 100) / 100 : null,
        valorHigh: h.high != null ? Math.round(cfg.conv(h.high, cambio) * 100) / 100 : null,
        valorLow: h.low != null ? Math.round(cfg.conv(h.low, cambio) * 100) / 100 : null,
      }))

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
        periodo,
        historico,
      }
    }

    return new Response(
      JSON.stringify({ ok: true, cambio: Math.round(cambio * 100) / 100, periodo, culturas: resultados }),
      { headers }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, erro: err.message }),
      { status: 500, headers }
    )
  }
}
