export const config = { runtime: 'edge' }

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }
  try {
    const res = await fetch('https://apialerta.inmet.gov.br/v3/alertas', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    })
    const status = res.status
    const contentType = res.headers.get('content-type') || ''
    const raw = await res.text()

    let parsed = null
    let parseErr = null
    try { parsed = JSON.parse(raw) } catch(e) { parseErr = e.message }

    return new Response(JSON.stringify({
      httpStatus: status,
      contentType,
      rawLength: raw.length,
      rawPreview: raw.substring(0, 500),
      parseErr,
      total: Array.isArray(parsed) ? parsed.length : null,
      keys: parsed?.[0] ? Object.keys(parsed[0]) : null,
      sample: Array.isArray(parsed) ? parsed.slice(0, 2) : parsed,
    }, null, 2), { headers })
  } catch (err) {
    return new Response(JSON.stringify({
      erro: err.message,
      stack: err.stack?.substring(0, 300),
    }), { status: 500, headers })
  }
}
