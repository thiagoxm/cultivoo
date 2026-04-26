import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertCircle, CalendarClock, Wheat,
  TrendingUp, TrendingDown, CheckCircle, X,
  AlertTriangle, BarChart2, Info
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useClima, diasBonsParaColheita, nomeDiaSemana } from '../hooks/useClima'

const HOJE = new Date().toISOString().split('T')[0]
const HOJE_DATE = new Date()
const EM7DIAS = new Date(HOJE_DATE)
EM7DIAS.setDate(HOJE_DATE.getDate() + 7)
const EM7DIAS_STR = EM7DIAS.toISOString().split('T')[0]

function formatarData(str) {
  if (!str) return ''
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}
function formatarValor(v, decimais = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais })
}
function formatarMoeda(v) {
  if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1).replace('.', ',')}M`
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`
  return `R$ ${formatarValor(v, 0)}`
}
function diffDias(dataStr) {
  if (!dataStr) return null
  const [y, m, d] = dataStr.split('-').map(Number)
  return Math.ceil((new Date(y, m - 1, d) - HOJE_DATE) / 86400000)
}
function calcularSaldo(movs) {
  return movs.filter(m => !m.cancelado).reduce((a, m) => {
    if (m.tipoMov === 'entrada') return a + (Number(m.quantidade) || 0)
    if (m.tipoMov === 'saida') return a - (Number(m.quantidade) || 0)
    return a
  }, 0)
}
function validadeMaisCritica(movs) {
  const comValidade = movs.filter(m => m.tipoMov === 'entrada' && !m.cancelado && m.dataValidade)
  if (!comValidade.length) return null
  const vencidos = comValidade.filter(m => m.dataValidade < HOJE)
  if (vencidos.length) return { tipo: 'vencido', dataValidade: vencidos.sort((a, b) => a.dataValidade.localeCompare(b.dataValidade))[0].dataValidade }
  const alertas = comValidade.filter(m => m.dataValidade <= EM7DIAS_STR)
  if (alertas.length) return { tipo: 'alerta', dataValidade: alertas.sort((a, b) => a.dataValidade.localeCompare(b.dataValidade))[0].dataValidade }
  return null
}

function IconeClima({ tipo, size = 16 }) {
  if (tipo === 'sun') return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="4" fill="#EF9F27"/>
      <line x1="9" y1="1" x2="9" y2="3" stroke="#EF9F27" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="9" y2="17" stroke="#EF9F27" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="1" y1="9" x2="3" y2="9" stroke="#EF9F27" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="15" y1="9" x2="17" y2="9" stroke="#EF9F27" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
  if (tipo === 'storm') return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M14 9a4 4 0 10-7.94.9H5a3 3 0 100 6h9a3 3 0 100-6h-.06z" fill="#888780"/>
      <path d="M9 12l-2 4h3l-1 2" stroke="#EF9F27" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (tipo === 'cloud-sun') return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="12" cy="6" r="3" fill="#EF9F27"/>
      <path d="M13 10a3.5 3.5 0 10-6.96.8H5a2.5 2.5 0 000 5h8a2.5 2.5 0 000-5h-.05z" fill="#B4B2A9"/>
    </svg>
  )
  if (tipo === 'cloud-rain') return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M14 9a4 4 0 10-7.94.9H5a3 3 0 100 6h9a3 3 0 100-6h-.06z" fill="#B4B2A9"/>
      <line x1="6" y1="15" x2="5" y2="17" stroke="#378ADD" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="8" y2="17" stroke="#378ADD" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="12" y1="15" x2="11" y2="17" stroke="#378ADD" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M14 9a4 4 0 10-7.94.9H5a3 3 0 100 6h9a3 3 0 100-6h-.06z" fill="#B4B2A9"/>
    </svg>
  )
}

function ClimaStrip({ previsao, modoColheita = false, localRef = '' }) {
  if (!previsao?.length) return (
    <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">Carregando previsão...</div>
  )
  return (
    <div className="bg-gray-50 border-t border-gray-100">
      {localRef && <p className="px-3 pt-1.5 text-[10px] text-gray-400 truncate">📍 {localRef}</p>}
      <div className="flex divide-x divide-gray-100 px-1 py-2 overflow-x-auto">
        {previsao.slice(0, 7).map((d) => {
          const bom = d.precipitacao < 2
          const [, mes, dia] = d.data.split('-')
          return (
            <div key={d.data} className="flex flex-col items-center gap-0.5 flex-1 min-w-[46px] px-1">
              <span className="text-[10px] text-gray-400 leading-tight">{nomeDiaSemana(d.data)}</span>
              <span className="text-[10px] text-gray-300 leading-tight">{dia}/{mes}</span>
              <IconeClima tipo={d.condicao.icon} size={15} />
              <span className="text-[10px] leading-tight">
                <span className="font-medium text-orange-500">{d.tempMax}°</span>
                <span className="text-gray-300 mx-0.5">|</span>
                <span className="text-blue-400">{d.tempMin}°</span>
              </span>
              {modoColheita ? (
                <span className={`text-[10px] font-medium leading-tight ${bom ? 'text-green-700' : 'text-red-600'}`}>
                  {d.precipitacao === 0 ? '0mm' : `${d.precipitacao}mm`}
                </span>
              ) : (
                <span className="text-[10px] text-blue-600 leading-tight">
                  {d.precipitacao === 0 ? '0mm' : `${d.precipitacao}mm`}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Tooltip({ texto, children }) {
  const [vis, setVis] = useState(false)
  const timerRef = useRef(null)
  function handleTouch() {
    setVis(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVis(false), 3000)
  }
  useEffect(() => () => clearTimeout(timerRef.current), [])
  return (
    <div className="relative inline-flex items-center" onMouseEnter={() => setVis(true)} onMouseLeave={() => setVis(false)} onTouchStart={handleTouch}>
      {children}
      {vis && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 z-50 pointer-events-none shadow-lg" style={{ whiteSpace: 'normal', width: 'max-content', maxWidth: '220px', textAlign: 'center' }}>
          {texto}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </div>
  )
}

const PERIODOS = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All']
const CULTURA_KEY_MAP = {
  'Soja': 'soja', 'Milho': 'milho', 'Café': 'cafe',
  'Café Arábica': 'cafe_arabica', 'Café Conilon': 'cafe_conilon',
  'Trigo': 'trigo', 'Algodão': 'algodao', 'Boi Gordo': 'boi_gordo',
}

function GraficoCotacao({ historico, cor = '#16a34a', prefixo = 'R$' }) {
  const svgRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  if (!historico || historico.length < 2) return (
    <div className="flex items-center justify-center h-28 text-xs text-gray-400">Sem dados para o período</div>
  )

  const valores = historico.map(h => h.valor)
  const minV = Math.min(...valores)
  const maxV = Math.max(...valores)
  const amp = maxV - minV || 1

  const W = 600, H = 150
  const padLeft = 52, padRight = 28, padTop = 10, padBottom = 28
  const chartW = W - padLeft - padRight
  const chartH = H - padTop - padBottom

  const toX = i => padLeft + (i / (historico.length - 1)) * chartW
  const toY = v => padTop + chartH - ((v - minV) / amp) * chartH

  const pontos = historico.map((h, i) => ({ x: toX(i), y: toY(h.valor), ...h }))
  const polyline = pontos.map(p => `${p.x},${p.y}`).join(' ')
  const areaPath =
    `M ${pontos[0].x},${padTop + chartH} ` +
    pontos.map(p => `L ${p.x},${p.y}`).join(' ') +
    ` L ${pontos[pontos.length - 1].x},${padTop + chartH} Z`

  const labelsY = Array.from({ length: 5 }, (_, i) => ({
    v: minV + (amp * i) / 4,
    y: toY(minV + (amp * i) / 4),
  }))

  const maxLabelsX = Math.min(6, historico.length)
  const stepX = Math.max(1, Math.floor((historico.length - 1) / (maxLabelsX - 1)))
  const labelsX = []
  for (let i = 0; i < historico.length; i += stepX) labelsX.push({ i, x: toX(i), label: historico[i].label })
  const last = historico.length - 1
  if (labelsX[labelsX.length - 1]?.i !== last) labelsX.push({ i: last, x: toX(last), label: historico[last].label })

  function handleMouseMove(e) {
    const svg = svgRef.current; if (!svg) return
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse())
    if (svgP.x < padLeft || svgP.x > W - padRight) { setTooltip(null); return }
    let closest = pontos[0], minDist = Infinity
    pontos.forEach(p => { const d = Math.abs(p.x - svgP.x); if (d < minDist) { minDist = d; closest = p } })
    setTooltip({ svgX: closest.x, svgY: closest.y, ponto: closest })
  }

  function handleTouchMove(e) {
    e.preventDefault()
    const touch = e.touches[0]; if (!touch) return
    const svg = svgRef.current; if (!svg) return
    const pt = svg.createSVGPoint(); pt.x = touch.clientX; pt.y = touch.clientY
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse())
    if (svgP.x < padLeft || svgP.x > W - padRight) return
    let closest = pontos[0], minDist = Infinity
    pontos.forEach(p => { const d = Math.abs(p.x - svgP.x); if (d < minDist) { minDist = d; closest = p } })
    setTooltip({ svgX: closest.x, svgY: closest.y, ponto: closest })
  }

  const TOOLTIP_W = 110
  const tooltipX = tooltip
    ? (tooltip.svgX + TOOLTIP_W > W - padRight ? tooltip.svgX - TOOLTIP_W - 6 : tooltip.svgX + 6)
    : 0

  return (
    <div className="w-full h-full">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full block"
        style={{ height: '100%', minHeight: 150, touchAction: 'none' }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}
        onTouchMove={handleTouchMove} onTouchEnd={() => setTimeout(() => setTooltip(null), 2000)}>
        <defs>
          <linearGradient id="grad-cot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </linearGradient>
          <clipPath id="clip-chart">
            <rect x={padLeft} y={padTop} width={chartW} height={chartH} />
          </clipPath>
        </defs>
        {labelsY.map(({ y }, i) => (
          <line key={i} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#f3f4f6" strokeWidth="1" />
        ))}
        <g clipPath="url(#clip-chart)">
          <path d={areaPath} fill="url(#grad-cot)" />
          <polyline points={polyline} fill="none" stroke={cor} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {labelsY.map(({ v, y }, i) => (
          <text key={i} x={padLeft - 5} y={y + 3.5} textAnchor="end" fontSize="9" fill="#9ca3af" fontFamily="sans-serif">
            {v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </text>
        ))}
        {labelsX.map(({ x, label, i: idx }) => (
          <text key={idx} x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="sans-serif">{label}</text>
        ))}
        {tooltip && (
          <>
            <line x1={tooltip.svgX} y1={padTop} x2={tooltip.svgX} y2={padTop + chartH} stroke="#d1d5db" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={tooltip.svgX} cy={tooltip.svgY} r="4" fill={cor} stroke="white" strokeWidth="2" />
          </>
        )}
        {tooltip && (
          <foreignObject x={tooltipX} y={padTop + 2} width={TOOLTIP_W} height={44}>
            <div xmlns="http://www.w3.org/1999/xhtml"
              style={{ background: '#1f2937', color: 'white', borderRadius: 8, padding: '4px 8px', fontSize: 11, lineHeight: '1.4', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              <div style={{ fontWeight: 600 }}>
                {prefixo} {Number(tooltip.ponto.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style={{ color: '#9ca3af', fontSize: 10 }}>{tooltip.ponto.label}</div>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  )
}

function CardCotacao({ safrasAtivas, cotacoes, setCotacoes }) {
  const [culturaSel, setCulturaSel] = useState('')
  const [periodo, setPeriodo] = useState('1D')
  const [moeda, setMoeda] = useState('BRL')
  const [carregandoGrafico, setCarregandoGrafico] = useState(false)

  const culturasDisp = useMemo(() => {
    const culturas = [...new Set(safrasAtivas.map(s => s.cultura).filter(Boolean))]
    return culturas.filter(c => cotacoes[c])
  }, [safrasAtivas, cotacoes])

  const culturaEfetiva = culturaSel && cotacoes[culturaSel] ? culturaSel : culturasDisp[0] || ''
  const cot = cotacoes[culturaEfetiva]

  useEffect(() => {
    if (!culturaEfetiva) return
    const chaveAPI = CULTURA_KEY_MAP[culturaEfetiva]
    if (!chaveAPI) return
    setCarregandoGrafico(true)
    fetch(`/api/cotacao?cultura=${chaveAPI}&periodo=${periodo}`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return
        const novoCot = data.culturas?.[chaveAPI]
        if (novoCot?.ok) {
          setCotacoes(prev => ({
            ...prev,
            [culturaEfetiva]: { ...prev[culturaEfetiva], historico: novoCot.historico, periodo },
          }))
        }
      })
      .catch(() => {})
      .finally(() => setCarregandoGrafico(false))
  }, [culturaEfetiva, periodo])

  if (!cot && culturasDisp.length === 0) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-xs text-gray-400">Cotação indisponível</div>
  )
  if (!cot) return null

  const historico = cot.historico || []
  const valores = historico.map(h => h.valor).filter(Boolean)
  const subiu = valores.length >= 2 ? valores[valores.length - 1] >= valores[0] : true
  const cor = subiu ? '#16a34a' : '#dc2626'
  const variacaoPeriodo = valores.length >= 2 ? ((valores[valores.length - 1] - valores[0]) / valores[0]) * 100 : null
  const maxPeriodo = valores.length ? Math.max(...valores) : null
  const minPeriodo = valores.length ? Math.min(...valores) : null
  const abertura = valores.length ? valores[0] : null

  const valoresOrig = historico.map(h => h.valorOrig).filter(Boolean)
  const maxPeriodoOrig = valoresOrig.length ? Math.max(...valoresOrig) : null
  const minPeriodoOrig = valoresOrig.length ? Math.min(...valoresOrig) : null
  const aberturaOrig = valoresOrig.length ? valoresOrig[0] : null

  const siglaOrig = (cot.unidadeOriginal || 'US\u00a2').split('/')[0]
  const historicoExibido = moeda === 'BRL'
    ? historico
    : historico.map(h => ({ ...h, valor: h.valorOrig ?? (h.valor / (cot.cambio || 1)) }))
  const precoExibido = moeda === 'BRL' ? Number(cot.valorBR || 0) : Number(cot.precoOriginal || 0)
  const unidExibida = moeda === 'BRL' ? (cot.unidBR || 'R$/sc') : (cot.unidadeOriginal || 'US\u00a2/bu')
  const prefixoExibido = moeda === 'BRL' ? 'R$' : siglaOrig

  const fmtStat = (brl, orig) => {
    const val = moeda === 'BRL' ? brl : orig
    if (val == null) return '—'
    return `${prefixoExibido} ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex flex-col md:flex-row md:h-64">

        <div className="md:w-44 md:flex-shrink-0 px-4 pt-3 pb-3 md:border-r border-gray-100 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <BarChart2 size={13} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-800">Cotação</span>
            </div>
            {cot.timestamp && (
              <span className="text-[10px] text-gray-400">
                {new Date(cot.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          <div>
            <p className="text-[10px] text-gray-400 leading-tight">{culturaEfetiva} · {cot.bolsa}</p>
            <p className="text-2xl font-bold text-gray-800 leading-tight">
              {prefixoExibido} {precoExibido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-gray-400">{unidExibida}</p>
            {variacaoPeriodo !== null && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold mt-1 ${variacaoPeriodo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {variacaoPeriodo >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {variacaoPeriodo >= 0 ? '+' : ''}{variacaoPeriodo.toFixed(2)}%
                <span className="text-[10px] font-normal text-gray-400 ml-0.5">{periodo}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 md:grid-cols-1 gap-1.5">
            <div>
              <p className="text-[10px] text-gray-400">Abertura</p>
              <p className="text-xs font-semibold text-gray-700">{fmtStat(abertura, aberturaOrig)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Máx. {periodo}</p>
              <p className="text-xs font-semibold text-green-700">{fmtStat(maxPeriodo, maxPeriodoOrig)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Mín. {periodo}</p>
              <p className="text-xs font-semibold text-red-600">{fmtStat(minPeriodo, minPeriodoOrig)}</p>
            </div>
          </div>

          {culturasDisp.length > 1 && (
            <div className="flex md:hidden flex-wrap gap-1">
              {culturasDisp.map(c => (
                <button key={c} onClick={() => setCulturaSel(c)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${culturaEfetiva === c ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-green-400'}`}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-[200px]">
          <div className="flex items-center justify-between px-3 pt-2 gap-2 min-h-[32px]">
            <div className="flex items-center gap-1">
              {culturasDisp.length > 1 && culturasDisp.map(c => (
                <button key={c} onClick={() => setCulturaSel(c)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${culturaEfetiva === c ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-green-400'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex rounded-full border border-gray-200 overflow-hidden text-[11px] font-medium flex-shrink-0">
              <button onClick={() => setMoeda('BRL')}
                className={`px-2.5 py-0.5 transition-colors ${moeda === 'BRL' ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                BRL
              </button>
              <button onClick={() => setMoeda('orig')}
                className={`px-2.5 py-0.5 transition-colors ${moeda === 'orig' ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                {siglaOrig}
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden">
            {carregandoGrafico && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
                <span className="text-xs text-gray-400">Carregando...</span>
              </div>
            )}
            <GraficoCotacao historico={historicoExibido} cor={cor} prefixo={prefixoExibido} />
          </div>

          <div className="flex border-t border-gray-100">
            {PERIODOS.map(p => (
              <button key={p} onClick={() => setPeriodo(p)}
                className={`flex-1 py-2 text-[11px] font-medium transition-colors ${periodo === p ? 'text-green-700 border-t-2 border-green-600 -mt-px bg-green-50' : 'text-gray-400 hover:text-gray-600'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function CardSafraSimples({ safra, climaProp }) {
  const previsao = climaProp?.previsao || []
  const alertasINMET = climaProp?.alertas || []
  const diasBons = diasBonsParaColheita(previsao)
  const localRef = [safra.cidadePropriedade, safra.estadoPropriedade].filter(Boolean).join(' - ')
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-green-600 flex-shrink-0 mt-1.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{safra.nome}</p>
            <p className="text-xs text-gray-400 mt-0.5">{safra.cultura} · Em andamento · sem colheita</p>
          </div>
        </div>
        {diasBons > 0 && (
          <Tooltip texto="Dias com precipitação < 2mm na previsão dos próximos 7 dias">
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0 whitespace-nowrap font-medium cursor-help">
              {diasBons}d secos (prev.)
            </span>
          </Tooltip>
        )}
      </div>
      {alertasINMET.length > 0 && (
        <div className="mx-4 mb-2 flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs text-amber-700 font-medium">{alertasINMET[0].evento} — {alertasINMET[0].severidade}</p>
            {alertasINMET[0].statusLabel && <p className="text-[10px] text-amber-600 mt-0.5">{alertasINMET[0].statusLabel}</p>}
          </div>
        </div>
      )}
      <ClimaStrip previsao={previsao} modoColheita={false} localRef={localRef} />
    </div>
  )
}

function CardSafraColheita({ safra, colheitas, lotesEstoque, climaProp }) {
  const previsao = climaProp?.previsao || []
  const alertasINMET = climaProp?.alertas || []
  const totalColhido = colheitas.reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
  const unidade = safra.unidade || colheitas[0]?.unidade || 'sc'
  const totalLavouras = safra.lavouraIds?.length || 0
  const localRef = [safra.cidadePropriedade, safra.estadoPropriedade].filter(Boolean).join(' - ')

  const lavourasConcluidas = useMemo(() => {
    const ids = new Set(colheitas.filter(c => c.colheitaConcluida).map(c => c.lavouraId).filter(Boolean))
    return ids.size
  }, [colheitas])

  const inicioSemana = new Date(HOJE_DATE)
  inicioSemana.setDate(HOJE_DATE.getDate() - 7)
  const totalSemana = colheitas
    .filter(c => c.dataColheita >= inicioSemana.toISOString().split('T')[0])
    .reduce((s, c) => s + (Number(c.quantidade) || 0), 0)

  const qtdEstocada = lotesEstoque
    .filter(l => !l.cancelado && colheitas.some(c => c.id === l.colheitaOrigemId))
    .reduce((s, l) => s + (Number(l.quantidadeEntrada) || 0), 0)
  const saldoEstocar = Math.max(0, totalColhido - qtdEstocada)

  const datasColheita = colheitas
    .filter(c => c.dataColheita)
    .map(c => c.dataColheita)
    .sort()
  const ultimaColheita = datasColheita[datasColheita.length - 1]
  const diasSemEntrada = ultimaColheita
    ? Math.ceil((HOJE_DATE - new Date(ultimaColheita + 'T00:00:00')) / 86400000)
    : null
  const temGargalo = saldoEstocar > 0 && diasSemEntrada !== null && diasSemEntrada > 4
  const progressoLavouras = totalLavouras > 0 ? (lavourasConcluidas / totalLavouras) * 100 : 0
  const tooltipEstocar = temGargalo
    ? `${saldoEstocar.toLocaleString('pt-BR')} ${unidade} aguardam estocagem há ${diasSemEntrada} dias desde a última colheita`
    : saldoEstocar > 0 ? `${saldoEstocar.toLocaleString('pt-BR')} ${unidade} ainda não estocados` : 'Tudo estocado'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-green-600 flex-shrink-0 mt-1.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{safra.nome}</p>
            <p className="text-xs text-gray-400 mt-0.5">{safra.cultura} · {totalLavouras} lavouras</p>
          </div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0 whitespace-nowrap font-medium">colheita ativa</span>
      </div>
      <div className="px-4 pb-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-28 flex-shrink-0">Lavouras concluídas</span>
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${progressoLavouras}%` }} />
          </div>
          <span className="text-xs font-medium text-gray-700 w-10 text-right">{lavourasConcluidas}/{totalLavouras}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-28 flex-shrink-0">Volume colhido</span>
          <span className="text-sm font-bold text-green-700">{totalColhido.toLocaleString('pt-BR')} {unidade}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-100">
        <div className="bg-white px-3 py-2">
          <p className="text-sm font-semibold text-gray-800">{totalSemana.toLocaleString('pt-BR')} <span className="text-xs font-normal">{unidade}</span></p>
          <p className="text-[10px] text-gray-400">esta semana</p>
        </div>
        <div className="bg-white px-3 py-2">
          <div className="flex items-center gap-1">
            <p className={`text-sm font-semibold ${saldoEstocar > 0 ? 'text-amber-600' : 'text-green-700'}`}>
              {saldoEstocar.toLocaleString('pt-BR')} <span className="text-xs font-normal">{unidade}</span>
            </p>
            {saldoEstocar > 0 && (
              <Tooltip texto={tooltipEstocar}>
                <AlertTriangle size={12} className={temGargalo ? 'text-red-500 cursor-help' : 'text-amber-500 cursor-help'} />
              </Tooltip>
            )}
          </div>
          <p className="text-[10px] text-gray-400">a estocar</p>
        </div>
        <div className="bg-white px-3 py-2">
          <p className="text-sm font-semibold text-gray-800">{diasBonsParaColheita(previsao)} <span className="text-xs font-normal">dias</span></p>
          <p className="text-[10px] text-gray-400">secos (prev.)</p>
        </div>
      </div>
      {alertasINMET.length > 0 && (
        <div className={`mx-4 my-2 flex items-start gap-2 rounded-lg px-3 py-2 ${alertasINMET[0].grave ? 'bg-red-50' : 'bg-amber-50'}`}>
          <AlertCircle size={13} className={`flex-shrink-0 mt-0.5 ${alertasINMET[0].grave ? 'text-red-600' : 'text-amber-600'}`} />
          <div className="min-w-0">
            <p className={`text-xs font-medium ${alertasINMET[0].grave ? 'text-red-700' : 'text-amber-700'}`}>
              {alertasINMET[0].evento} — {alertasINMET[0].severidade}
            </p>
            {alertasINMET[0].statusLabel && (
              <p className={`text-[10px] mt-0.5 ${alertasINMET[0].grave ? 'text-red-600' : 'text-amber-600'}`}>
                {alertasINMET[0].statusLabel}
              </p>
            )}
          </div>
        </div>
      )}
      <ClimaStrip previsao={previsao} modoColheita={true} localRef={localRef} />
    </div>
  )
}

export default function Dashboard() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [propriedades, setPropriedades] = useState([])
  const [safrasAtivas, setSafrasAtivas] = useState([])
  const [colheitas, setColheitas] = useState([])
  const [lotesEstoque, setLotesEstoque] = useState([])
  const [financeiro, setFinanceiro] = useState([])
  const [produtos, setProdutos] = useState([])
  const [movInsumos, setMovInsumos] = useState([])
  const [modalAlerta, setModalAlerta] = useState(null)
  const [confirmacaoStatus, setConfirmacaoStatus] = useState(null)
  const [salvandoStatus, setSalvandoStatus] = useState(false)
  const [cotacoes, setCotacoes] = useState({})
  const [expandidoAlertas, setExpandidoAlertas] = useState(false)
  const [expandidoVencimentos, setExpandidoVencimentos] = useState(false)
  const [modalDetalheVenc, setModalDetalheVenc] = useState(null)

  const clima = useClima(
    propriedades.map(p => ({ id: p.id, nome: p.nome, lat: p.lat, lng: p.lng, cidade: p.cidade, estado: p.estado }))
  )

  const carregar = useCallback(async () => {
    const uid = usuario.uid
    const q = (col) => query(collection(db, col), where('uid', '==', uid))
    const [propsSnap, safrasSnap, colheitasSnap, lotesSnap, finSnap, prodSnap, movInsSnap] = await Promise.all([
      getDocs(q('propriedades')), getDocs(q('safras')), getDocs(q('colheitas')),
      getDocs(q('estoqueProducao')), getDocs(q('financeiro')),
      getDocs(q('insumos')), getDocs(q('movimentacoesInsumos')),
    ])
    const props = propsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setPropriedades(props)
    const propMap = Object.fromEntries(props.map(p => [p.id, p]))
    setSafrasAtivas(
      safrasSnap.docs.map(d => {
        const s = { id: d.id, ...d.data() }
        const prop = propMap[s.propriedadeId] || {}
        return { ...s, cidadePropriedade: prop.cidade || '', estadoPropriedade: prop.estado || '' }
      }).filter(s => s.status !== 'Colhida' && s.status !== 'Cancelada')
    )
    setColheitas(colheitasSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLotesEstoque(lotesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setFinanceiro(finSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setProdutos(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setMovInsumos(movInsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }, [usuario])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const MAP = { soja: 'Soja', milho: 'Milho', cafe: 'Café', cafe_arabica: 'Café Arábica', cafe_conilon: 'Café Conilon', trigo: 'Trigo', algodao: 'Algodão', boi_gordo: 'Boi Gordo' }
    async function buscar() {
      try {
        const res = await fetch('/api/cotacao?periodo=1M')
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        const novo = {}
        Object.entries(data.culturas || {}).forEach(([k, v]) => {
          if (v.ok && MAP[k]) {
            novo[MAP[k]] = {
              valorBR: v.valorBR,
              precoOriginal: v.precoOriginal,
              bolsa: v.bolsa,
              originalFormatado: v.precoOriginalFormatado,
              unidBR: v.unidadeBR,
              unidadeOriginal: v.unidadeOriginal,
              cambio: v.cambio,
              timestamp: v.timestamp,
              historico: v.historico || [],
            }
          }
        })
        setCotacoes(novo)
      } catch { /* silencioso */ }
    }
    buscar()
    const t = setInterval(buscar, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const produtosEnriquecidos = useMemo(() =>
    produtos.map(p => {
      const movs = movInsumos.filter(m => m.produtoId === p.id)
      const saldo = calcularSaldo(movs)
      const validade = validadeMaisCritica(movs)
      const abaixoMinimo = p.temEstoqueMinimo && Number(p.estoqueMinimo) > 0 && saldo < Number(p.estoqueMinimo)
      return { ...p, saldo, validade, abaixoMinimo }
    })
  , [produtos, movInsumos])

  const alertasCriticos = useMemo(() => {
    const lista = []
    const vencidos = financeiro.filter(f => f.status === 'pendente' && f.vencimento && f.vencimento < HOJE && f.tipo !== 'receita' && !f.cancelado)
    if (vencidos.length > 0) {
      const total = vencidos.reduce((s, f) => s + (Number(f.valor) || 0), 0)
      lista.push({
        id: 'pagamentos-vencidos', tipo: 'critico',
        titulo: `${vencidos.length} pagamento${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}`,
        subtitulo: `Total: R$ ${formatarValor(total)}`, badge: 'pagar',
        itens: vencidos.map(f => ({ id: f.id, descricao: f.descricao || f.categoria || '—', valor: f.valor, vencimento: f.vencimento })),
      })
    }
    produtosEnriquecidos.filter(i => i.abaixoMinimo).forEach(i => {
      lista.push({ id: `min-${i.id}`, tipo: 'atencao', titulo: `${i.produto || i.nome || 'Insumo'} — estoque mínimo`, subtitulo: `Saldo: ${i.saldo.toFixed(1)} ${i.unidade || ''} · Mínimo: ${i.estoqueMinimo}`, badge: 'estoque' })
    })
    const em30DiasStr = new Date(HOJE_DATE.getTime() + 30 * 86400000).toISOString().split('T')[0]
    produtosEnriquecidos.filter(i => { const v = i.validade; return v && (v.tipo === 'vencido' || (v.tipo === 'alerta' && v.dataValidade <= em30DiasStr)) }).forEach(i => {
      const diff = diffDias(i.validade.dataValidade)
      lista.push({ id: `val-${i.id}`, tipo: i.validade.tipo === 'vencido' ? 'critico' : 'atencao', titulo: i.validade.tipo === 'vencido' ? `${i.produto} — validade vencida` : `${i.produto} — vence em ${diff} dia${diff !== 1 ? 's' : ''}`, subtitulo: `Saldo: ${i.saldo.toFixed(1)} ${i.unidade || ''} · Validade: ${formatarData(i.validade.dataValidade)}`, badge: 'validade' })
    })
    return lista
  }, [financeiro, produtosEnriquecidos])

  const vencimentos7Dias = useMemo(() =>
    financeiro.filter(f => f.status === 'pendente' && f.vencimento && f.vencimento >= HOJE && f.vencimento <= EM7DIAS_STR && !f.cancelado)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  , [financeiro])

  const resumoMes = useMemo(() => {
    const anoMes = HOJE.substring(0, 7)
    const doPeriodo = financeiro.filter(f => f.data?.startsWith(anoMes) && !f.cancelado)
    const receitas = doPeriodo.filter(f => f.tipo === 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const despesas = doPeriodo.filter(f => f.tipo !== 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    return { receitas, despesas, saldo: receitas - despesas }
  }, [financeiro])

  const safrasComColheita = useMemo(() => new Set(colheitas.map(c => c.safraId).filter(Boolean)), [colheitas])

  function solicitarMarcarStatus(item, novoStatus) {
    setConfirmacaoStatus({ id: item.id, novoStatus, descricao: item.descricao || item.categoria || '—', valor: item.valor, dataConfirmacao: HOJE })
  }

  async function confirmarMarcarStatus() {
    if (!confirmacaoStatus) return
    setSalvandoStatus(true)
    try {
      const { id, novoStatus, dataConfirmacao } = confirmacaoStatus
      await updateDoc(doc(db, 'financeiro', id), { status: novoStatus, dataPagamento: dataConfirmacao })
      setFinanceiro(prev => prev.map(f => f.id === id ? { ...f, status: novoStatus, dataPagamento: dataConfirmacao } : f))
      if (modalAlerta) setModalAlerta(prev => prev ? { ...prev, itens: prev.itens?.filter(i => i.id !== id) || [] } : null)
    } finally {
      setSalvandoStatus(false)
      setConfirmacaoStatus(null)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm p-4">Carregando...</div>

  const criticos = alertasCriticos.filter(a => a.tipo === 'critico')
  const atencao  = alertasCriticos.filter(a => a.tipo === 'atencao')

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Início</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {alertasCriticos.length > 0 && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={13} className={criticos.length > 0 ? 'text-red-500' : atencao.length > 0 ? 'text-amber-500' : 'text-gray-400'} />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Alertas</span>
              {criticos.length > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">{criticos.length} urgente{criticos.length > 1 ? 's' : ''}</span>}
              {atencao.length > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{atencao.length} atenção</span>}
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex-1">
              {(expandidoAlertas ? alertasCriticos : alertasCriticos.slice(0, 4)).map(a => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${a.tipo === 'critico' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <AlertCircle size={14} className={a.tipo === 'critico' ? 'text-red-600' : 'text-amber-600'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.titulo}</p>
                    <p className="text-xs text-gray-400 truncate">{a.subtitulo}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.tipo === 'critico' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{a.badge}</span>
                    {a.itens?.length > 0 && (
                      <button type="button" onClick={() => setModalAlerta(a)} className="text-gray-300 hover:text-blue-500 p-0.5 transition-colors">
                        <Info size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {alertasCriticos.length > 4 && (
                <button onClick={() => setExpandidoAlertas(e => !e)} className="w-full text-xs text-gray-400 py-2 hover:text-gray-600 transition-colors border-t border-gray-50">
                  {expandidoAlertas ? 'ver menos ↑' : `ver mais (${alertasCriticos.length - 4}) ↓`}
                </button>
              )}
            </div>
          </div>
        )}

        {vencimentos7Dias.length > 0 && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock size={13} className="text-blue-500" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vencimentos — próximos 7 dias</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex-1">
              {(expandidoVencimentos ? vencimentos7Dias : vencimentos7Dias.slice(0, 4)).map(f => {
                const diff = diffDias(f.vencimento)
                const isReceita = f.tipo === 'receita'
                return (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isReceita ? 'bg-green-50' : 'bg-red-50'}`}>
                      <CalendarClock size={13} className={isReceita ? 'text-green-600' : 'text-red-600'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{f.descricao || f.categoria || '—'}</p>
                      <p className="text-xs text-gray-400">{formatarData(f.vencimento)} · R$ {formatarValor(f.valor)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isReceita ? (diff <= 0 ? 'bg-green-100 text-green-800' : 'bg-green-50 text-green-700') : (diff <= 1 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}`}>
                        {diff <= 0 ? 'hoje' : `em ${diff}d`}
                      </span>
                      <button onClick={() => setModalDetalheVenc(f)} className="text-gray-300 hover:text-blue-500 transition-colors p-0.5">
                        <Info size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
              {vencimentos7Dias.length > 4 && (
                <button onClick={() => setExpandidoVencimentos(e => !e)} className="w-full text-xs text-gray-400 py-2 hover:text-gray-600 transition-colors border-t border-gray-50">
                  {expandidoVencimentos ? 'ver menos ↑' : `ver mais (${vencimentos7Dias.length - 4}) ↓`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {safrasAtivas.length > 0 && (() => {
        const n = safrasAtivas.length
        const cardsSafra = safrasAtivas.map(safra => {
          const colheitasDaSafra = colheitas.filter(c => c.safraId === safra.id)
          const climaProp = clima[safra.propriedadeId] || null
          const temColheita = safrasComColheita.has(safra.id)
          if (temColheita) return <CardSafraColheita key={safra.id} safra={safra} colheitas={colheitasDaSafra} lotesEstoque={lotesEstoque} climaProp={climaProp} />
          return <CardSafraSimples key={safra.id} safra={safra} climaProp={climaProp} />
        })
        const cardCot = <CardCotacao key="cotacao" safrasAtivas={safrasAtivas} cotacoes={cotacoes} setCotacoes={setCotacoes} />
        return (
          <div className="space-y-3 mb-4">
            <div className="flex items-center gap-2">
              <Wheat size={14} className="text-green-700" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Safras em andamento</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {n === 1 ? (
                <>
                  <div>{cardsSafra[0]}</div>
                  <div>{cardCot}</div>
                </>
              ) : n === 2 ? (
                <>
                  {cardsSafra}
                  <div className="md:col-span-2">{cardCot}</div>
                </>
              ) : n === 3 ? (
                <>
                  {cardsSafra[0]}
                  {cardsSafra[1]}
                  {cardsSafra[2]}
                  <div>{cardCot}</div>
                </>
              ) : (
                <>
                  {cardsSafra}
                  <div className="md:col-span-2">{cardCot}</div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={13} className="text-green-600" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resumo do mês</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-3 gap-px bg-gray-100">
            <div className="bg-white px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1"><TrendingUp size={13} className="text-green-600" /><p className="text-xs text-gray-400">Receitas</p></div>
              <p className="text-base font-bold text-green-700">{formatarMoeda(resumoMes.receitas)}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">este mês</p>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1"><TrendingDown size={13} className="text-red-500" /><p className="text-xs text-gray-400">Despesas</p></div>
              <p className="text-base font-bold text-red-600">{formatarMoeda(resumoMes.despesas)}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">este mês</p>
            </div>
            <div className="bg-white px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Saldo</p>
              <p className={`text-base font-bold ${resumoMes.saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {resumoMes.saldo < 0 ? '−' : ''}{formatarMoeda(Math.abs(resumoMes.saldo))}
              </p>
              <Link to="/indicadores" className="text-[10px] text-gray-400 hover:text-green-700 transition-colors mt-0.5 block">ver Indicadores →</Link>
            </div>
          </div>
        </div>
      </div>

      {alertasCriticos.length === 0 && vencimentos7Dias.length === 0 && safrasAtivas.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 mt-4">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Tudo em dia! Nenhum alerta ou vencimento próximo.</p>
        </div>
      )}

      {modalAlerta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${modalAlerta.tipo === 'critico' ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <AlertCircle size={14} className={modalAlerta.tipo === 'critico' ? 'text-red-600' : 'text-amber-600'} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-sm">{modalAlerta.titulo}</h3>
                  <p className="text-xs text-gray-400">{modalAlerta.subtitulo}</p>
                </div>
              </div>
              <button onClick={() => setModalAlerta(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
              {modalAlerta.itens?.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Todos os itens foram resolvidos.</p>}
              {modalAlerta.itens?.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.descricao}</p>
                    <p className="text-xs text-gray-400">Venc. {formatarData(item.vencimento)} · R$ {formatarValor(item.valor)}</p>
                  </div>
                  <button onClick={() => solicitarMarcarStatus(item, 'pago')} disabled={salvandoStatus}
                    className="flex items-center gap-1 text-xs text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex-shrink-0"
                    style={{ background: 'linear-gradient(to right, #ef6464, #e31f1f)' }}>
                    <CheckCircle size={11} />Pago
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalDetalheVenc && (() => {
        const f = modalDetalheVenc
        const isReceita = f.tipo === 'receita'
        const campos = [
          { label: 'Descrição', valor: f.descricao },
          { label: 'Tipo', valor: isReceita ? 'Receita' : 'Despesa' },
          { label: 'Categoria', valor: f.categoria },
          { label: 'Tipo detalhe', valor: f.tipoDespesa },
          { label: 'Valor', valor: `R$ ${formatarValor(f.valor)}` },
          { label: 'Vencimento', valor: formatarData(f.vencimento) },
          { label: 'Situação', valor: f.status === 'pendente' ? 'Pendente' : f.status === 'pago' ? 'Pago' : f.status === 'recebido' ? 'Recebido' : f.status },
          { label: 'Nº Doc.', valor: f.notaRef },
        ].filter(r => r.valor && r.valor !== '—' && r.valor !== '')
        return (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">Detalhes do vencimento</h3>
                <button onClick={() => setModalDetalheVenc(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                {campos.map(row => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <span className="text-xs text-gray-500">{row.label}</span>
                    <span className="text-xs font-medium text-gray-800 text-right">{row.valor}</span>
                  </div>
                ))}
              </div>
              {f.status === 'pendente' && (
                <button
                  onClick={() => { setModalDetalheVenc(null); solicitarMarcarStatus(f, isReceita ? 'recebido' : 'pago') }}
                  disabled={salvandoStatus}
                  className="w-full flex items-center justify-center gap-2 text-sm text-white py-2.5 rounded-xl font-medium disabled:opacity-50 shadow-md"
                  style={{ background: isReceita ? 'var(--brand-gradient)' : 'linear-gradient(to right, #ef6464, #e31f1f)' }}>
                  <CheckCircle size={14} />
                  {isReceita ? 'Marcar como recebido' : 'Marcar como pago'}
                </button>
              )}
              <button onClick={() => setModalDetalheVenc(null)} className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Fechar</button>
            </div>
          </div>
        )
      })()}

      {confirmacaoStatus && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">
              {confirmacaoStatus.novoStatus === 'recebido' ? 'Confirmar recebimento' : 'Confirmar pagamento'}
            </h3>
            <p className="text-sm text-gray-600">
              Confirma o {confirmacaoStatus.novoStatus === 'recebido' ? 'recebimento' : 'pagamento'} de{' '}
              <span className="font-semibold">R$ {Number(confirmacaoStatus.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>{' '}
              referente a <span className="font-semibold">{confirmacaoStatus.descricao}</span>?
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data do {confirmacaoStatus.novoStatus === 'recebido' ? 'recebimento' : 'pagamento'}
              </label>
              <input type="date" value={confirmacaoStatus.dataConfirmacao}
                onChange={e => setConfirmacaoStatus(c => ({ ...c, dataConfirmacao: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-xs text-gray-400 mt-1">A data será registrada no lançamento Financeiro.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoStatus(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarMarcarStatus} disabled={salvandoStatus}
                className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                style={{ background: 'var(--brand-gradient)' }}>
                {salvandoStatus ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
