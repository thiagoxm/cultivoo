// Node.js serverless (não edge) — acesso de rede irrestrito
export default async function handler(req, res) {
  try {
    const response = await fetch('https://apialerta.inmet.gov.br/v3/alertas', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    })
    const status = response.status
    const contentType = response.headers.get('content-type') || ''
    const raw = await response.text()

    let parsed = null
    let parseErr = null
    try { parsed = JSON.parse(raw) } catch(e) { parseErr = e.message }

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.json({
      httpStatus: status,
      contentType,
      rawLength: raw.length,
      rawPreview: raw.substring(0, 500),
      parseErr,
      total: Array.isArray(parsed) ? parsed.length : null,
      keys: parsed?.[0] ? Object.keys(parsed[0]) : null,
      sample: Array.isArray(parsed) ? parsed.slice(0, 2) : parsed,
    })
  } catch (err) {
    res.status(500).json({ erro: err.message, stack: err.stack?.substring(0, 500) })
  }
}
