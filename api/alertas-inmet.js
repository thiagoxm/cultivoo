// api/alertas-inmet.js — Vercel Edge Function
// Proxy para alertas meteorológicos do INMET via RSS/CAP
// Consome o feed RSS público do INMET, converte XML → JSON
// e retorna no formato esperado pelo useClima.js
//
// Parâmetros opcionais (para debug/logging):
//   ?municipio=Sorriso&estado=MT

export const config = { runtime: 'edge' }

// ── Extrai o conteúdo de uma tag XML (primeira ocorrência) ────────────────
function getTag(xml, tag) {
  // Suporta tags simples e tags com namespace (ex: cap:severity)
  const tagEscaped = tag.replace(':', '\\:')
  const re = new RegExp(`<${tagEscaped}[^>]*>([\\s\\S]*?)<\\/${tagEscaped}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : ''
}

// ── Extrai todas as ocorrências de um bloco de tag ───────────────────────
function getAllBlocks(xml, tag) {
  const tagEscaped = tag.replace(':', '\\:')
  const re = new RegExp(`<${tagEscaped}[^>]*>[\\s\\S]*?<\\/${tagEscaped}>`, 'gi')
  return xml.match(re) || []
}

// ── Infere severidade a partir do título do item RSS ─────────────────────
// Título típico: "Aviso de Chuvas Intensas. Severidade Grau: Perigo"
function extrairSeveridade(titulo, capSeverity) {
  // Preferir campo CAP se disponível
  if (capSeverity) {
    const s = capSeverity.toLowerCase()
    if (s === 'extreme') return 'Perigo'
    if (s === 'severe') return 'Perigo'
    if (s === 'moderate') return 'Perigo Potencial'
    if (s === 'minor') return 'Atenção'
    return 'Atenção'
  }
  // Fallback: lê do título
  if (titulo.includes('Perigo Potencial')) return 'Perigo Potencial'
  if (titulo.includes('Perigo')) return 'Perigo'
  if (titulo.includes('Atenção')) return 'Atenção'
  if (titulo.includes('Moderate')) return 'Perigo Potencial'
  if (titulo.includes('Extreme') || titulo.includes('Severe')) return 'Perigo'
  return 'Atenção'
}

// ── Infere evento a partir do título ─────────────────────────────────────
// Título: "Aviso de Chuvas Intensas. Severidade Grau: Perigo"
// Queremos: "Chuvas Intensas"
function extrairEvento(titulo, capEvent) {
  if (capEvent) return capEvent
  const m = titulo.match(/Aviso\s+de\s+(.+?)\.\s*Severidade/i)
  if (m) return m[1].trim()
  // Fallback: retorna o título limpo
  return titulo.split('.')[0].replace(/^Aviso\s+de\s+/i, '').trim() || titulo
}

// ── Extrai ID numérico do link do aviso ──────────────────────────────────
function extrairId(link) {
  const m = link.match(/\/(\d+)\s*$/)
  return m ? m[1] : Math.random().toString(36).slice(2)
}

// ── Extrai lista de mesorregões do campo description ─────────────────────
// A descrição contém as mesorregões antes ou depois do texto do aviso
// Formato típico: "Aviso para as Áreas: Sul Goiano, Norte Goiano, ..."
function extrairMesoRegioes(descricao) {
  const m = descricao.match(/Aviso\s+para\s+as\s+[Áá]reas?:\s*([^.]+)/i)
  if (!m) return ''
  return m[1].trim()
}

// ── Converte data de aviso para ISO quando possível ──────────────────────
// Formato INMET: "DD/MM/YYYY HH:MM" ou ISO já pronto
function normalizarData(str) {
  if (!str) return ''
  // Já é ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str
  // Formato "DD/MM/YYYY HH:MM"
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:00-03:00`
  return str
}

// ── Extrai data de início do texto da descrição ───────────────────────────
// Texto: "INMET publica aviso iniciando em: 24/03/2026 10:16"
function extrairDataInicio(descricao) {
  const m = descricao.match(/iniciando\s+em:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i)
  return m ? normalizarData(m[1]) : ''
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=10800', // cache 3h na Vercel
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const res = await fetch('https://apiprevmet3.inmet.gov.br/avisos/rss', {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'Cultivoo/1.0 (agro management app)',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, alertas: [], erro: `INMET retornou ${res.status}` }),
        { status: 200, headers }
      )
    }

    const xml = await res.text()

    // ── Extrai todos os <item> do RSS ─────────────────────────────────────
    const itemBlocks = getAllBlocks(xml, 'item')

    const alertas = itemBlocks.map(item => {
      const titulo     = getTag(item, 'title')
      const link       = getTag(item, 'link')
      const descricao  = getTag(item, 'description')
      const pubDate    = getTag(item, 'pubDate')

      // Campos CAP opcionais (podem estar presentes no RSS estendido)
      const capEvent    = getTag(item, 'cap:event')
      const capSeverity = getTag(item, 'cap:severity')
      const capOnset    = getTag(item, 'cap:onset')
      const capExpires  = getTag(item, 'cap:expires')
      const capAreaDesc = getTag(item, 'cap:areaDesc')

      const severidade  = extrairSeveridade(titulo, capSeverity)
      const evento      = extrairEvento(titulo, capEvent)
      const id          = extrairId(link)

      // Datas: preferir CAP, senão extrair da descrição
      const dtInicio = capOnset
        ? normalizarData(capOnset)
        : extrairDataInicio(descricao)

      const dtFim = capExpires
        ? normalizarData(capExpires)
        : ''

      // Mesorregões: preferir CAP areaDesc, senão extrair da descrição
      const mesoRegioes = capAreaDesc || extrairMesoRegioes(descricao)

      // Monta objeto compatível com useClima.js / mapearAlertas()
      return {
        CD_AVISO:     id,
        DS_EVENTO:    evento,
        DS_SEVERIDADE: severidade,
        DS_DETALHE:   descricao,
        DT_INI_PREV:  dtInicio,
        DT_FIM_PREV:  dtFim,
        DS_MUNICIPIOS: mesoRegioes, // mesorregões — usadas para filtro geográfico
        // Campo auxiliar para debug
        _titulo:      titulo,
        _pubDate:     pubDate,
      }
    }).filter(a => a.DS_EVENTO && a.DS_SEVERIDADE)

    return new Response(
      JSON.stringify({ ok: true, alertas }),
      { status: 200, headers }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, alertas: [], erro: err.message }),
      { status: 200, headers }
    )
  }
}
