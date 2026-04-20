import { useState, useEffect, useCallback } from 'react'

// Códigos WMO → condição legível e ícone simples
const WMO_MAP = {
  0:  { label: 'Céu limpo',      icon: 'sun' },
  1:  { label: 'Poucas nuvens',  icon: 'sun' },
  2:  { label: 'Parcialmente nublado', icon: 'cloud-sun' },
  3:  { label: 'Nublado',        icon: 'cloud' },
  45: { label: 'Neblina',        icon: 'cloud' },
  48: { label: 'Geada',          icon: 'cloud' },
  51: { label: 'Garoa leve',     icon: 'cloud-rain' },
  53: { label: 'Garoa',          icon: 'cloud-rain' },
  55: { label: 'Garoa forte',    icon: 'cloud-rain' },
  61: { label: 'Chuva leve',     icon: 'cloud-rain' },
  63: { label: 'Chuva',          icon: 'cloud-rain' },
  65: { label: 'Chuva forte',    icon: 'cloud-rain' },
  71: { label: 'Neve leve',      icon: 'cloud-rain' },
  73: { label: 'Neve',           icon: 'cloud-rain' },
  75: { label: 'Neve forte',     icon: 'cloud-rain' },
  80: { label: 'Pancadas leves', icon: 'cloud-rain' },
  81: { label: 'Pancadas',       icon: 'cloud-rain' },
  82: { label: 'Pancadas fortes',icon: 'cloud-rain' },
  95: { label: 'Trovoada',       icon: 'storm' },
  96: { label: 'Trovoada c/ granizo', icon: 'storm' },
  99: { label: 'Trovoada c/ granizo forte', icon: 'storm' },
}

function wmo(code) {
  return WMO_MAP[code] || { label: 'Variável', icon: 'cloud' }
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

// Busca previsão 7 dias + histórico 15 dias via Open-Meteo
async function fetchOpenMeteo(lat, lng) {
  const hoje = new Date()

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min,weathercode',
    timezone: 'America/Sao_Paulo',
    forecast_days: 7,
    past_days: 15,
  })

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error('Open-Meteo indisponível')
  const json = await res.json()

  const dias = json.daily.time.map((data, i) => ({
    data,
    tempMax: Math.round(json.daily.temperature_2m_max[i] ?? 0),
    tempMin: Math.round(json.daily.temperature_2m_min[i] ?? 0),
    precipitacao: Math.round((json.daily.precipitation_sum[i] ?? 0) * 10) / 10,
    wmoCode: json.daily.weathercode[i] ?? 0,
    condicao: wmo(json.daily.weathercode[i] ?? 0),
    ehFuturo: data >= formatDate(hoje),
  }))

  const historico = dias.filter(d => !d.ehFuturo)
  const previsao  = dias.filter(d => d.ehFuturo)
  const precipAcumulada15d = historico.reduce((s, d) => s + d.precipitacao, 0)

  return { previsao, historico, precipAcumulada15d }
}

// Busca alertas INMET Alert-AS
async function fetchAlertasINMET() {
  try {
    const res = await fetch('https://apialerta.inmet.gov.br/v3/alertas')
    if (!res.ok) return []
    const alertas = await res.json()
    if (!Array.isArray(alertas)) return []
    return alertas
      .filter(a => a.DS_SEVERIDADE && a.DS_EVENTO)
      .map(a => ({
        id: a.CD_AVISO || Math.random().toString(36),
        evento: a.DS_EVENTO || '',
        severidade: a.DS_SEVERIDADE || '',
        descricao: a.DS_DETALHE || '',
        inicio: a.DT_INI_PREV || '',
        fim: a.DT_FIM_PREV || '',
        grave: ['Perigo', 'Perigo Potencial'].some(s => (a.DS_SEVERIDADE || '').includes(s)),
      }))
      .slice(0, 5)
  } catch {
    return []
  }
}

// Hook principal — recebe array de propriedades com { id, nome, lat, lng }
export function useClima(propriedades = []) {
  const [clima, setClima] = useState({})

  const carregar = useCallback(async () => {
    if (!propriedades.length) return
    const inicial = {}
    propriedades.forEach(p => {
      inicial[p.id] = { previsao: [], historico: [], alertas: [], precipAcumulada15d: 0, loading: true, erro: null }
    })
    setClima(inicial)

    await Promise.allSettled(
      propriedades.map(async (prop) => {
        if (!prop.lat || !prop.lng) {
          setClima(prev => ({ ...prev, [prop.id]: { ...prev[prop.id], loading: false, erro: 'Sem coordenadas' } }))
          return
        }
        try {
          const [{ previsao, historico, precipAcumulada15d }, alertas] = await Promise.all([
            fetchOpenMeteo(prop.lat, prop.lng),
            fetchAlertasINMET(),
          ])
          setClima(prev => ({
            ...prev,
            [prop.id]: { previsao, historico, alertas, precipAcumulada15d, loading: false, erro: null }
          }))
        } catch (err) {
          setClima(prev => ({
            ...prev,
            [prop.id]: { previsao: [], historico: [], alertas: [], precipAcumulada15d: 0, loading: false, erro: err.message }
          }))
        }
      })
    )
  }, [JSON.stringify(propriedades.map(p => p.id))])

  useEffect(() => {
    carregar()
    const intervalo = setInterval(carregar, 3 * 60 * 60 * 1000)
    return () => clearInterval(intervalo)
  }, [carregar])

  return clima
}

// Helper: dias bons para colheita (precipitação < 2mm)
export function diasBonsParaColheita(previsao = []) {
  return previsao.filter(d => d.precipitacao < 2).length
}

// Helper: nome curto do dia da semana
export function nomeDiaSemana(dataStr, curto = true) {
  const dias = curto
    ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
    : ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  const [y, m, d] = dataStr.split('-').map(Number)
  const data = new Date(y, m - 1, d)
  return dias[data.getDay()]
}
