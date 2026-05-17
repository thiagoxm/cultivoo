import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { ChevronDown, ChevronUp } from 'lucide-react'
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

function CardIndicador({ titulo, badge, kpis, grafico, detalhe }) {
  const [expandido, setExpandido] = useState(false)
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
      <div className="flex flex-wrap gap-4 px-4 pb-3">
        {kpis.map((k, i) => (
          <div key={i}>
            <p className="text-xl font-bold text-gray-800 leading-tight">{k.valor}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
            {k.delta && (
              <p className={`text-[10px] mt-0.5 font-medium ${k.deltaPositivo ? 'text-green-700' : 'text-red-600'}`}>
                {k.delta}
              </p>
            )}
          </div>
        ))}
      </div>
      {grafico && <div className="border-t border-gray-100 px-4 py-3">{grafico}</div>}
      {detalhe && (
        <>
          <button type="button" onClick={() => setExpandido(v => !v)}
            className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 py-2 border-t border-gray-100 hover:bg-gray-50 transition-colors">
            {expandido ? <><ChevronUp size={12} /> recolher</> : <><ChevronDown size={12} /> ver detalhes</>}
          </button>
          {expandido && <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">{detalhe}</div>}
        </>
      )}
    </div>
  )
}

function LinhaDetalhe({ label, valor, sub, destaque = false }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 flex-1">{label}</span>
      <div className="text-right">
        <span className={`text-xs font-medium ${destaque ? 'text-green-700' : 'text-gray-700'}`}>{valor}</span>
        {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

function GraficoBarrasSVG({ dados, altura = 80 }) {
  if (!dados?.length) return null
  const max = Math.max(...dados.map(d => Math.max(d.rec || 0, d.desp || 0)), 1)
  const largBarra = 14, gap = 6, largGrupo = largBarra * 2 + gap
  const paddingX = 40, paddingY = 10
  const totalW = paddingX * 2 + dados.length * (largGrupo + 8)
  return (
    <svg viewBox={`0 0 ${totalW} ${altura + paddingY * 2}`} className="w-full" style={{ maxHeight: altura + paddingY * 2 }}>
      {dados.map((d, i) => {
        const x = paddingX + i * (largGrupo + 8)
        const hRec = ((d.rec || 0) / max) * altura
        const hDesp = ((d.desp || 0) / max) * altura
        const yBase = paddingY + altura
        return (
          <g key={d.chave}>
            <rect x={x} y={yBase - hRec} width={largBarra} height={Math.max(hRec, 1)} rx="2" fill="#16a34a" opacity="0.85" />
            <rect x={x + largBarra + gap} y={yBase - hDesp} width={largBarra} height={Math.max(hDesp, 1)} rx="2" fill="#ef4444" opacity="0.75" />
            <text x={x + largGrupo / 2} y={yBase + 12} textAnchor="middle" fontSize="8" fill="#9ca3af">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
export default function Indicadores() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [filtroSafraId, setFiltroSafraId] = useState('')
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
      const q = (col) => query(collection(db, col), where('uid', '==', uid))
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
    }).filter(l => l.custoSc !== null || l.despesaTotal > 0).sort((a, b) => (b.custoSc || 0) - (a.custoSc || 0))
  }, [custoDaSafra, lavouras])
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
    return Object.values(mapa).sort((a, b) => b.total - a.total)
  }, [colheitasDaSafra, lavouras, safraRef])

  const totalColhido = colheitasDaSafra.reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
  const maxProd = Math.max(...produtividadePorLavoura.map(l => l.total), 1)
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

  const { margemPorSc, totalReceita, totalReceitaLiquida, percVendido, vendasPorComprador } = useMemo(() => {
    if (!safraRef) return { margemPorSc: null, totalReceita: 0, totalReceitaLiquida: 0, percVendido: 0, vendasPorComprador: [] }
    const receitasSafra = financeiro.filter(f => f.safraId === safraRef.id && f.tipo === 'receita' && f.origemEstoqueProducao === true)
    const totalBruto = receitasSafra.reduce((s, f) => s + (Number(f.valorBruto) || Number(f.valor) || 0), 0)
    const totalLiquido = receitasSafra.reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const vendasSafra = movsProducao.filter(m => m.tipo === 'saida_venda' && m.safraId === safraRef.id)
    const qtdVendida = vendasSafra.reduce((s, m) => s + (Number(m.quantidade) || 0), 0)
    const perc = totalColhido > 0 ? Math.round((qtdVendida / totalColhido) * 100) : 0
    const precoMedio = qtdVendida > 0 ? totalLiquido / qtdVendida : 0
    const margem = custoPorSc !== null && precoMedio > 0 ? precoMedio - custoPorSc : null
    const porComprador = {}
    vendasSafra.forEach(m => { const comp = m.comprador?.trim() || 'Sem comprador'; if (!porComprador[comp]) porComprador[comp] = { qtd: 0, valor: 0 }; porComprador[comp].qtd += Number(m.quantidade) || 0; porComprador[comp].valor += Number(m.valorLiquido) || 0 })
    const vendasPorComprador = Object.entries(porComprador).map(([comp, v]) => ({ comp, ...v, precoMedio: v.qtd > 0 ? v.valor / v.qtd : 0 })).sort((a, b) => b.valor - a.valor)
    return { margemPorSc: margem, totalReceita: totalBruto, totalReceitaLiquida: totalLiquido, percVendido: perc, vendasPorComprador }
  }, [financeiro, movsProducao, safraRef, totalColhido, custoPorSc])

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

  const fluxoMensal = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
    const chave = d.toISOString().substring(0, 7)
    const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
    const base = financeiro.filter(f => { const dr = f.vencimento || f.data || ''; if (!dr.startsWith(chave)) return false; return filtroSafraId ? f.safraId === filtroSafraId : true })
    const rec = base.filter(f => f.tipo === 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const desp = base.filter(f => f.tipo !== 'receita').reduce((s, f) => s + (Number(f.valor) || 0), 0)
    return { chave, nomeMes: label, label, rec, desp, receitas: rec, despesas: desp, saldo: rec - desp }
  }), [financeiro, filtroSafraId])
  const saldoAcumulado = fluxoMensal.reduce((s, m) => s + m.saldo, 0)

  const insumosComSaldo = useMemo(() => {
    const saldos = {}
    movInsumos.forEach(m => { const pid = m.produtoId; if (!pid) return; if (saldos[pid] === undefined) saldos[pid] = 0; if (m.tipoMov === 'entrada') saldos[pid] += Number(m.quantidade) || 0; else if (m.tipoMov === 'saida') saldos[pid] -= Number(m.quantidade) || 0 })
    return insumos.map(ins => {
      const saldo = Math.max(saldos[ins.id] || 0, 0)
      const entradas = movInsumos.filter(m => m.produtoId === ins.id && m.tipoMov === 'entrada' && m.valorTotal && m.quantidade).sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
      const precoUlt = entradas.length ? entradas[0].valorTotal / entradas[0].quantidade : 0
      return { ...ins, saldoReal: saldo, precoUlt, valorEstoque: saldo * precoUlt }
    }).filter(i => i.saldoReal > 0).sort((a, b) => b.valorEstoque - a.valorEstoque)
  }, [insumos, movInsumos])
  const valorTotalInsumos = insumosComSaldo.reduce((s, i) => s + i.valorEstoque, 0)
  const maxInsValor = Math.max(...insumosComSaldo.map(i => i.valorEstoque), 1)

  const anoAtualStr = String(ANO_ATUAL)
  const custoPorEquipamento = useMemo(() => patrimonios.map(p => {
    const gastos = financeiro.filter(f => f.patrimonioId === p.id && f.tipo !== 'receita' && f.categoria !== 'Investimentos' && (f.vencimento || '').startsWith(anoAtualStr)).reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const deprecAnual = calcularDepreciacaoMensal(p) * 12
    return { id: p.id, nome: p.nome || 'sem nome', categoria: p.categoria || '', gastos, deprecAnual, total: gastos + deprecAnual, vidaUtil: Number(p.vidaUtil) || 0 }
  }).filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 6), [patrimonios, financeiro, anoAtualStr])
  const totalEquip = custoPorEquipamento.reduce((s, e) => s + e.total, 0)
  const mediaEquip = custoPorEquipamento.length > 0 ? totalEquip / custoPorEquipamento.length : 0
  const maxEquip = Math.max(...custoPorEquipamento.map(e => e.total), 1)

  const CORES_CAT = ['#639922', '#EF9F27', '#378ADD', '#B4B2A9', '#E24B4A', '#7C3AED']
  if (loading) return <div className="text-gray-400 text-sm p-4">Carregando indicadores...</div>
  const bs = safraRef ? { texto: safraRef.nome, bg: '#EAF3DE', cor: '#3B6D11' } : null

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-800">Indicadores</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {safras.map(s => (<button key={s.id} onClick={() => setFiltroSafraId(p => p === s.id ? '' : s.id)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filtroSafraId === s.id ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-green-400'}`}>{s.nome}</button>))}
          {filtroSafraId && <button onClick={() => setFiltroSafraId('')} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <CardIndicador titulo="Custo de producao" badge={bs}
          kpis={[{ valor: custoPorSc !== null ? `R$ ${fmtVal(custoPorSc, 0)}` : 'n/d', label: `por ${unidade}` }, { valor: custoPorHa !== null ? `R$ ${fmtVal(custoPorHa, 0)}` : 'n/d', label: 'por ha' }, ...(custoDaSafra?.totalDespesas ? [{ valor: fmtMoeda(custoDaSafra.totalDespesas), label: 'custo total' }] : [])]}
          grafico={custoPorLavoura.length > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">Custo por lavoura (R$/{unidade})</p>{custoPorLavoura.map(l => <Barra key={l.id} nome={l.nome} largura={(l.custoSc / maxCustoLavoura) * 100} cor={custoPorSc && l.custoSc > custoPorSc * 1.1 ? '#EF9F27' : '#639922'} valor={`R$ ${fmtVal(l.custoSc, 0)}`} />)}</>) : <p className="text-xs text-gray-400">Custo nao calculado. Acesse o painel de debug.</p>}
          detalhe={custoPorLavoura.length > 0 ? (<div><p className="text-xs font-semibold text-gray-600 mb-2">Detalhamento por lavoura</p>{custoPorLavoura.map(l => <LinhaDetalhe key={l.id} label={l.nome} valor={`R$ ${fmtVal(l.custoSc || 0, 0)}/${unidade}`} sub={[l.custoHa ? `R$ ${fmtVal(l.custoHa, 0)}/ha` : null, l.despesaTotal ? `Total: ${fmtMoeda(l.despesaTotal)}` : null, l.qtdColhida ? `${fmtVal(l.qtdColhida)} ${unidade} colhidos` : null].filter(Boolean).join(' - ')} />)}</div>) : null}
        />

        <CardIndicador titulo="Produtividade" badge={bs}
          kpis={[{ valor: totalColhido > 0 ? `${fmtVal(totalColhido)} ${unidade}` : 'n/d', label: 'total colhido' }, { valor: scPorHaGeral !== null ? `${fmtVal(scPorHaGeral, 1)} ${unidade}/ha` : 'n/d', label: 'produtividade media' }]}
          grafico={produtividadePorLavoura.length > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">{unidade}/ha por lavoura</p>{produtividadePorLavoura.map(l => { const scHa = l.areaHa > 0 ? l.total / l.areaHa : null; return <Barra key={l.nome} nome={l.nome} largura={(l.total / maxProd) * 100} cor="#639922" valor={scHa !== null ? `${fmtVal(scHa, 1)} ${unidade}/ha` : `${fmtVal(l.total)} ${unidade}`} /> })}</>) : <p className="text-xs text-gray-400">Nenhuma colheita registrada.</p>}
          detalhe={produtividadePorLavoura.length > 0 ? (<div><p className="text-xs font-semibold text-gray-600 mb-2">Por lavoura</p>{produtividadePorLavoura.map(l => { const scHa = l.areaHa > 0 ? l.total / l.areaHa : null; return <LinhaDetalhe key={l.nome} label={l.nome} valor={scHa !== null ? `${fmtVal(scHa, 1)} ${unidade}/ha` : `${fmtVal(l.total)} ${unidade}`} sub={[l.areaHa ? `${fmtVal(l.areaHa, 1)} ha` : null, `${fmtVal(l.total)} ${unidade} colhidos`].filter(Boolean).join(' - ')} /> })}{areaTotalSafra > 0 && <div className="mt-2 pt-2 border-t border-gray-200"><LinhaDetalhe label="Area total" valor={`${fmtVal(areaTotalSafra, 1)} ha`} /><LinhaDetalhe label="Prod. geral" valor={`${fmtVal(scPorHaGeral, 1)} ${unidade}/ha`} destaque /></div>}</div>) : null}
        />

        <CardIndicador titulo="Qualidade por lavoura" badge={bs}
          kpis={[{ valor: qualidadePorLavoura.length > 0 ? `${qualidadePorLavoura.length} lavoura${qualidadePorLavoura.length > 1 ? 's' : ''}` : 'n/d', label: 'com classificacao registrada' }]}
          grafico={qualidadePorLavoura.length > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">Classificacao propria por lavoura</p>{qualidadePorLavoura.map(l => <div key={l.nome} className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[11px] text-gray-500 w-28 flex-shrink-0 text-right truncate">{l.nome}</span><span className="flex-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 truncate">{l.predominante}</span><span className="text-[11px] text-gray-400 w-20 flex-shrink-0 text-right">{fmtVal(l.qtdTotal)} {unidade}</span></div>)}</>) : <p className="text-xs text-gray-400">Nenhuma classificacao nos lotes desta safra.</p>}
          detalhe={qualidadePorLavoura.length > 0 ? (<div><p className="text-xs font-semibold text-gray-600 mb-2">Classificacoes por lavoura</p>{qualidadePorLavoura.map(l => <LinhaDetalhe key={l.nome} label={l.nome} valor={l.predominante} sub={l.todas !== l.predominante ? `Todas: ${l.todas}` : `${fmtVal(l.qtdTotal)} ${unidade} classificados`} />)}</div>) : null}
        />

        <CardIndicador titulo="Margem e rentabilidade"
          badge={percVendido > 0 ? { texto: `${percVendido}% vendido`, bg: percVendido >= 80 ? '#EAF3DE' : '#FAEEDA', cor: percVendido >= 80 ? '#3B6D11' : '#854F0B' } : null}
          kpis={[{ valor: margemPorSc !== null ? `R$ ${fmtVal(Math.abs(margemPorSc), 0)}/${unidade}` : 'n/d', label: margemPorSc !== null && margemPorSc >= 0 ? 'margem positiva' : 'margem negativa', delta: margemPorSc !== null ? (margemPorSc >= 0 ? `+${fmtVal(margemPorSc, 0)}/${unidade}` : `-${fmtVal(Math.abs(margemPorSc), 0)}/${unidade}`) : null, deltaPositivo: margemPorSc !== null && margemPorSc >= 0 }, ...(totalReceitaLiquida > 0 ? [{ valor: fmtMoeda(totalReceitaLiquida), label: 'receita liquida' }] : [])]}
          grafico={totalColhido > 0 && percVendido > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">Vendido vs. em armazem</p><div className="flex h-3 rounded-full overflow-hidden mb-2"><div style={{ width: `${percVendido}%`, background: '#639922' }} /><div style={{ width: `${100 - percVendido}%`, background: '#C0DD97' }} /></div><div className="flex gap-3 flex-wrap"><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-green-700" /><span className="text-[10px] text-gray-500">Vendido {percVendido}% - {fmtMoeda(totalReceitaLiquida)}</span></div><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm" style={{ background: '#C0DD97' }} /><span className="text-[10px] text-gray-500">Armazem {100 - percVendido}%</span></div></div>{custoPorSc !== null && <div className="mt-3 grid grid-cols-3 gap-2">{[{ label: `Custo/${unidade}`, valor: `R$ ${fmtVal(custoPorSc, 0)}`, cor: 'text-gray-700' }, { label: 'Preco medio', valor: percVendido > 0 && totalColhido > 0 ? `R$ ${fmtVal(totalReceitaLiquida / (totalColhido * percVendido / 100), 0)}` : 'n/d', cor: 'text-green-700' }, { label: `Margem/${unidade}`, valor: margemPorSc !== null ? `R$ ${fmtVal(margemPorSc, 0)}` : 'n/d', cor: margemPorSc !== null && margemPorSc >= 0 ? 'text-green-700' : 'text-red-600' }].map(item => <div key={item.label} className="bg-white rounded-lg px-2 py-1.5 border border-gray-100 text-center"><p className={`text-xs font-bold ${item.cor}`}>{item.valor}</p><p className="text-[10px] text-gray-400">{item.label}</p></div>)}</div>}</>) : <p className="text-xs text-gray-400">Nenhuma venda registrada.</p>}
          detalhe={vendasPorComprador.length > 0 ? (<div><p className="text-xs font-semibold text-gray-600 mb-2">Vendas por comprador</p>{vendasPorComprador.map(v => <LinhaDetalhe key={v.comp} label={v.comp} valor={fmtMoeda(v.valor)} sub={`${fmtVal(v.qtd, 1)} ${unidade} - R$ ${fmtVal(v.precoMedio, 0)}/${unidade}`} />)}{totalReceita > totalReceitaLiquida && <div className="mt-2 pt-2 border-t border-gray-200"><LinhaDetalhe label="Valor bruto" valor={fmtMoeda(totalReceita)} /><LinhaDetalhe label="Deducoes" valor={fmtMoeda(totalReceita - totalReceitaLiquida)} /><LinhaDetalhe label="Valor liquido" valor={fmtMoeda(totalReceitaLiquida)} destaque /></div>}</div>) : null}
        />

        <CardIndicador titulo="Custo por categoria" badge={bs}
          kpis={[{ valor: totalCatCusto > 0 ? fmtMoeda(totalCatCusto) : 'n/d', label: 'custo total categorizado' }]}
          grafico={custoPorCategoria.length > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">Distribuicao por categoria</p>{custoPorCategoria.map((c, i) => { const p = totalCatCusto > 0 ? Math.round((c.valor / totalCatCusto) * 100) : 0; return <Barra key={c.nome} nome={c.nome} largura={p} cor={CORES_CAT[i % CORES_CAT.length]} valor={`${p}%`} /> })}</>) : <p className="text-xs text-gray-400">Nenhuma despesa categorizada.</p>}
          detalhe={custoPorCategoria.length > 0 ? (<div><p className="text-xs font-semibold text-gray-600 mb-2">Valor por categoria</p>{custoPorCategoria.map(c => <LinhaDetalhe key={c.nome} label={c.nome} valor={fmtMoeda(c.valor)} sub={`${totalCatCusto > 0 ? Math.round((c.valor / totalCatCusto) * 100) : 0}% do total`} />)}<div className="mt-2 pt-2 border-t border-gray-200"><LinhaDetalhe label="Total" valor={fmtMoeda(totalCatCusto)} destaque /></div></div>) : null}
        />

        <CardIndicador titulo="Fluxo de caixa"
          badge={{ texto: saldoAcumulado >= 0 ? `+${fmtMoeda(saldoAcumulado)} acumulado` : `${fmtMoeda(saldoAcumulado)} acumulado`, bg: saldoAcumulado >= 0 ? '#EAF3DE' : '#FCEBEB', cor: saldoAcumulado >= 0 ? '#3B6D11' : '#A32D2D' }}
          kpis={[{ valor: fmtMoeda(fluxoMensal[fluxoMensal.length - 1]?.saldo || 0), label: `saldo ${fluxoMensal[fluxoMensal.length - 1]?.nomeMes || 'este mes'}` }]}
          grafico={<><p className="text-[10px] text-gray-400 mb-1">Ultimos 6 meses{filtroSafraId && safraRef ? ` - ${safraRef.nome}` : ' - toda a propriedade'}</p><GraficoBarrasSVG dados={fluxoMensal} /><div className="flex items-center gap-4 mt-1"><div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-green-600" /><span className="text-[10px] text-gray-400">Receitas</span></div><div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-500" /><span className="text-[10px] text-gray-400">Despesas</span></div></div></>}
          detalhe={<div><p className="text-xs font-semibold text-gray-600 mb-2">Detalhamento mensal</p>{fluxoMensal.map(m => <div key={m.chave} className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-0"><span className="text-xs text-gray-500 w-12">{m.nomeMes}</span><span className="text-[11px] text-green-600">+{fmtMoeda(m.receitas)}</span><span className="text-[11px] text-red-500">-{fmtMoeda(m.despesas)}</span><span className={`text-xs font-bold w-20 text-right ${m.saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>{m.saldo >= 0 ? '+' : '-'}{fmtMoeda(Math.abs(m.saldo))}</span></div>)}<div className="flex justify-between pt-2 border-t border-gray-200"><span className="text-xs font-semibold text-gray-600">Saldo acumulado</span><span className={`text-xs font-bold ${saldoAcumulado >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtMoeda(saldoAcumulado)}</span></div></div>}
        />

        <CardIndicador titulo="Insumos em estoque"
          badge={{ texto: `${insumosComSaldo.length} produtos`, bg: '#E6F1FB', cor: '#185FA5' }}
          kpis={[{ valor: fmtMoeda(valorTotalInsumos), label: 'valor estimado em estoque' }]}
          grafico={insumosComSaldo.length > 0 ? (<><p className="text-[10px] text-gray-400 mb-2">Maiores valores em estoque</p>{insumosComSaldo.slice(0, 5).map(i => <Barra key={i.id} nome={i.produto || i.nome || 'sem nome'} largura={(i.valorEstoque / maxInsValor) * 100} cor