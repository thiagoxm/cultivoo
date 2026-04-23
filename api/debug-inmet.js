// Endpoint temporário de debug — usa edge runtime (igual ao cotacao.js que funciona)
export const config = { runtime: 'edge' }

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  const urls = [
    'https://apialerta.inmet.gov.br/v3/alertas',
    'https://apialerta.inmet.gov.br/v3/alertas/',
  ]

  const resultados = []

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
      })
      const raw = await res.text()
      let parsed = null
      let parseErr = null
      try { parsed = JSON.parse(raw) } catch (e) { parseErr = e.message }

      resultados.push({
        url,
        httpStatus: res.status,
        contentType: res.headers.get('content-type'),
        rawLength: raw.length,
        rawPreview: raw.substring(0, 500),
        parseErr,
        total: Array.isArray(parsed) ? parsed.length : null,
        keys: parsed?.[0] ? Object.keys(parsed[0]) : null,
        sample: Array.isArray(parsed) ? parsed.slice(0, 2) : parsed,
      })
    } catch (err) {
      resultados.push({ url, erro: err.message })
    }
  }

  return new Response(JSON.stringify(resultados, null, 2), { headers })
}
