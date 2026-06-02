import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { ChevronDown, X, TrendingUp, TrendingDown, BarChart2, Layers, Tag, Award, DollarSign, Activity, Package, Settings as SettingsIcon } from 'lucide-react'
import { calcularDepreciacaoMensal } from '../services/depreciacao'

const ANO_ATUAL = new Date().getFullYear()

function fmtVal(v, dec = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtMoeda(v) {
  const n = Number(v || 0)
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}k`
  return `R$ ${fmtVal(n, 0)}`
}

function Barra({ nome, largura, cor = '#639922', valor }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-gray-500 w-28 flex-shrink-0 text-right truncate">{nome}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(largura, 100)}%`, background: cor }} />
      </div>
      <span className="text-[11px] text-gray-600 w-20 flex-shrink-0 text-right font-medium">{valor}</span>
    </div>
  )
}

function GraficoFluxoBipolar({ dados }) {
  const [tooltip, setTooltip] = useState(null)
  if (!dados?.length) return null
  const maxRec = Math.max(...dados.map(d => d.rec), 1)
  const maxDesp = Math.max(...dados.map(d => d.desp), 1)
  const metaPos = Math.max(...dados.map(d => d.rec)) > 0 ? 50 : 8
  const metaNeg = Math.max(...dados.map(d => d.desp)) > 0 ? 50 : 8
  const largBarra = 14, gap = 5
  const nGrupos = dados.length
  const totalW = 300
  const espacoGrupo = Math.floor((totalW - 12) / nGrupos)
  const px = 6, py = 8
  const totalH = metaPos + metaNeg + py * 2 + 18
  let acc = 0
  const acumulados = dados.map(d => { acc += d.saldo; return acc })
  const minA = Math.min(...acumulados, 0), maxA = Math.max(...acumulados, 0)
  const rangeA = Math.max(Math.abs(minA), Math.abs(maxA), 1)
  const centro = py + metaPos
  const xC = i => px + i * espacoGrupo + espacoGrupo / 2
  const yA = v => centro - (v / rangeA) * (metaPos * 0.85)
  const pontos = acumulados.map((v, i) => `${xC(i)},${yA(v)}`).join(' ')
  // Calcula saldo acumulado por índice para o tooltip
  let accTooltip = 0
  const acumPorMes = dados.map(d => { accTooltip += d.saldo; return accTooltip })
  return (
    <div className="relative" onMouseLeave={() => setTooltip(null)}>
      <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full" style={{ height: 'auto', maxHeight: 120 }}>
        <line x1={0} y1={centro} x2={totalW} y2={centro} stroke="#e5e7eb" strokeWidth="1" />
        {dados.map((d, i) => {
          const xGrupo = px + i * espacoGrupo
          const bW = Math.max(Math.min(largBarra, Math.floor(espacoGrupo * 0.35)), 6)
          const hR = maxRec > 0 ? (d.rec / maxRec) * metaPos : 0
          const hD = maxDesp > 0 ? (d.desp / maxDesp) * metaNeg : 0
          const pctX = (xC(i) / totalW) * 100
          return (
            <g key={d.chave} onMouseEnter={() => setTooltip({ ...d, acumulado: acumPorMes[i], pctX })} style={{ cursor: 'default' }}>
              <rect x={xGrupo + 2} y={centro - hR} width={bW} height={Math.max(hR, 1)} rx="2" fill="#16a34a" opacity="0.85" />
              <rect x={xGrupo + bW + gap + 2} y={centro} width={bW} height={Math.max(hD, 1)} rx="2" fill="#ef4444" opacity="0.75" />
              <text x={xC(i)} y={totalH - 2} textAnchor="middle" fontSize="7.5" fill="#9ca3af">{d.label}</text>
            </g>
          )
        })}
        <polyline points={pontos} fill="none" stroke="#EF9F27" strokeWidth="1.5" strokeLinejoin="round" />
        {acumulados.map((v, i) => <circle key={i} cx={xC(i)} cy={yA(v)} r="2.5" fill="#EF9F27" />)}
      </svg>
      {tooltip && (
        <div className="absolute bg-gray-900 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-lg pointer-events-none z-10 whitespace-nowrap"
          style={{ bottom: '100%', left: `${tooltip.pctX}%`, transform: 'translateX(-50%)', marginBottom: 2 }}>
          <p className="font-semibold capitalize mb-0.5">{tooltip.nomeMes}</p>
          <p className="text-green-400">Receitas: {fmtMoeda(tooltip.receitas)}</p>
          <p className="text-red-400">Despesas: {fmtMoeda(tooltip.despesas)}</p>
          <p className={`font-bold mt-0.5 ${tooltip.acumulado >= 0 ? 'text-amber-300' : 'text-red-300'}`}>Acumulado: {fmtMoeda(tooltip.acumulado)}</p>
        </div>
      )}
    </div>
  )
}

function GraficoCascata({ precoMedio, categorias, margem }) {
  const [tooltip, setTooltip] = useState(null)
  if (!precoMedio) return null
  const top2 = categorias.slice(0, 2)
  const demaisVal = categorias.slice(2).reduce((s, c) => s + c.valor, 0)
  const barras = [
    { label: 'Preço médio', valor: precoMedio, tipo: 'positivo' },
    ...top2.map(c => ({ label: c.nome, valor: c.valor, tipo: 'deducao' })),
    ...(demaisVal > 0 ? [{ label: 'Demais', valor: demaisVal, tipo: 'deducao' }] : []),
    { label: 'Margem', valor: Math.abs(margem), tipo: margem >= 0 ? 'resultado_pos' : 'resultado_neg' },
  ]
  const H = 80, labelH = 28
  const totalW = 300
  const barW = Math.floor((totalW - (barras.length + 1) * 6) / barras.length)
  const gap = Math.floor((totalW - barras.length * barW) / (barras.length + 1))
  let topo = precoMedio
  const fmtNum = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return (
    <div className="relative" onMouseLeave={() => setTooltip(null)}>
      <svg viewBox={`0 0 ${totalW} ${H + labelH}`} className="w-full" style={{ maxHeight: H + labelH }}>
        {barras.map((b, i) => {
          const x = gap + i * (barW + gap)
          const h = Math.max((b.valor / precoMedio) * H, 2)
          let y, fill
          if (b.tipo === 'positivo') { y = H - h; fill = '#16a34a'; topo = b.valor }
          else if (b.tipo === 'deducao') { topo -= b.valor; y = H - ((topo + b.valor) / precoMedio) * H; fill = '#EF9F27' }
          else { y = H - h; fill = b.tipo === 'resultado_pos' ? '#16a34a' : '#ef4444' }
          return (
            <g key={i} onMouseEnter={() => setTooltip({ label: b.label, valor: b.valor, tipo: b.tipo, x: x + barW / 2 })} style={{ cursor: 'default' }}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 2)} rx="3" fill={fill} opacity="0.88" />
              {/* Rótulo externo no topo da barra */}
              <text x={x + barW / 2} y={Math.max(y - 3, 8)} textAnchor="middle" fontSize="7" fill="#374151" fontWeight="600">R${fmtNum(b.valor)}</text>
              {/* Label da categoria embaixo */}
              <text x={x + barW / 2} y={H + 13} textAnchor="middle" fontSize="6.5" fill="#9ca3af">{b.label.length > 8 ? b.label.slice(0, 7) + '…' : b.label}</text>
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div className="absolute bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded-lg shadow-lg pointer-events-none z-10 whitespace-nowrap"
          style={{ bottom: '100%', left: `${(tooltip.x / (barras.length * (barW + gap) + gap)) * 100}%`, transform: 'translateX(-50%)', marginBottom: 4 }}>
          <p className="font-semibold">{tooltip.label}</p>
          <p className={tooltip.tipo === 'deducao' ? 'text-amber-300' : 'text-green-400'}>R$ {fmtNum(tooltip.valor)}</p>
        </div>
      )}
    </div>
  )
}

function KPIBar({ kpis }) {
  return (
    <div className="flex divide-x divide-gray-100 border-t border-gray-100">
      {kpis.map((k, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 px-2 py-2.5">
          {k.icon && <div className="mb-0.5">{k.icon}</div>}
          <p className={`text-sm font-bold leading-tight text-center ${k.cor || 'text-gray-800'}`}>{k.valor}</p>
          <p className="text-[10px] text-gray-400 text-center leading-tight">{k.label}</p>
        </div>
      ))}
    </div>
  )
}

function GraficoDonut({ dados, total, cores }) {
  const [tooltip, setTooltip] = useState(null)
  if (!dados?.length || !total) return null
  const raio = 55, esp = 24, cx = 60, cy = 60
  let ang = -90
  const fatias = dados.map((d, i) => {
    const pct = d.valor / total
    const graus = pct * 360
    const r1 = (ang * Math.PI) / 180
    const r2 = ((ang + graus) * Math.PI) / 180
    const x1 = cx + raio * Math.cos(r1), y1 = cy + raio * Math.sin(r1)
    const x2 = cx + raio * Math.cos(r2), y2 = cy + raio * Math.sin(r2)
    const la = graus > 180 ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${raio} ${raio} 0 ${la} 1 ${x2} ${y2} Z`
    ang += graus
    return { path, cor: cores[i % cores.length], nome: d.nome, pct: Math.round(pct * 100), valor: d.valor }
  })
  return (
    <div className="relative flex items-center gap-3" onMouseLeave={() => setTooltip(null)}>
      <svg viewBox="0 0 120 120" className="flex-shrink-0" style={{ width: 200, height: 120 }}>
        {fatias.map((f, i) => (
          <path key={i} d={f.path} fill={f.cor} opacity={tooltip?.nome === f.nome ? 1 : 0.88}
            onMouseEnter={() => setTooltip(f)} style={{ cursor: 'default', transition: 'opacity 0.15s' }} />
        ))}
        <circle cx={cx} cy={cy} r={raio - esp} fill="white" />
        {tooltip ? (
          <>
            <text x={cx} y={cy - 5} textAnchor="middle" fontSize="9" fill="#374151" fontWeight="700">{tooltip.pct}%</text>
            <text x={cx} y={cy + 8} textAnchor="middle" fontSize="7.5" fill="#6b7280">{fmtMoeda(tooltip.valor)}</text>
          </>
        ) : null}
      </svg>
      {tooltip && (
        <div className="absolute top-0 left-28 bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded-lg shadow-lg pointer-events-none z-10 whitespace-nowrap">
          <p className="font-semibold">{tooltip.nome}</p>
          <p className="text-gray-300">{fmtMoeda(tooltip.valor)} · {tooltip.pct}%</p>
        </div>
      )}
      <div className="flex-1 space-y-0.5 min-w-0">
        {fatias.slice(0, 6).map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: f.cor }} />
            <span className="text-[9px] text-gray-500 truncate flex-1">{f.nome}</span>
            <span className="text-[9px] font-semibold text-gray-600 flex-shrink-0">{f.pct}%</span>
          </div>
        ))}
        {fatias.length > 5 && <p className="text-[9px] text-gray-400">+{fatias.length - 5} outros</p>}
      </div>
    </div>
  )
}

function CardIndicador({ titulo, badge, kpis, kpiBar, grafico, onVerDetalhes }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">{titulo}</p>
        {badge && (
          <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 font-medium"
            style={{ background: badge.bg, color: badge.cor }}>
            {badge.texto}
          </span>
        )}
      </div>
      {kpiBar ? <KPIBar kpis={kpiBar} /> : (
      <div className="flex flex-wrap gap-4 px-4 pb-3">
        {(kpis || []).map((k, i) => (
          <div key={i}>
            <p className="text-xl font-bold text-gray-800 leading-tight">{k.valor}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
            {k.delta && (
              <p className={`text-[10px] mt-0.5 font-medium ${k.deltaPos ? 'text-green-700' : 'text-red-600'}`}>{k.delta}</p>
            )}
          </div>
        ))}
      </div>
      )}
      {grafico && <div className="border-t border-gray-100 px-4 py-3">{grafico}</div>}
      {onVerDetalhes && (
        <button type="button" onClick={onVerDetalhes}
          className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 py-2 border-t border-gray-100 hover:bg-gray-50 transition-colors">
          <BarChart2 size={11} /> ver detalhes
        </button>
      )}
    </div>
  )
}

function ModalDetalhe({ titulo, subtitulo, kpis, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-lg shadow-xl max-h-[92vh] flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-800 text-base">{titulo}</h2>
            {subtitulo && <p className="text-xs text-gray-400 mt-0.5">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"><X size={18} /></button>
        </div>
        {kpis?.length > 0 && (
          <div className="px-5 py-4 grid grid-cols-3 gap-2 border-b border-gray-100 flex-shrink-0">
            {kpis.map((k, i) => (
              <div key={i} className="bg-gray-50 rounded-xl px-2 py-2.5 border border-gray-100 text-center">
                <p className={`text-sm font-bold leading-tight ${k.cor || 'text-gray-800'}`}>{k.valor}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">{children}</div>
      </div>
    </div>
  )
}

function LinhaDetalhe({ label, valor, sub, destaque = false }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 flex-1">{label}</span>
      <div className="text-right">
        <span className={`text-xs font-semibold ${destaque ? 'text-green-700' : 'text-gray-700'}`}>{valor}</span>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function SecaoDetalhe({ titulo, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{titulo}</p>
      {children}
    </div>
  )
}

const CORES = ['#639922', '#EF9F27', '#378ADD', '#B4B2A9', '#E24B4A', '#7C3AED', '#0891B2']

export default function Indicadores() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownAberto, setDropdownAberto] = useState(false)
  const [modalAberto, setModalAberto] = useState(null)
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [colheitas, setColheitas] = useState([])
  const [financeiro, setFinanceiro] = useState([])
  const [patrimonios, setPatrimonios] = useState([])
  const [movInsumos, setMovInsumos] = useState([])
  const [insumos, setInsumos] = useState([])
  const [lotesEstoque, setLotesEstoque] = useState([])
  const [movsProducao, setMovsProducao] = useState([])

  useEffect(() => {
    async function carregar() {
      const uid = usuario.uid
      const q = col => query(collection(db, col), where('uid', '==', uid))
      const [safrasSnap, lavSnap, colSnap, finSnap, patSnap, movInsSnap, insSnap, lotesSnap, movsProdSnap] = await Promise.all([
        getDocs(q('safras')), getDocs(q('lavouras')), getDocs(q('colheitas')),
        getDocs(q('financeiro')), getDocs(q('patrimonios')),
        getDocs(q('movimentacoesInsumos')), getDocs(q('insumos')),
        getDocs(q('estoqueProducao')), getDocs(q('movimentacoesProducao')),
      ])
      setSafras(safrasSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setColheitas(colSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
      setFinanceiro(finSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
      setPatrimonios(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setMovInsumos(movInsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
      setInsumos(insSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLotesEstoque(lotesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
      setMovsProducao(movsProdSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
      setLoading(false)
    }
    carregar()
  }, [usuario])

  useEffect(() => {
    const fechar = e => { if (!e.target.closest('[data-dd-ind]')) setDropdownAberto(false) }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const safraRef = useMemo(() =>
    filtroSafraId ? safras.find(s => s.id === filtroSafraId) : safras.find(s => s.status === 'Em andamento') || safras[0]
  , [safras, filtroSafraId])

  const colheitasDaSafra = useMemo(() => safraRef ? colheitas.filter(c => c.safraId === safraRef.id) : [], [colheitas, safraRef])
  const lavourasDaSafra = useMemo(() => { if (!safraRef?.lavouraIds?.length) return []; return lavouras.filter(l => safraRef.lavouraIds.includes(l.id)) }, [lavouras, safraRef])
  const areaTotalSafra = useMemo(() => lavourasDaSafra.reduce((s, l) => s + (Number(l.areaHa) || 0), 0), [lavourasDaSafra])

  const custoDaSafra = safraRef?.custoEstimado || null
  const custoPorSc = custoDaSafra?.total ?? null
  const unidade = safraRef?.unidade || colheitasDaSafra[0]?.unidade || 'sc'
  const custoPorHa = useMemo(() => (!custoDaSafra?.totalDespesas || !areaTotalSafra) ? null : custoDaSafra.totalDespesas / areaTotalSafra, [custoDaSafra, areaTotalSafra])

  const custoPorLavoura = useMemo(() => {
    if (!custoDaSafra?.porLavoura) return []
    return Object.entries(custoDaSafra.porLavoura).map(([id, v]) => {
      const lav = lavouras.find(l => l.id === id)
      const areaHa = Number(lav?.areaHa) || 0
      return { id, nome: v.lavouraNome || id, custoSc: v.custoSc, despesaTotal: v.despesaTotal, qtdColhida: v.quantidadeColhida || 0, areaHa, custoHa: areaHa > 0 && v.despesaTotal ? v.despesaTotal / areaHa : null }
    }).filter(l => l.custoSc !== null || l.despesaTotal > 0).sort((a, b) => (a.custoSc || 0) - (b.custoSc || 0))
  }, [custoDaSafra, lavouras])
  const minCustoLavoura = Math.min(...custoPorLavoura.map(l => l.custoSc || 0), 0)
  const maxCustoLavoura = Math.max(...custoPorLavoura.map(l => l.custoSc || 0), 1)

  const produtividadePorLavoura = useMemo(() => {
    if (!safraRef) return []
    const mapa = {}
    colheitasDaSafra.forEach(c => {
      const nome = c.lavouraNome || c.lavouraId || 'Sem lavoura'
      const id = c.lavouraId || nome
      if (!mapa[id]) { const lav = lavouras.find(l => l.id === id); mapa[id] = { nome, total: 0, areaHa: Number(c.areaHa) || Number(lav?.areaHa) || 0 } }
      mapa[id].total += Number(c.quantidade) || 0
    })
    return Object.values(mapa).sort((a, b) => {
      const sA = a.areaHa > 0 ? a.total / a.areaHa : 0
      const sB = b.areaHa > 0 ? b.total / b.areaHa : 0
      return sB - sA
    })
  }, [colheitasDaSafra, lavouras, safraRef])

  const totalColhido = colheitasDaSafra.reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
  const maxScHa = Math.max(...produtividadePorLavoura.map(l => l.areaHa > 0 ? l.total / l.areaHa : 0), 1)
  const scPorHaGeral = areaTotalSafra > 0 && totalColhido > 0 ? totalColhido / areaTotalSafra : null

  const qualidadePorLavoura = useMemo(() => {
    if (!safraRef) return []
    const mapa = {}
    lotesEstoque.filter(l => l.safraId === safraRef.id && l.classificacao).forEach(l => {
      const nome = l.lavouraNome || l.lavouraId || 'Sem lavoura'
      if (!mapa[nome]) mapa[nome] = { nome, classifs: [], qtdTotal: 0 }
      mapa[nome].classifs.push({ classif: l.classificacao, qtd: l.quantidadeEntrada || 0 })
      mapa[nome].qtdTotal += l.quantidadeEntrada || 0
    })
    return Object.values(mapa).map(item => {
      const predominante = [...item.classifs].sort((a, b) => b.qtd - a.qtd)[0]?.classif || 'n/d'
      const todas = [...new Set(item.classifs.map(c => c.classif))].join(', ')
      return { ...item, predominante, todas }
    }).sort((a, b) => b.qtdTotal - a.qtdTotal)
  }, [lotesEstoque, safraRef])

  const { margemPorSc, totalReceita, totalReceitaLiquida, percVendido, vendasPorComprador, qtdVendida } = useMemo(() => {
    if (!safraRef) return { margemPorSc: null, totalReceita: 0, totalReceitaLiquida: 0, percVendido: 0, vendasPorComprador: [], qtdVendida: 0 }
    const recSafra = financeiro.filter(f => f.safraId === safraRef.id && f.tipo === 'receita' && f.origemEstoqueProducao === true)
    const totalBruto = recSafra.reduce((s, f) => s + (Number(f.valorBruto) || Number(f.valor) || 0), 0)
    const totalLiq = recSafra.reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const vendasSafra = movsProducao.filter(m => m.tipo === 'saida_venda' && m.safraId === safraRef.id)
    const qtdV = vendasSafra.reduce((s, m) => s + (Number(m.quantidade) || 0), 0)
    const perc = totalColhido > 0 ? Math.round((qtdV / totalColhido) * 100) : 0
    const precoMedio = qtdV > 0 ? totalLiq / qtdV : 0
    const margem = custoPorSc !== null && precoMedio > 0 ? precoMedio - custoPorSc : null
    const porComp = {}
    vendasSafra.forEach(m => { const c = m.comprador?.trim() || 'Sem comprador'; if (!porComp[c]) porComp[c] = { qtd: 0, valor: 0 }; porComp[c].qtd += Number(m.quantidade) || 0; porComp[c].valor += Number(m.valorLiquido) || 0 })
    const vPC = Object.entries(porComp).map(([comp, v]) => ({ comp, ...v, precoMedio: v.qtd > 0 ? v.valor / v.qtd : 0 })).sort((a, b) => b.valor - a.valor)
    return { margemPorSc: margem, totalReceita: totalBruto, totalReceitaLiquida: totalLiq, percVendido: perc, vendasPorComprador: vPC, qtdVendida: qtdV }
  }, [financeiro, movsProducao, safraRef, totalColhido, custoPorSc])

  const precoMedioVenda = qtdVendida > 0 ? totalReceitaLiquida / qtdVendida : 0

  const { custoPorCategoria, totalCatCusto } = useMemo(() => {
    if (!safraRef) return { custoPorCategoria: [], totalCatCusto: 0 }
    const mapa = {}
    financeiro.filter(f => f.safraId === safraRef.id && f.tipo === 'despesa' && !f.origemEstoqueProducao && f.categoria !== 'Investimentos').forEach(f => { const cat = f.categoria || 'Outros'; mapa[cat] = (mapa[cat] || 0) + (Number(f.valor) || 0) })
    movInsumos.filter(m => m.tipoMov === 'saida' && m.safraId === safraRef.id).forEach(m => { const c = Number(m.custoCalculado) || 0; if (c > 0) mapa['Insumos'] = (mapa['Insumos'] || 0) + c })
    const deprec = safraRef?.custoEstimado?.totalDepreciacao || 0
    if (deprec > 0) mapa['Depreciacao'] = (mapa['Depreciacao'] || 0) + deprec
    const lista = Object.entries(mapa).map(([nome, valor]) => ({ nome, valor })).filter(c => c.valor > 0).sort((a, b) => b.valor - a.valor)
    return { custoPorCategoria: lista, totalCatCusto: lista.reduce((s, c) => s + c.valor, 0) }
  }, [financeiro, movInsumos, safraRef])

  const catsCascata = useMemo(() => {
    if (!custoPorCategoria.length || !custoPorSc || !totalCatCusto) return []
    const fator = custoPorSc / totalCatCusto
    return custoPorCategoria.map(c => ({ nome: c.nome, valor: c.valor * fator }))
  }, [custoPorCategoria, custoPorSc, totalCatCusto])

  const fluxoMensal = useMemo(() => {
    // Determina período: início da safra selecionada até hoje ou último mês com movimento
    const finFiltrado = filtroSafraId
      ? financeiro.filter(f => f.safraId === filtroSafraId)
      : financeiro

    // Data de início: dataInicio da safra, ou primeiro registro financeiro
    let dataIni = safraRef?.dataInicio || safraRef?.dataPlantio || null
    if (!dataIni && finFiltrado.length > 0) {
      const datas = finFiltrado.map(f => f.vencimento || f.data || '').filter(Boolean).sort()
      dataIni = datas[0]
    }
    if (!dataIni) dataIni = new Date().toISOString().substring(0, 7) + '-01'

    // Data de fim: hoje ou último mês com movimento (o que for mais tarde)
    const hojeChave = new Date().toISOString().substring(0, 7)
    const datasComMov = finFiltrado.map(f => (f.vencimento || f.data || '').substring(0, 7)).filter(Boolean)
    const ultimoMov = datasComMov.length > 0 ? [...datasComMov].sort().pop() : hojeChave
    const fimChave = ultimoMov > hojeChave ? ultimoMov : hojeChave

    // Gera array de meses entre início e fim
    const meses = []
    const cur = new Date(dataIni.substring(0, 7) + '-01')
    const fim = new Date(fimChave + '-01')
    while (cur <= fim) {
      const chave = cur.toISOString().substring(0, 7)
      const label = cur.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      const base = finFiltrado.filter(f => { const dr = f.vencimento || f.data || ''; return dr.startsWith(chave) })
      const rec = base.filter(f => f.tipo === 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
      const desp = base.filter(f => f.tipo !== 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
      meses.push({ chave, nomeMes: label, label, rec, desp, receitas: rec, despesas: desp, saldo: rec - desp })
      cur.setMonth(cur.getMonth() + 1)
    }
    return meses
  }, [financeiro, filtroSafraId, safraRef])
  const saldoAcumulado = fluxoMensal.reduce((s, m) => s + m.saldo, 0)

  const insumosComSaldo = useMemo(() => {
    const saldos = {}
    movInsumos.forEach(m => { const pid = m.produtoId; if (!pid) return; if (saldos[pid] === undefined) saldos[pid] = 0; if (m.tipoMov === 'entrada') saldos[pid] += Number(m.quantidade) || 0; else if (m.tipoMov === 'saida') saldos[pid] -= Number(m.quantidade) || 0 })
    return insumos.map(ins => {
      const saldo = Math.max(saldos[ins.id] || 0, 0)
      const ents = movInsumos.filter(m => m.produtoId === ins.id && m.tipoMov === 'entrada' && m.valorTotal && m.quantidade).sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
      const precoUlt = ents.length ? ents[0].valorTotal / ents[0].quantidade : 0
      return { ...ins, saldoReal: saldo, precoUlt, valorEstoque: saldo * precoUlt }
    }).filter(i => i.saldoReal > 0).sort((a, b) => b.valorEstoque - a.valorEstoque)
  }, [insumos, movInsumos])
  const valorTotalInsumos = insumosComSaldo.reduce((s, i) => s + i.valorEstoque, 0)

  const anoAtualStr = String(ANO_ATUAL)
  const custoPorEquipamento = useMemo(() => patrimonios.map(p => {
    const gastos = financeiro.filter(f => f.patrimonioId === p.id && f.tipo !== 'receita' && f.categoria !== 'Investimentos' && (f.vencimento || '').startsWith(anoAtualStr)).reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const deprecAnual = calcularDepreciacaoMensal(p) * 12
    return { id: p.id, nome: p.nome || 'sem nome', categoria: p.categoria || '', gastos, deprecAnual, total: gastos + deprecAnual, vidaUtil: Number(p.vidaUtil) || 0 }
  }).filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 6), [patrimonios, financeiro, anoAtualStr])
  const totalEquip = custoPorEquipamento.reduce((s, e) => s + e.total, 0)
  const mediaEquip = custoPorEquipamento.length > 0 ? totalEquip / custoPorEquipamento.length : 0
  const maxEquip = Math.max(...custoPorEquipamento.map(e => e.total), 1)

  if (loading) return <div className="text-gray-400 text-sm p-4">Carregando indicadores...</div>
  const bs = safraRef ? { texto: safraRef.nome, bg: '#EAF3DE', cor: '#3B6D11' } : null

  return (
    <div className="space-y-4 pb-8">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-800">Indicadores</h1>
        <div className="relative" data-dd-ind>
          <button type="button" onClick={() => setDropdownAberto(v => !v)}
            className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white hover:border-green-400 transition-colors min-w-[180px] justify-between">
            <span className="text-gray-700 font-medium truncate">{safraRef ? safraRef.nome : 'Selecionar safra'}</span>
            <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
          </button>
          {dropdownAberto && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[200px] py-1">
              {safras.map(s => {
                const sel = s.id === (filtroSafraId || safraRef?.id)
                return (
                  <button key={s.id} type="button"
                    onClick={() => { setFiltroSafraId(s.id); setDropdownAberto(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${sel ? 'bg-green-50 text-green-800 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.status === 'Em andamento' ? 'bg-green-500' : 'bg-gray-300'}`} />
                    {s.nome}
                    {s.status === 'Em andamento' && <span className="ml-auto text-[9px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">ativa</span>}
                  </button>
                )
              })}
              {filtroSafraId && (
                <button type="button" onClick={() => { setFiltroSafraId(''); setDropdownAberto(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-red-500 border-t border-gray-100">
                  <X size={11} /> Limpar filtro
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hero da safra */}
      {safraRef && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <Layers size={14} className="text-green-700" />
            <p className="text-xs font-semibold text-gray-600">{safraRef.nome}{safraRef.cultura ? ` · ${safraRef.cultura}` : ''}</p>
            <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${safraRef.status === 'Em andamento' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{safraRef.status}</span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 mt-2">
            {[
              { label: `Custo/${unidade}`, valor: custoPorSc !== null ? `R$ ${fmtVal(custoPorSc, 0)}` : 'n/d', icon: <TrendingDown size={13} className="text-orange-500" />, cor: 'text-gray-800' },
              { label: 'Produt. média', valor: scPorHaGeral !== null ? `${fmtVal(scPorHaGeral, 1)} ${unidade}/ha` : 'n/d', icon: <TrendingUp size={13} className="text-green-600" />, cor: 'text-green-700' },
              { label: `Margem/${unidade}`, valor: margemPorSc !== null ? `R$ ${fmtVal(margemPorSc, 0)}` : 'n/d', icon: margemPorSc !== null && margemPorSc >= 0 ? <TrendingUp size={13} className="text-green-600" /> : <TrendingDown size={13} className="text-red-500" />, cor: margemPorSc !== null && margemPorSc >= 0 ? 'text-green-700' : 'text-red-600' },
            ].map((k, i) => (
              <div key={i} className="px-4 py-3 flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1">{k.icon}<p className={`text-base font-bold ${k.cor}`}>{k.valor}</p></div>
                <p className="text-[10px] text-gray-400">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <CardIndicador titulo="Custo de producao" badge={bs}
          kpiBar={[
            { icon: <Tag size={12} className="text-orange-500" />, valor: custoPorSc !== null ? `R$ ${fmtVal(custoPorSc, 2)}/${unidade}` : 'n/d', label: `custo/${unidade}`, cor: 'text-orange-700' },
            { icon: <TrendingDown size={12} className="text-gray-500" />, valor: custoPorHa !== null ? `R$ ${fmtVal(custoPorHa, 0)}/ha` : 'n/d', label: 'por hectare', cor: 'text-gray-700' },
            ...(custoDaSafra?.totalDespesas ? [{ icon: <DollarSign size={12} className="text-gray-400" />, valor: fmtMoeda(custoDaSafra.totalDespesas), label: 'custo total', cor: 'text-gray-700' }] : []),
          ]}
          grafico={custoPorLavoura.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Custo por lavoura — menor para maior (R$/{unidade})</p>
            {custoPorLavoura.slice(0, 4).map(l => <Barra key={l.id} nome={l.nome} largura={((l.custoSc - minCustoLavoura) / Math.max(maxCustoLavoura - minCustoLavoura, 1)) * 100} cor={custoPorSc && l.custoSc > custoPorSc * 1.1 ? '#EF9F27' : '#639922'} valor={`R$ ${fmtVal(l.custoSc, 2)}/${unidade}`} />)}
            {custoPorLavoura.length > 4 && <p className="text-[10px] text-gray-400 mt-1">+{custoPorLavoura.length - 4} lavouras nos detalhes</p>}
            </>
          ) : <p className="text-xs text-gray-400">Custo nao calculado. Acesse o painel de debug.</p>}
          onVerDetalhes={custoPorLavoura.length > 0 ? () => setModalAberto('custo') : null}
        />

        <CardIndicador titulo="Produtividade" badge={bs}
          kpiBar={[
            { icon: <TrendingUp size={12} className="text-green-600" />, valor: totalColhido > 0 ? `${fmtVal(totalColhido)} ${unidade}` : 'n/d', label: 'total colhido', cor: 'text-green-700' },
            { icon: <Activity size={12} className="text-green-500" />, valor: scPorHaGeral !== null ? `${fmtVal(scPorHaGeral, 1)} ${unidade}/ha` : 'n/d', label: 'produt. média', cor: 'text-green-700' },
          ]}
          grafico={produtividadePorLavoura.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">{unidade}/ha por lavoura</p>
            {produtividadePorLavoura.slice(0, 4).map(l => {
              const scHa = l.areaHa > 0 ? l.total / l.areaHa : null
              return scHa !== null ? <Barra key={l.nome} nome={l.nome} largura={(scHa / maxScHa) * 100} cor="#639922" valor={`${fmtVal(scHa, 1)} ${unidade}/ha`} /> : null
            })}
            {produtividadePorLavoura.length > 4 && <p className="text-[10px] text-gray-400 mt-1">+{produtividadePorLavoura.length - 4} lavouras nos detalhes</p>}
            </>
          ) : <p className="text-xs text-gray-400">Nenhuma colheita registrada.</p>}
          onVerDetalhes={produtividadePorLavoura.length > 0 ? () => setModalAberto('produtividade') : null}
        />

        <CardIndicador titulo="Qualidade por lavoura" badge={bs}
          kpiBar={[{ icon: <Award size={12} className="text-amber-500" />, valor: qualidadePorLavoura.length > 0 ? `${qualidadePorLavoura.length} lavoura${qualidadePorLavoura.length > 1 ? 's' : ''}` : 'n/d', label: 'com classificação', cor: 'text-amber-700' }]}
          grafico={qualidadePorLavoura.length > 0 ? (() => {
            const maxQtd = Math.max(...qualidadePorLavoura.map(x => x.qtdTotal), 1)
            return (<><p className="text-[10px] text-gray-400 mb-2">Tamanho proporcional à quantidade colhida</p>
              {qualidadePorLavoura.slice(0, 4).map(l => (
                <div key={l.nome} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] text-gray-500 w-20 flex-shrink-0 text-right truncate">{l.nome}</span>
                  <div className="flex-1 relative h-5">
                    <div className="absolute top-0 left-0 h-full rounded-full flex items-center px-2 overflow-hidden"
                      style={{ width: `${Math.max((l.qtdTotal / maxQtd) * 100, 15)}%`, background: '#fef3c7', border: '1px solid #fcd34d', minWidth: 40 }}>
                      <span className="text-[10px] font-semibold text-amber-800 truncate">{l.predominante}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0 text-right">{fmtVal(l.qtdTotal)} {unidade}</span>
                </div>
              ))}
              {qualidadePorLavoura.length > 4 && <p className="text-[10px] text-gray-400 mt-1">+{qualidadePorLavoura.length - 4} nos detalhes</p>}
            </>)
          })() : <p className="text-xs text-gray-400">Nenhuma classificação nos lotes desta safra.</p>}
          onVerDetalhes={qualidadePorLavoura.length > 0 ? () => setModalAberto('qualidade') : null}
        />

        <CardIndicador titulo="Margem e rentabilidade"
          kpiBar={[
            { icon: percVendido > 0 ? <TrendingUp size={12} className="text-green-500" /> : <Activity size={12} className="text-gray-400" />, valor: `${percVendido}% vendido`, label: `${fmtVal(qtdVendida, 0)} de ${fmtVal(totalColhido, 0)} ${unidade}`, cor: percVendido >= 80 ? 'text-green-700' : 'text-gray-600' },
            { icon: <DollarSign size={12} className={margemPorSc !== null && margemPorSc >= 0 ? 'text-green-500' : 'text-red-500'} />, valor: margemPorSc !== null ? `R$ ${fmtVal(Math.abs(margemPorSc), 0)}/${unidade}` : 'n/d', label: margemPorSc !== null && margemPorSc >= 0 ? 'margem positiva' : 'margem negativa', cor: margemPorSc !== null && margemPorSc >= 0 ? 'text-green-700' : 'text-red-600' },
            { icon: <TrendingUp size={12} className="text-gray-400" />, valor: precoMedioVenda > 0 ? `R$ ${fmtVal(precoMedioVenda, 0)}/${unidade}` : 'n/d', label: 'preço médio venda', cor: 'text-gray-700' },
          ]}

          grafico={precoMedioVenda > 0 && catsCascata.length > 0 ? (
            <>
              <p className="text-[10px] text-gray-400 mb-2">Decomposição da margem (R$/{unidade})</p>
              <GraficoCascata precoMedio={precoMedioVenda} categorias={catsCascata} margem={margemPorSc || 0} />
            </>
          ) : <p className="text-xs text-gray-400">Nenhuma venda registrada.</p>}
          onVerDetalhes={(vendasPorComprador.length > 0 || margemPorSc !== null) ? () => setModalAberto('margem') : null}
        />

        <CardIndicador titulo="Custo por categoria" badge={bs}
          kpiBar={[
            { icon: <Tag size={12} className="text-purple-500" />, valor: totalCatCusto > 0 ? fmtMoeda(totalCatCusto) : 'n/d', label: 'custo total', cor: 'text-purple-700' },
            { icon: <Activity size={12} className="text-gray-400" />, valor: `${custoPorCategoria.length} categorias`, label: 'identificadas', cor: 'text-gray-600' },
          ]}
          grafico={custoPorCategoria.length > 0
            ? <GraficoDonut dados={custoPorCategoria.slice(0, 7)} total={totalCatCusto} cores={CORES} />
            : <p className="text-xs text-gray-400">Nenhuma despesa categorizada.</p>}
          onVerDetalhes={custoPorCategoria.length > 0 ? () => setModalAberto('categoria') : null}
        />

        <CardIndicador titulo="Fluxo de caixa"
          kpiBar={[
            { icon: <Activity size={12} className={saldoAcumulado >= 0 ? 'text-amber-500' : 'text-red-500'} />, valor: fmtMoeda(saldoAcumulado), label: 'saldo acumulado', cor: saldoAcumulado >= 0 ? 'text-amber-600' : 'text-red-600' },
            { icon: <TrendingUp size={12} className="text-green-500" />, valor: fmtMoeda(fluxoMensal.reduce((s, m) => s + m.receitas, 0)), label: `receitas (${safraRef?.nome || 'safra'})`, cor: 'text-green-700' },
            { icon: <TrendingDown size={12} className="text-red-500" />, valor: fmtMoeda(fluxoMensal.reduce((s, m) => s + m.despesas, 0)), label: `despesas (${safraRef?.nome || 'safra'})`, cor: 'text-red-600' },
          ]}
          grafico={
            <>
              <p className="text-[10px] text-gray-400 mb-2">{safraRef ? `${safraRef.nome} · ${fluxoMensal[0]?.nomeMes || ''} → ${fluxoMensal[fluxoMensal.length-1]?.nomeMes || ''}` : 'Toda a propriedade'} ({fluxoMensal.length} meses)</p>
              <GraficoFluxoBipolar dados={fluxoMensal} />
              <div className="flex items-center gap-4 mt-1">
                <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" />Receitas</span>
                <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Despesas</span>
                <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />Acumulado</span>
              </div>
            </>
          }
          onVerDetalhes={() => setModalAberto('fluxo')}
        />

        <CardIndicador titulo="Insumos em estoque"
          kpiBar={[
            { icon: <Package size={12} className="text-blue-500" />, valor: fmtMoeda(valorTotalInsumos), label: 'valor em estoque', cor: 'text-blue-700' },
            { icon: <Activity size={12} className="text-gray-400" />, valor: `${insumosComSaldo.length} produtos`, label: 'com saldo positivo', cor: 'text-gray-600' },
          ]}
          grafico={insumosComSaldo.length > 0
            ? <GraficoDonut dados={insumosComSaldo.slice(0, 7).map(i => ({ nome: i.produto || i.nome || 'sem nome', valor: i.valorEstoque }))} total={valorTotalInsumos} cores={CORES} />
            : <p className="text-xs text-gray-400">Nenhum insumo com saldo.</p>}
          onVerDetalhes={insumosComSaldo.length > 0 ? () => setModalAberto('insumos') : null}
        />

        <CardIndicador titulo="Custo por equipamento"
          kpiBar={[
            { icon: <SettingsIcon size={12} className="text-gray-500" />, valor: fmtMoeda(totalEquip), label: `custo total ${ANO_ATUAL}`, cor: 'text-gray-800' },
            { icon: <Activity size={12} className="text-gray-400" />, valor: fmtMoeda(mediaEquip), label: 'média/equip/ano', cor: 'text-gray-600' },
          ]}
          grafico={custoPorEquipamento.length > 0 ? (
            <>
              <p className="text-[10px] text-gray-400 mb-2">Custo anual - {ANO_ATUAL}</p>
              {custoPorEquipamento.slice(0, 4).map(e => <Barra key={e.id} nome={e.nome} largura={(e.total / maxEquip) * 100} cor={e.total > mediaEquip * 1.3 ? '#EF9F27' : '#639922'} valor={fmtMoeda(e.total)} />)}
              {custoPorEquipamento.length > 4 && <p className="text-[10px] text-gray-400 mt-1">+{custoPorEquipamento.length - 4} equipamentos nos detalhes</p>}
            </>
          ) : <p className="text-xs text-gray-400">Nenhum patrimonio com custos cadastrado.</p>}
          onVerDetalhes={custoPorEquipamento.length > 0 ? () => setModalAberto('equipamento') : null}
        />

      </div>

      {/* Modais */}
      {modalAberto === 'custo' && (
        <ModalDetalhe titulo="Custo de producao" subtitulo={safraRef?.nome}
          kpis={[
            { label: `Custo/${unidade}`, valor: custoPorSc !== null ? `R$ ${fmtVal(custoPorSc, 0)}` : 'n/d' },
            { label: 'Por ha', valor: custoPorHa !== null ? `R$ ${fmtVal(custoPorHa, 0)}` : 'n/d' },
            { label: 'Total', valor: custoDaSafra?.totalDespesas ? fmtMoeda(custoDaSafra.totalDespesas) : 'n/d' },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Por lavoura">
            {custoPorLavoura.map(l => <LinhaDetalhe key={l.id} label={l.nome} valor={`R$ ${fmtVal(l.custoSc || 0, 0)}/${unidade}`} sub={[l.custoHa ? `R$ ${fmtVal(l.custoHa, 0)}/ha` : null, l.despesaTotal ? `Total: ${fmtMoeda(l.despesaTotal)}` : null, l.qtdColhida ? `${fmtVal(l.qtdColhida)} ${unidade} colhidos` : null].filter(Boolean).join(' · ')} destaque={custoPorSc !== null && l.custoSc !== null && l.custoSc <= custoPorSc} />)}
          </SecaoDetalhe>
          {areaTotalSafra > 0 && (
            <SecaoDetalhe titulo="Area e cobertura">
              <LinhaDetalhe label="Area total" valor={`${fmtVal(areaTotalSafra, 1)} ha`} />
              <LinhaDetalhe label="Lavouras calculadas" valor={`${custoPorLavoura.length} de ${lavourasDaSafra.length}`} />
              {custoDaSafra?.coberturaPercent !== undefined && <LinhaDetalhe label="Cobertura" valor={`${custoDaSafra.coberturaPercent}%`} destaque={custoDaSafra.coberturaPercent >= 80} />}
            </SecaoDetalhe>
          )}
        </ModalDetalhe>
      )}

      {modalAberto === 'produtividade' && (
        <ModalDetalhe titulo="Produtividade" subtitulo={safraRef?.nome}
          kpis={[
            { label: 'Total colhido', valor: `${fmtVal(totalColhido)} ${unidade}`, cor: 'text-green-700' },
            { label: `${unidade}/ha`, valor: scPorHaGeral !== null ? `${fmtVal(scPorHaGeral, 1)}` : 'n/d', cor: 'text-green-700' },
            { label: 'Area total', valor: areaTotalSafra > 0 ? `${fmtVal(areaTotalSafra, 1)} ha` : 'n/d' },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Por lavoura">
            {produtividadePorLavoura.map(l => {
              const scHa = l.areaHa > 0 ? l.total / l.areaHa : null
              return <LinhaDetalhe key={l.nome} label={l.nome}
                valor={scHa !== null ? `${fmtVal(scHa, 1)} ${unidade}/ha` : `${fmtVal(l.total)} ${unidade}`}
                sub={[l.areaHa ? `${fmtVal(l.areaHa, 1)} ha` : null, `${fmtVal(l.total)} ${unidade} colhidos`, scHa !== null && scPorHaGeral !== null ? (scHa >= scPorHaGeral ? 'acima da media' : 'abaixo da media') : null].filter(Boolean).join(' · ')}
                destaque={scHa !== null && scPorHaGeral !== null && scHa >= scPorHaGeral} />
            })}
          </SecaoDetalhe>
        </ModalDetalhe>
      )}

      {modalAberto === 'qualidade' && (
        <ModalDetalhe titulo="Qualidade por lavoura" subtitulo={safraRef?.nome}
          kpis={[
            { label: 'Classificadas', valor: `${qualidadePorLavoura.length} lavouras`, cor: 'text-amber-700' },
            { label: 'Total', valor: `${fmtVal(qualidadePorLavoura.reduce((s, l) => s + l.qtdTotal, 0))} ${unidade}` },
            { label: 'Tipos', valor: `${new Set(qualidadePorLavoura.map(l => l.predominante)).size}` },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Por lavoura">
            {qualidadePorLavoura.map(l => <LinhaDetalhe key={l.nome} label={l.nome} valor={l.predominante} sub={l.todas !== l.predominante ? `Todas: ${l.todas} · ${fmtVal(l.qtdTotal)} ${unidade}` : `${fmtVal(l.qtdTotal)} ${unidade} classificados`} />)}
          </SecaoDetalhe>
          <p className="text-[10px] text-gray-400">Classificacao registrada ao dar entrada no Estoque de Producao.</p>
        </ModalDetalhe>
      )}

      {modalAberto === 'margem' && (
        <ModalDetalhe titulo="Margem e rentabilidade" subtitulo={safraRef?.nome}
          kpis={[
            { label: `Custo/${unidade}`, valor: custoPorSc !== null ? `R$ ${fmtVal(custoPorSc, 0)}` : 'n/d' },
            { label: 'Preco medio', valor: precoMedioVenda > 0 ? `R$ ${fmtVal(precoMedioVenda, 0)}` : 'n/d', cor: 'text-green-700' },
            { label: `Margem/${unidade}`, valor: margemPorSc !== null ? `R$ ${fmtVal(margemPorSc, 0)}` : 'n/d', cor: margemPorSc !== null && margemPorSc >= 0 ? 'text-green-700' : 'text-red-600' },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Resumo financeiro">
            <LinhaDetalhe label="Qtd colhida" valor={`${fmtVal(totalColhido)} ${unidade}`} />
            <LinhaDetalhe label="Qtd vendida" valor={`${fmtVal(qtdVendida)} ${unidade} (${percVendido}%)`} />
            <LinhaDetalhe label="Em armazem" valor={`${fmtVal(Math.max(totalColhido - qtdVendida, 0))} ${unidade} (${100 - percVendido}%)`} />
            <LinhaDetalhe label="Receita bruta" valor={fmtMoeda(totalReceita)} />
            {totalReceita > totalReceitaLiquida && <LinhaDetalhe label="Deducoes" valor={fmtMoeda(totalReceita - totalReceitaLiquida)} />}
            <LinhaDetalhe label="Receita liquida" valor={fmtMoeda(totalReceitaLiquida)} destaque />
            {custoDaSafra?.totalDespesas && <LinhaDetalhe label="Custo total" valor={fmtMoeda(custoDaSafra.totalDespesas)} />}
            {margemPorSc !== null && qtdVendida > 0 && <LinhaDetalhe label="Margem total (vendas)" valor={fmtMoeda(margemPorSc * qtdVendida)} destaque={margemPorSc >= 0} />}
          </SecaoDetalhe>
          {vendasPorComprador.length > 0 && (
            <SecaoDetalhe titulo="Por comprador">
              {vendasPorComprador.map(v => <LinhaDetalhe key={v.comp} label={v.comp} valor={fmtMoeda(v.valor)} sub={`${fmtVal(v.qtd, 1)} ${unidade} · R$ ${fmtVal(v.precoMedio, 0)}/${unidade}`} />)}
            </SecaoDetalhe>
          )}
        </ModalDetalhe>
      )}

      {modalAberto === 'categoria' && (
        <ModalDetalhe titulo="Custo por categoria" subtitulo={safraRef?.nome}
          kpis={[
            { label: 'Total', valor: fmtMoeda(totalCatCusto) },
            { label: 'Categorias', valor: `${custoPorCategoria.length}` },
            { label: 'Maior', valor: custoPorCategoria[0]?.nome || 'n/d' },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Valor por categoria">
            {custoPorCategoria.map((c, i) => {
              const perc = totalCatCusto > 0 ? Math.round((c.valor / totalCatCusto) * 100) : 0
              return (
                <div key={c.nome} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CORES[i % CORES.length] }} />
                  <span className="text-xs text-gray-600 flex-1">{c.nome}</span>
                  <span className="text-[10px] text-gray-400">{perc}%</span>
                  <span className="text-xs font-semibold text-gray-700">{fmtMoeda(c.valor)}</span>
                </div>
              )
            })}
            <div className="flex justify-between pt-2 border-t border-gray-200 mt-1">
              <span className="text-xs font-semibold text-gray-600">Total</span>
              <span className="text-xs font-bold text-green-700">{fmtMoeda(totalCatCusto)}</span>
            </div>
          </SecaoDetalhe>
        </ModalDetalhe>
      )}

      {modalAberto === 'fluxo' && (
        <ModalDetalhe titulo="Fluxo de caixa"
          subtitulo={filtroSafraId && safraRef ? safraRef.nome : 'Toda a propriedade'}
          kpis={[
            { label: 'Receitas', valor: fmtMoeda(fluxoMensal.reduce((s, m) => s + m.receitas, 0)), cor: 'text-green-700' },
            { label: 'Despesas', valor: fmtMoeda(fluxoMensal.reduce((s, m) => s + m.despesas, 0)), cor: 'text-red-600' },
            { label: 'Acumulado', valor: fmtMoeda(saldoAcumulado), cor: saldoAcumulado >= 0 ? 'text-amber-600' : 'text-red-600' },
          ]}
          onClose={() => setModalAberto(null)}>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Detalhamento mensal</p>
            {/* Cabeçalho alinhado */}
            <div className="flex items-center gap-2 pb-1 border-b border-gray-200 mb-1">
              <span className="text-[10px] font-semibold text-gray-400 w-10 flex-shrink-0">Mês</span>
              <span className="text-[10px] font-semibold text-green-600 flex-1 text-right">Receitas</span>
              <span className="text-[10px] font-semibold text-red-500 flex-1 text-right">Despesas</span>
              <span className="text-[10px] font-semibold text-amber-600 flex-1 text-right">Acumulado</span>
            </div>
            {(() => {
              let acc = 0
              return fluxoMensal.map(m => {
                acc += m.saldo
                return (
                  <div key={m.chave} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
                    <span className="text-xs text-gray-500 w-10 flex-shrink-0 capitalize">{m.nomeMes}</span>
                    <span className="text-[11px] text-green-600 flex-1 text-right">+{fmtMoeda(m.receitas)}</span>
                    <span className="text-[11px] text-red-500 flex-1 text-right">-{fmtMoeda(m.despesas)}</span>
                    <span className={`text-[11px] font-bold flex-1 text-right ${acc >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{acc >= 0 ? '+' : '-'}{fmtMoeda(Math.abs(acc))}</span>
                  </div>
                )
              })
            })()}
          </div>
        </ModalDetalhe>
      )}

      {modalAberto === 'insumos' && (
        <ModalDetalhe titulo="Insumos em estoque" subtitulo={`${insumosComSaldo.length} produtos com saldo`}
          kpis={[
            { label: 'Valor total', valor: fmtMoeda(valorTotalInsumos), cor: 'text-blue-700' },
            { label: 'Produtos', valor: `${insumosComSaldo.length}` },
            { label: 'Maior valor', valor: insumosComSaldo[0] ? fmtMoeda(insumosComSaldo[0].valorEstoque) : 'n/d' },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Todos os insumos com saldo">
            {insumosComSaldo.map(i => <LinhaDetalhe key={i.id} label={i.produto || i.nome || 'sem nome'} valor={fmtMoeda(i.valorEstoque)} sub={`${fmtVal(i.saldoReal, 2)} ${i.unidade || ''} · R$ ${fmtVal(i.precoUlt, 2)}/un`} />)}
            <div className="flex justify-between pt-2 border-t border-gray-200 mt-1">
              <span className="text-xs font-semibold text-gray-600">Valor total estimado</span>
              <span className="text-xs font-bold text-blue-700">{fmtMoeda(valorTotalInsumos)}</span>
            </div>
          </SecaoDetalhe>
          <p className="text-[10px] text-gray-400">Valor: saldo atual x preco da ultima entrada de cada produto.</p>
        </ModalDetalhe>
      )}

      {modalAberto === 'equipamento' && (
        <ModalDetalhe titulo="Custo por equipamento" subtitulo={`Gastos + depreciacao · ${ANO_ATUAL}`}
          kpis={[
            { label: `Total ${ANO_ATUAL}`, valor: fmtMoeda(totalEquip) },
            { label: 'Equipamentos', valor: `${custoPorEquipamento.length}` },
            { label: 'Media/equip', valor: fmtMoeda(mediaEquip) },
          ]}
          onClose={() => setModalAberto(null)}>
          <SecaoDetalhe titulo="Por equipamento">
            {custoPorEquipamento.map(e => <LinhaDetalhe key={e.id} label={`${e.nome}${e.categoria ? ` (${e.categoria})` : ''}`} valor={fmtMoeda(e.total)} sub={[`Gastos: ${fmtMoeda(e.gastos)}`, `Deprec./ano: ${fmtMoeda(e.deprecAnual)}`, e.vidaUtil ? `Vida util: ${e.vidaUtil}a` : null].filter(Boolean).join(' · ')} destaque={e.total > mediaEquip * 1.3} />)}
          </SecaoDetalhe>
          <p className="text-[10px] text-gray-400">Custo proporcional a safra ja incluido em "Custo de producao".</p>
        </ModalDetalhe>
      )}

    </div>
  )
}