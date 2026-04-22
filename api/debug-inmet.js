export const config = { runtime: 'edge' }

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }
  try {
    const res = await fetch('https://apialerta.inmet.gov.br/v3/alertas', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const data = await res.json()
    // Retornar apenas os 2 primeiros alertas com todos os campos
    return new Response(JSON.stringify({
      total: data.length,
      keys: Object.keys(data[0] || {}),
      sample: data.slice(0, 2),
    }, null, 2), { headers })
  } catch (err) {
    return new Response(JSON.stringify({ erro: err.message }), { status: 500, headers })
  }
}
