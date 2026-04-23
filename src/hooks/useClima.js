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
  63: { label: 'Chuva',         icon: 'cloud-rain' },
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

// ── Busca geocódigo IBGE de um município pelo nome ────────────────────────
// Cache em memória para evitar chamadas repetidas
const geocodigoCache = {}

async function fetchGeocodigo(cidade, estado) {
  if (!cidade) return null
  const chave = `${cidade}|${estado}`.toLowerCase()
  if (geocodigoCache[chave] !== undefined) return geocodigoCache[chave]

  try {
    // Busca pelo nome da cidade na API de localidades do IBGE
    const nomeLimpo = encodeURIComponent(cidade.trim())
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?nome=${nomeLimpo}`
    )
    if (!res.ok) { geocodigoCache[chave] = null; return null }
    const lista = await res.json()
    if (!Array.isArray(lista) || lista.length === 0) { geocodigoCache[chave] = null; return null }

    // Tentar filtrar pelo estado se disponível
    let municipio = lista[0]
    if (estado && lista.length > 1) {
      const siglaUF = estado.length === 2
        ? estado.toUpperCase()
        : null // se vier nome completo, ignora o filtro
      if (siglaUF) {
        const filtrado = lista.find(m =>
          m?.microrregiao?.mesorregiao?.UF?.sigla?.toUpperCase() === siglaUF
        )
        if (filtrado) municipio = filtrado
      }
    }

    // Geocódigo IBGE tem 7 dígitos — pegamos os 6 primeiros para comparação flexível
    const codigo = String(municipio.id)
    geocodigoCache[chave] = codigo
    return codigo
  } catch {
    geocodigoCache[chave] = null
    return null
  }
}

// ── Verifica se um alerta do INMET cobre um município ────────────────────
// A estrutura do JSON do INMET não é pública — testamos defensivamente
// os campos mais prováveis baseado em outros projetos que usam a API
function alertaCobreMunicipio(alerta, geocodigo) {
  if (!geocodigo) return true // sem geocódigo → exibe tudo (fallback seguro)

  const codigo6 = geocodigo.substring(0, 6)
  const codigo7 = geocodigo

  // Campos possíveis onde o INMET guarda os geocódigos dos municípios
  const camposMunicipio = [
    alerta.CD_GEOCODIGO,
    alerta.geocodigo,
    alerta.municipio_geocodigo,
  ]

  // Campos de lista/texto com múltiplos municípios
  const camposTexto = [
    alerta.DS_MUNICIPIOS,
    alerta.municipios,
    alerta.DS_AREA,
    alerta.area,
  ]

  // Verificar campos diretos de geocódigo
  for (const campo of camposMunicipio) {
    if (!campo) continue
    if (Array.isArray(campo)) {
      if (campo.some(c => String(c).startsWith(codigo6))) return true
    } else {
      const str = String(campo)
      if (str.startsWith(codigo6) || str.startsWith(codigo7)) return true
    }
  }

  // Verificar campos de texto que podem conter o geocódigo ou nome
  for (const campo of camposTexto) {
    if (!campo) continue
    const str = String(campo)
    if (str.includes(codigo6) || str.includes(codigo7)) return true
  }

  // Se nenhum campo de município foi encontrado no alerta,
  // significa que a API não retorna esse dado → exibir tudo
  const temCampoMunicipio = [...camposMunicipio, ...camposTexto].some(c => c != null)
  if (!temCampoMunicipio) return true

  return false
}

// ── Calcula status do alerta (em vigor / previsto) ───────────────────────
function calcularStatusAlerta(inicio, fim) {
  if (!inicio) return { status: 'previsto', label: null }

  try {
    const agora = new Date()
    const dtInicio = new Date(inicio)
    const dtFim = fim ? new Date(fim) : null

    const emVigor = dtInicio <= agora && (!dtFim || dtFim >= agora)

    if (emVigor) {
      const labelFim = dtFim
        ? dtFim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : null
      return {
        status: 'vigor',
        label: labelFim ? `Em vigor até ${labelFim}` : 'Em vigor',
      }
    } else {
      const labelInicio = dtInicio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      const labelFim = dtFim
        ? dtFim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : null
      return {
        status: 'previsto',
        label: labelFim ? `Previsto: ${labelInicio} → ${labelFim}` : `Previsto: ${labelInicio}`,
      }
    }
  } catch {
    return { status: 'previsto', label: null }
  }
}

// ── Cache global de alertas INMET ─────────────────────────────────────────
// Uma única chamada para todas as propriedades, renovada a cada 3h
let alertasCache = { dados: null, ts: 0 }
const CACHE_TTL_MS = 3 * 60 * 60 * 1000 // 3 horas

async function fetchAlertasINMET() {
  const agora = Date.now()
  if (alertasCache.dados && agora - alertasCache.ts < CACHE_TTL_MS) {
    return alertasCache.dados
  }

  try {
    const res = await fetch('https://apialerta.inmet.gov.br/v3/alertas')
    if (!res.ok) return alertasCache.dados || []
    const alertas = await res.json()
    if (!Array.isArray(alertas)) return alertasCache.dados || []

    alertasCache = { dados: alertas, ts: agora }
    return alertas
  } catch {
    return alertasCache.dados || []
  }
}

// ── Filtra e mapeia alertas para uma propriedade específica ───────────────
function mapearAlertas(alertasRaw, geocodigo) {
  return alertasRaw
    .filter(a => a.DS_SEVERIDADE && a.DS_EVENTO)
    .filter(a => alertaCobreMunicipio(a, geocodigo))
    .map(a => {
      const { status, label } = calcularStatusAlerta(a.DT_INI_PREV, a.DT_FIM_PREV)
      return {
        id: a.CD_AVISO || Math.random().toString(36),
        evento: a.DS_EVENTO || '',
        severidade: a.DS_SEVERIDADE || '',
        descricao: a.DS_DETALHE || '',
        inicio: a.DT_INI_PREV || '',
        fim: a.DT_FIM_PREV || '',
        grave: ['Perigo', 'Perigo Potencial'].some(s => (a.DS_SEVERIDADE || '').includes(s)),
        status,           // 'vigor' | 'previsto'
        statusLabel: label, // ex: "Em vigor até 23/04 18:00" ou "Previsto: 24/04 06:00 → 24/04 18:00"
      }
    })
    // Ordenar: em vigor primeiro, depois por data de início
    .sort((a, b) => {
      if (a.status === 'vigor' && b.status !== 'vigor') return -1
      if (b.status === 'vigor' && a.status !== 'vigor') return 1
      return (a.inicio || '').localeCompare(b.inicio || '')
    })
}

// ── Open-Meteo ───────────────────────────────────────────────────────────
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

  return {
    previsao: dias.filter(d => d.ehFuturo),
    historico: dias.filter(d => !d.ehFuturo),
    precipAcumulada15d: dias.filter(d => !d.ehFuturo).reduce((s, d) => s + d.precipitacao, 0),
  }
}

// ── Hook principal ────────────────────────────────────────────────────────
// Recebe array de propriedades com { id, nome, lat, lng, cidade, estado }
export function useClima(propriedades = []) {
  const [clima, setClima] = useState({})

  const carregar = useCallback(async () => {
    if (!propriedades.length) return

    // Estado inicial de loading
    const inicial = {}
    propriedades.forEach(p => {
      inicial[p.id] = { previsao: [], historico: [], alertas: [], precipAcumulada15d: 0, loading: true, erro: null }
    })
    setClima(inicial)

    // 1. Buscar alertas uma única vez para todas as propriedades
    const alertasRaw = await fetchAlertasINMET()

    // 2. Buscar geocódigos e dados de clima em paralelo
    await Promise.allSettled(
      propriedades.map(async (prop) => {
        if (!prop.lat || !prop.lng) {
          setClima(prev => ({ ...prev, [prop.id]: { ...prev[prop.id], loading: false, erro: 'Sem coordenadas' } }))
          return
        }
        try {
          // Geocódigo e Open-Meteo em paralelo
          const [{ previsao, historico, precipAcumulada15d }, geocodigo] = await Promise.all([
            fetchOpenMeteo(prop.lat, prop.lng),
            fetchGeocodigo(prop.cidade, prop.estado),
          ])

          const alertas = mapearAlertas(alertasRaw, geocodigo)

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

// ── Helpers exportados ────────────────────────────────────────────────────
export function diasBonsParaColheita(previsao = []) {
  return previsao.filter(d => d.precipitacao < 2).length
}

export function nomeDiaSemana(dataStr, curto = true) {
  const dias = curto
    ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
    : ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  const [y, m, d] = dataStr.split('-').map(Number)
  return dias[new Date(y, m - 1, d).getDay()]
}
