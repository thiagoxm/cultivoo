import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertCircle, ChevronDown, ChevronUp, CalendarClock, Wheat,
  TrendingUp, TrendingDown, CheckCircle, X, ExternalLink,
  AlertTriangle, BarChart2
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

// ── Ícones clima ───────────────────────────────────────────────────────────
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

// ── Strip clima 7 dias ─────────────────────────────────────────────────────
function ClimaStrip({ previsao, modoColheita = false, localRef = '' }) {
  if (!previsao?.length) return (
    <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">Carregando previsão...</div>
  )
  return (
    <div className="bg-gray-50 border-t border-gray-100">
      {localRef && (
        <p className="px-3 pt-1.5 text-[10px] text-gray-400 truncate">📍 {localRef}</p>
      )}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto">
        {previsao.slice(0, 7).map((d) => {
          const bom = d.precipitacao < 2
          const [, mes, dia] = d.data.split('-')
          return (
            <div key={d.data} className="flex flex-col items-center gap-0.5 flex-1 min-w-[42px]">
              <span className="text-[10px] text-gray-400 leading-tight">{nomeDiaSemana(d.data)}</span>
              <span className="text-[10px] text-gray-300 leading-tight">{dia}/{mes}</span>
              <IconeClima tipo={d.condicao.icon} size={15} />
              <span className="text-[10px] font-medium text-gray-600 leading-tight">{d.tempMin}° - {d.tempMax}°</span>
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

// ── Tooltip simples ────────────────────────────────────────────────────────
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
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap z-50 pointer-events-none shadow-lg max-w-[200px] text-center">
          {texto}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </div>
  )
}

// ── Mini gráfico SVG de cotação ────────────────────────────────────────────
function MiniGraficoCotacao({ historico }) {
  if (!historico || historico.length < 2) return null
  const valores = historico.map(h => h.valor)
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const amplitude = max - min || 1
  const W = 120, H = 32, pad = 2
  const pts = valores.map((v, i) => {
    const x = pad + (i / (valores.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v - min) / amplitude) * (H - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const ultimo = historico[historico.length - 1]?.valor
  const penultimo = historico[historico.length - 2]?.valor
  const subiu = ultimo >= penultimo
  const cor = subiu ? '#16a34a' : '#dc2626'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="opacity-80">
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.split(' ').pop().split(',')[0]} cy={pts.split(' ').pop().split(',')[1]} r="2" fill={cor} />
    </svg>
  )
}

// ── Card cotação ───────────────────────────────────────────────────────────
function CardCotacao({ safrasAtivas, cotacoes }) {
  const [culturaSel, setCulturaSel] = useState('')

  // Culturas das safras ativas que têm cotação disponível
  const culturasDisp = useMemo(() => {
    const culturas = [...new Set(safrasAtivas.map(s => s.cultura).filter(Boolean))]
    return culturas.filter(c => cotacoes[c])
  }, [safrasAtivas, cotacoes])

  const culturaEfetiva = culturaSel && cotacoes[culturaSel] ? culturaSel : culturasDisp[0] || ''
  const cot = cotacoes[culturaEfetiva]

  if (!cot && culturasDisp.length === 0) return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-xs text-gray-400">
      Cotação indisponível
    </div>
  )
  if (!cot) return null

  const variacao = cot.historico?.length >= 2
    ? ((cot.historico[cot.historico.length - 1].valor - cot.historico[cot.historico.length - 2].valor) / cot.historico[cot.historico.length - 2].valor * 100)
    : null
  const var7d = cot.historico?.length >= 2
    ? ((cot.historico[cot.historico.length - 1].valor - cot.historico[0].valor) / cot.historico[0].valor * 100)
    : null
  const subiu = variacao !== null && variacao >= 0

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-800">Cotação</span>
          {cot.timestamp && (
            <span className="text-[10px] text-gray-400">
              · {new Date(cot.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {/* Seletor de cultura */}
        {culturasDisp.length > 1 && (
          <div className="flex gap-1">
            {culturasDisp.map(c => (
              <button key={c} onClick={() => setCulturaSel(c)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${culturaEfetiva === c ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-green-400'}`}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Corpo */}
      <div className="grid grid-cols-2 gap-px bg-gray-100 border-t border-gray-100">
        {/* Preço atual + gráfico */}
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] text-gray-400 mb-0.5">{culturaEfetiva} · {cot.bolsa} · {cot.originalFormatado}</p>
          <p className="text-2xl font-bold text-gray-800">R$ {formatarValor(cot.valorBR, 2)}</p>
          <div className="flex items-center gap-2 mt-1">
            {variacao !== null && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${subiu ? 'text-green-600' : 'text-red-600'}`}>
                {subiu ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {subiu ? '+' : ''}{variacao.toFixed(2)}% hoje
              </span>
            )}
          </div>
          {cot.historico && <MiniGraficoCotacao historico={cot.historico} />}
        </div>

        {/* Variações */}
        <div className="bg-white px-4 py-3 flex flex-col justify-center gap-2">
          {var7d !== null && (
            <div>
              <p className="text-[10px] text-gray-400">Últimos 7 dias</p>
              <p className={`text-sm font-semibold ${var7d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {var7d >= 0 ? '+' : ''}{var7d.toFixed(2)}%
              </p>
            </div>
          )}
          {cot.historico?.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400">Máx. 7d</p>
              <p className="text-sm font-medium text-gray-700">
                R$ {formatarValor(Math.max(...cot.historico.map(h => h.valor)), 2)}
              </p>
            </div>
          )}
          {cot.historico?.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400">Mín. 7d</p>
              <p className="text-sm font-medium text-gray-700">
                R$ {formatarValor(Math.min(...cot.historico.map(h => h.valor)), 2)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mini tabela histórico */}
      {cot.historico?.length > 1 && (
        <div className="px-4 pt-2 pb-3 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 mb-1.5">Histórico recente ({cot.bolsa})</p>
          <div className="flex gap-1 overflow-x-auto">
            {cot.historico.slice(-7).map((h, i, arr) => {
              const ant = arr[i - 1]?.valor
              const var_ = ant ? (h.valor - ant) / ant * 100 : null
              return (
                <div key={i} className="flex flex-col items-center flex-1 min-w-[36px]">
                  <span className="text-[9px] text-gray-400 leading-tight">{h.data}</span>
                  <span className="text-[10px] font-medium text-gray-700 leading-tight">{formatarValor(h.valor, 2)}</span>
                  {var_ !== null && (
                    <span className={`text-[9px] leading-tight ${var_ >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {var_ >= 0 ? '+' : ''}{var_.toFixed(1)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Card safra simples ─────────────────────────────────────────────────────
function CardSafraSimples({ safra, climaProp }) {
  const previsao = climaProp?.previsao || []
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
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0 whitespace-nowrap font-medium">
            {diasBons}d sem chuva
          </span>
        )}
      </div>
      <ClimaStrip previsao={previsao} modoColheita={false} localRef={localRef} />
    </div>
  )
}

// ── Card safra com colheita ────────────────────────────────────────────────
function CardSafraColheita({ safra, colheitas, lotesEstoque, climaProp }) {
  const previsao = climaProp?.previsao || []
  const alertasINMET = climaProp?.alertas?.filter(a => a.grave) || []
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

  const datasEntrada = lotesEstoque
    .filter(l => !l.cancelado && colheitas.some(c => c.id === l.colheitaOrigemId))
    .map(l => l.dataColheita || l.criadoEm?.toDate?.()?.toISOString()?.split('T')[0])
    .filter(Boolean).sort()
  const ultimaEntrada = datasEntrada[datasEntrada.length - 1]
  const diasSemEntrada = ultimaEntrada
    ? Math.ceil((HOJE_DATE - new Date(ultimaEntrada + 'T00:00:00')) / 86400000)
    : null
  const temGargalo = saldoEstocar > 0 && diasSemEntrada !== null && diasSemEntrada > 4
  const progressoLavouras = totalLavouras > 0 ? (lavourasConcluidas / totalLavouras) * 100 : 0

  const tooltipEstocar = temGargalo
    ? `${saldoEstocar.toLocaleString('pt-BR')} ${unidade} aguardam entrada no estoque há ${diasSemEntrada} dias`
    : saldoEstocar > 0
    ? `${saldoEstocar.toLocaleString('pt-BR')} ${unidade} ainda não estocados`
    : 'Tudo estocado'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Cabeçalho */}
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

      {/* Progresso */}
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

      {/* KPIs — "a estocar" com ícone de alerta inline */}
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
                <AlertTriangle
                  size={12}
                  className={temGargalo ? 'text-red-500 cursor-help' : 'text-amber-500 cursor-help'}
                />
              </Tooltip>
            )}
          </div>
          <p className="text-[10px] text-gray-400">a estocar</p>
        </div>
        <div className="bg-white px-3 py-2">
          <p className="text-sm font-semibold text-gray-800">{diasBonsParaColheita(previsao)} <span className="text-xs font-normal">dias</span></p>
          <p className="text-[10px] text-gray-400">sem chuva</p>
        </div>
      </div>

      {/* Alertas INMET graves */}
      {alertasINMET.length > 0 && (
        <div className="mx-4 my-2 flex items-start gap-2 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{alertasINMET[0].evento} — {alertasINMET[0].severidade}</p>
        </div>
      )}

      <ClimaStrip previsao={previsao} modoColheita={true} localRef={localRef} />
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────
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

  const [alertasExpandido, setAlertasExpandido] = useState(true)
  const [modalAlerta, setModalAlerta] = useState(null) // alerta com itens p/ popup
  const [confirmacaoStatus, setConfirmacaoStatus] = useState(null)
  const [salvandoStatus, setSalvandoStatus] = useState(false)

  // Cotações
  const [cotacoes, setCotacoes] = useState({})

  const clima = useClima(
    propriedades.map(p => ({ id: p.id, nome: p.nome, lat: p.lat, lng: p.lng }))
  )

  const carregar = useCallback(async () => {
    const uid = usuario.uid
    const q = (col) => query(collection(db, col), where('uid', '==', uid))
    const [propsSnap, safrasSnap, colheitasSnap, lotesSnap, finSnap, prodSnap, movInsSnap] = await Promise.all([
      getDocs(q('propriedades')),
      getDocs(q('safras')),
      getDocs(q('colheitas')),
      getDocs(q('estoqueProducao')),
      getDocs(q('financeiro')),
      getDocs(q('insumos')),
      getDocs(q('movimentacoesInsumos')),
    ])
    const props = propsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setPropriedades(props)
    // Enriquecer safras com cidade/estado da propriedade
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

  // Busca cotações (mesma estratégia do EstoqueProducao)
  useEffect(() => {
    const MAP = { soja: 'Soja', milho: 'Milho', cafe: 'Café', cafe_arabica: 'Café Arábica', cafe_conilon: 'Café Conilon', trigo: 'Trigo', algodao: 'Algodão' }
    async function buscar() {
      try {
        const res = await fetch('/api/cotacao')
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        const novo = {}
        Object.entries(data.culturas || {}).forEach(([k, v]) => {
          if (v.ok && MAP[k]) {
            novo[MAP[k]] = {
              valorBR: v.valorBR,
              bolsa: v.bolsa,
              originalFormatado: v.precoOriginalFormatado,
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

  // Produtos enriquecidos
  const produtosEnriquecidos = useMemo(() =>
    produtos.map(p => {
      const movs = movInsumos.filter(m => m.produtoId === p.id)
      const saldo = calcularSaldo(movs)
      const validade = validadeMaisCritica(movs)
      const abaixoMinimo = p.temEstoqueMinimo && Number(p.estoqueMinimo) > 0 && saldo < Number(p.estoqueMinimo)
      return { ...p, saldo, validade, abaixoMinimo }
    })
  , [produtos, movInsumos])

  // Alertas críticos
  const alertasCriticos = useMemo(() => {
    const lista = []
    const vencidos = financeiro.filter(f =>
      f.status === 'pendente' && f.vencimento && f.vencimento < HOJE && f.tipo !== 'receita' && !f.cancelado
    )
    if (vencidos.length > 0) {
      const total = vencidos.reduce((s, f) => s + (Number(f.valor) || 0), 0)
      lista.push({
        id: 'pagamentos-vencidos',
        tipo: 'critico',
        titulo: `${vencidos.length} pagamento${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}`,
        subtitulo: `Total: R$ ${formatarValor(total)}`,
        badge: 'pagar',
        itens: vencidos.map(f => ({ id: f.id, descricao: f.descricao || f.categoria || '—', valor: f.valor, vencimento: f.vencimento, tipo: f.tipo })),
      })
    }

    produtosEnriquecidos.filter(i => i.abaixoMinimo).forEach(i => {
      lista.push({
        id: `min-${i.id}`,
        tipo: 'atencao',
        titulo: `${i.produto || i.nome || 'Insumo'} — estoque mínimo`,
        subtitulo: `Saldo: ${i.saldo.toFixed(1)} ${i.unidade || ''} · Mínimo: ${i.estoqueMinimo}`,
        badge: 'estoque',
      })
    })

    const em30DiasStr = new Date(HOJE_DATE.getTime() + 30 * 86400000).toISOString().split('T')[0]
    produtosEnriquecidos.filter(i => {
      const v = i.validade
      return v && (v.tipo === 'vencido' || (v.tipo === 'alerta' && v.dataValidade <= em30DiasStr))
    }).forEach(i => {
      const diff = diffDias(i.validade.dataValidade)
      lista.push({
        id: `val-${i.id}`,
        tipo: i.validade.tipo === 'vencido' ? 'critico' : 'atencao',
        titulo: i.validade.tipo === 'vencido'
          ? `${i.produto} — validade vencida`
          : `${i.produto} — vence em ${diff} dia${diff !== 1 ? 's' : ''}`,
        subtitulo: `Saldo: ${i.saldo.toFixed(1)} ${i.unidade || ''} · Validade: ${formatarData(i.validade.dataValidade)}`,
        badge: 'validade',
      })
    })
    return lista
  }, [financeiro, produtosEnriquecidos])

  // Vencimentos 7 dias
  const vencimentos7Dias = useMemo(() =>
    financeiro
      .filter(f => f.status === 'pendente' && f.vencimento && f.vencimento >= HOJE && f.vencimento <= EM7DIAS_STR && !f.cancelado)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .slice(0, 6)
  , [financeiro])

  // Resumo financeiro do mês
  const resumoMes = useMemo(() => {
    const anoMes = HOJE.substring(0, 7)
    const doPeriodo = financeiro.filter(f => f.data?.startsWith(anoMes) && !f.cancelado)
    const receitas = doPeriodo.filter(f => f.tipo === 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const despesas = doPeriodo.filter(f => f.tipo !== 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    return { receitas, despesas, saldo: receitas - despesas }
  }, [financeiro])

  const safrasComColheita = useMemo(() =>
    new Set(colheitas.map(c => c.safraId).filter(Boolean))
  , [colheitas])

  function solicitarMarcarStatus(item, novoStatus) {
    setConfirmacaoStatus({
      id: item.id,
      novoStatus,
      descricao: item.descricao || item.categoria || '—',
      valor: item.valor,
      dataConfirmacao: HOJE,
    })
  }

  async function confirmarMarcarStatus() {
    if (!confirmacaoStatus) return
    setSalvandoStatus(true)
    try {
      const { id, novoStatus, dataConfirmacao } = confirmacaoStatus
      await updateDoc(doc(db, 'financeiro', id), { status: novoStatus, dataPagamento: dataConfirmacao })
      // Se havia um modal de alerta aberto, atualizar seus itens
      if (modalAlerta) {
        setModalAlerta(prev => prev ? {
          ...prev,
          itens: prev.itens?.filter(i => i.id !== id) || []
        } : null)
      }
      await carregar()
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

      {/* Grid web 2 colunas: alertas + vencimentos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

        {/* ── ALERTAS ── */}
        {alertasCriticos.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setAlertasExpandido(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">Alertas</span>
                {criticos.length > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">{criticos.length} urgente{criticos.length > 1 ? 's' : ''}</span>}
                {atencao.length > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{atencao.length} atenção</span>}
              </div>
              {alertasExpandido ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
            </button>

            {alertasExpandido && (
              <div className="border-t border-gray-100">
                {alertasCriticos.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${a.tipo === 'critico' ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <AlertCircle size={14} className={a.tipo === 'critico' ? 'text-red-600' : 'text-amber-600'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{a.titulo}</p>
                      <p className="text-xs text-gray-400 truncate">{a.subtitulo}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.tipo === 'critico' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                        {a.badge}
                      </span>
                      {/* Botão popup apenas para alertas com itens acionáveis */}
                      {a.itens?.length > 0 && (
                        <button type="button"
                          onClick={() => setModalAlerta(a)}
                          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5 border border-gray-200 rounded px-1.5 py-0.5 hover:border-gray-300 transition-colors">
                          <ExternalLink size={10} />
                          ver
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── VENCIMENTOS 7 DIAS ── */}
        {vencimentos7Dias.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <CalendarClock size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-800">Vencimentos — próximos 7 dias</span>
            </div>
            {vencimentos7Dias.map(f => {
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isReceita ? 'bg-green-50 text-green-700' : diff <= 1 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                      {isReceita ? 'a receber' : diff <= 0 ? 'hoje' : `em ${diff}d`}
                    </span>
                    <button
                      onClick={() => solicitarMarcarStatus(f, isReceita ? 'recebido' : 'pago')}
                      disabled={salvandoStatus}
                      title={isReceita ? 'Marcar como recebido' : 'Marcar como pago'}
                      className="text-gray-300 hover:text-green-600 disabled:opacity-40 transition-colors p-0.5">
                      <CheckCircle size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
            <Link to="/financeiro" className="block text-xs text-gray-400 text-center py-2 border-t border-gray-50 hover:text-gray-600 transition-colors">
              ver todos no Financeiro →
            </Link>
          </div>
        )}
      </div>

      {/* ── SAFRAS ── */}
      {safrasAtivas.length > 0 && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <Wheat size={14} className="text-green-700" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Safras em andamento</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {safrasAtivas.map(safra => {
              const colheitasDaSafra = colheitas.filter(c => c.safraId === safra.id)
              const climaProp = clima[safra.propriedadeId] || null
              const temColheita = safrasComColheita.has(safra.id)
              if (temColheita) {
                return <CardSafraColheita key={safra.id} safra={safra} colheitas={colheitasDaSafra} lotesEstoque={lotesEstoque} climaProp={climaProp} />
              }
              return <CardSafraSimples key={safra.id} safra={safra} climaProp={climaProp} />
            })}
          </div>
        </div>
      )}

      {/* ── COTAÇÃO ── */}
      {safrasAtivas.length > 0 && (
        <div className="mb-4">
          <CardCotacao safrasAtivas={safrasAtivas} cotacoes={cotacoes} />
        </div>
      )}

      {/* ── RESUMO FINANCEIRO DO MÊS ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid grid-cols-3 gap-px bg-gray-100">
          <div className="bg-white px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={13} className="text-green-600" />
              <p className="text-xs text-gray-400">Receitas</p>
            </div>
            <p className="text-base font-bold text-green-700">{formatarMoeda(resumoMes.receitas)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">este mês</p>
          </div>
          <div className="bg-white px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown size={13} className="text-red-500" />
              <p className="text-xs text-gray-400">Despesas</p>
            </div>
            <p className="text-base font-bold text-red-600">{formatarMoeda(resumoMes.despesas)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">este mês</p>
          </div>
          <div className="bg-white px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Saldo</p>
            <p className={`text-base font-bold ${resumoMes.saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {resumoMes.saldo < 0 ? '−' : ''}{formatarMoeda(Math.abs(resumoMes.saldo))}
            </p>
            <Link to="/indicadores" className="text-[10px] text-gray-400 hover:text-green-700 transition-colors mt-0.5 block">
              ver Indicadores →
            </Link>
          </div>
        </div>
      </div>

      {/* Estado vazio */}
      {alertasCriticos.length === 0 && vencimentos7Dias.length === 0 && safrasAtivas.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 mt-4">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Tudo em dia! Nenhum alerta ou vencimento próximo.</p>
        </div>
      )}

      {/* ── Modal detalhe de alerta (popup) ── */}
      {modalAlerta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl max-h-[80vh] flex flex-col">
            {/* Header */}
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
              <button onClick={() => setModalAlerta(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            {/* Lista de itens */}
            <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
              {modalAlerta.itens?.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Todos os itens foram resolvidos.</p>
              )}
              {modalAlerta.itens?.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.descricao}</p>
                    <p className="text-xs text-gray-400">
                      Venc. {formatarData(item.vencimento)} · R$ {formatarValor(item.valor)}
                    </p>
                  </div>
                  <button
                    onClick={() => solicitarMarcarStatus(item, 'pago')}
                    disabled={salvandoStatus}
                    className="flex items-center gap-1 text-xs text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex-shrink-0"
                    style={{ background: 'var(--brand-gradient)' }}>
                    <CheckCircle size={11} />
                    Pago
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal confirmação de pagamento/recebimento ── */}
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
              <input
                type="date"
                value={confirmacaoStatus.dataConfirmacao}
                onChange={e => setConfirmacaoStatus(c => ({ ...c, dataConfirmacao: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">A data será registrada no lançamento Financeiro.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoStatus(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarMarcarStatus} disabled={salvandoStatus} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md" style={{ background: 'var(--brand-gradient)' }}>
                {salvandoStatus ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
