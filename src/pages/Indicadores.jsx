import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { ChevronDown, ChevronUp, Settings } from 'lucide-react'
import { formatarCustoEstimado } from '../hooks/useCustoProducao'

const HOJE = new Date().toISOString().split('T')[0]

function formatarValor(v, decimais = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais })
}

function formatarMoeda(v) {
  if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1).replace('.', ',')}M`
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`
  return `R$ ${formatarValor(v, 0)}`
}

function Barra({ nome, largura, cor = '#639922', valor }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-gray-500 w-24 flex-shrink-0 text-right truncate">{nome}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-sm overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(largura, 100)}%`, background: cor }} />
      </div>
      <span className="text-[11px] text-gray-500 w-14 flex-shrink-0 text-right">{valor}</span>
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
      <div className="flex gap-4 px-4 pb-3">
        {kpis.map((k, i) => (
          <div key={i}>
            <p className="text-xl font-bold text-gray-800 leading-tight">{k.valor}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
            {k.delta && <p className={`text-[10px] mt-0.5 font-medium ${k.deltaPositivo ? 'text-green-700' : 'text-red-600'}`}>{k.delta}</p>}
          </div>
        ))}
      </div>
      {grafico && (
        <div className="border-t border-gray-100 px-4 py-3">
          {grafico}
        </div>
      )}
      {detalhe && (
        <>
          <button type="button" onClick={() => setExpandido(v => !v)}
            className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 py-2 border-t border-gray-100 hover:bg-gray-50 transition-colors">
            {expandido ? <><ChevronUp size={12} /> recolher</> : <><ChevronDown size={12} /> ver detalhes</>}
          </button>
          {expandido && (
            <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
              {detalhe}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Indicadores() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [safras, setSafras] = useState([])
  const [colheitas, setColheitas] = useState([])
  const [financeiro, setFinanceiro] = useState([])
  const [patrimonios, setPatrimonios] = useState([])
  const [insumos, setInsumos] = useState([])

  const custos = null // custos lidos direto de safra.custoEstimado

  useEffect(() => {
    async function carregar() {
      const uid = usuario.uid
      const q = (col) => query(collection(db, col), where('uid', '==', uid))
      const [safrasSnap, colheitasSnap, finSnap, patSnap, insumosSnap] = await Promise.all([
        getDocs(q('safras')),
        getDocs(q('colheitas')),
        getDocs(q('financeiro')),
        getDocs(q('patrimonios')),
        getDocs(q('estoqueInsumos')),
      ])
      setSafras(safrasSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setColheitas(colheitasSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setFinanceiro(finSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPatrimonios(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setInsumos(insumosSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }
    carregar()
  }, [usuario])

  const safraRef = useMemo(() =>
    filtroSafraId ? safras.find(s => s.id === filtroSafraId) : safras.find(s => s.status === 'Em andamento') || safras[0]
  , [safras, filtroSafraId])

  const colheitasDaSafra = useMemo(() =>
    safraRef ? colheitas.filter(c => c.safraId === safraRef.id) : []
  , [colheitas, safraRef])

  const produtividadePorLavoura = useMemo(() => {
    if (!safraRef) return []
    const mapa = {}
    colheitasDaSafra.forEach(c => {
      const nome = c.lavouraNome || c.lavouraId || 'Sem lavoura'
      if (!mapa[nome]) mapa[nome] = { nome, total: 0, area: Number(c.areaHa) || 0 }
      mapa[nome].total += Number(c.quantidade) || 0
    })
    return Object.values(mapa).sort((a, b) => b.total - a.total)
  }, [colheitasDaSafra, safraRef])

  const maxProd = Math.max(...produtividadePorLavoura.map(l => l.total), 1)
  const totalColhido = colheitasDaSafra.reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
  const unidade = safraRef?.unidade || colheitasDaSafra[0]?.unidade || 'sc'

  const custoDaSafra = useMemo(() => {
    if (!safraRef) return null
    return safraRef.custoEstimado || null
  }, [safraRef])

  const custoPorSc = custoDaSafra?.total ?? null
  const custoPorHa = useMemo(() => {
    if (!safraRef || custoPorSc === null) return null
    const area = (safraRef.lavouraIds?.length || 0) > 0 ? null : null // calculado via colheitas
    // usa custoPorSc * (sc/ha médio) — aproximação: totalDespesas / areaTotal
    const totalDespesas = custoDaSafra?.totalDespesas ?? null
    if (totalDespesas === null) return null
    const areaTotal = custoDaSafra?.areaTotal ?? null
    return areaTotal ? totalDespesas / areaTotal : null
  }, [safraRef, custoPorSc, custoDaSafra])

  const custoPorLavoura = useMemo(() => {
    if (!safraRef?.custoEstimado?.porLavoura) return []
    return Object.entries(safraRef.custoEstimado.porLavoura)
      .map(([id, v]) => ({ id, nome: v.lavouraNome || id, custoSc: v.custoSc, custoHa: null }))
      .filter(l => l.custoSc !== null)
      .sort((a, b) => (b.custoSc || 0) - (a.custoSc || 0))
  }, [safraRef])

  const maxCustoLavoura = Math.max(...custoPorLavoura.map(l => l.custoSc || 0), 1)

  const { margemPorSc, totalReceita, percVendido } = useMemo(() => {
    if (!safraRef) return { margemPorSc: null, totalReceita: 0, percVendido: 0 }
    const receitasSafra = financeiro.filter(f => f.tipo === 'receita' && f.safraId === safraRef.id && !f.cancelado)
    const totalR = receitasSafra.reduce((s, f) => s + (Number(f.valor) || 0), 0)
    const qtdVendida = receitasSafra.reduce((s, f) => s + (Number(f.quantidade) || 0), 0)
    const perc = totalColhido > 0 ? Math.round((qtdVendida / totalColhido) * 100) : 0
    const precoMedio = qtdVendida > 0 ? totalR / qtdVendida : 0
    const margem = custoPorSc !== null && precoMedio > 0 ? precoMedio - custoPorSc : null
    return { margemPorSc: margem, totalReceita: totalR, percVendido: perc }
  }, [financeiro, safraRef, totalColhido, custoPorSc])

  const custoPorCategoria = useMemo(() => {
    // Não temos categorias no custoEstimado salvo — retorna vazio por ora
    return []
  }, [safraRef])

  const totalCatCusto = custoPorCategoria.reduce((s, c) => s + c.valor, 0)

  const fluxoMensal = useMemo(() => {
    const meses = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const chave = d.toISOString().substring(0, 7)
      const nomeMes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      const receitas = financeiro.filter(f => f.tipo === 'receita' && f.data?.startsWith(chave) && !f.cancelado).reduce((s, f) => s + (Number(f.valor) || 0), 0)
      const despesas = financeiro.filter(f => f.tipo !== 'receita' && f.data?.startsWith(chave) && !f.cancelado).reduce((s, f) => s + (Number(f.valor) || 0), 0)
      meses.push({ chave, nomeMes, receitas, despesas, saldo: receitas - despesas })
    }
    return meses
  }, [financeiro])

  const maxFluxo = Math.max(...fluxoMensal.map(m => Math.max(m.receitas, m.despesas)), 1)
  const saldoAcumulado = fluxoMensal.reduce((s, m) => s + m.saldo, 0)

  const valorTotalInsumos = useMemo(() =>
    insumos.filter(i => !i.cancelado).reduce((s, i) => s + ((Number(i.saldoAtual) || 0) * (Number(i.precoUnitario) || 0)), 0)
  , [insumos])

  const topInsumos = useMemo(() =>
    insumos.filter(i => !i.cancelado && i.saldoAtual > 0)
      .map(i => ({ nome: i.produto || i.nome || '—', valor: (Number(i.saldoAtual) || 0) * (Number(i.precoUnitario) || 0) }))
      .sort((a, b) => b.valor - a.valor).slice(0, 3)
  , [insumos])

  const maxInsValor = Math.max(...topInsumos.map(i => i.valor), 1)

  const custoPorEquipamento = useMemo(() => {
    if (!patrimonios.length) return []
    return patrimonios.map(p => {
      const gastos = financeiro.filter(f => f.patrimônioId === p.id && f.tipo !== 'receita' && !f.cancelado).reduce((s, f) => s + (Number(f.valor) || 0), 0)
      const depreciacaoAnual = Number(p.valorAquisicao || 0) / Math.max(Number(p.vidaUtilAnos || 10), 1)
      return { id: p.id, nome: p.nome || p.descricao || '—', gastos, depreciacao: depreciacaoAnual, total: gastos + depreciacaoAnual }
    }).filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [patrimonios, financeiro])

  const maxEquip = Math.max(...custoPorEquipamento.map(e => e.total), 1)
  const mediaEquip = custoPorEquipamento.length > 0
    ? custoPorEquipamento.reduce((s, e) => s + e.total, 0) / custoPorEquipamento.length : 0

  if (loading) return <div className="text-gray-400 text-sm p-4">Carregando indicadores...</div>

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-800">Indicadores</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {safras.map(s => (
            <button key={s.id} onClick={() => setFiltroSafraId(prev => prev === s.id ? '' : s.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filtroSafraId === s.id ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-green-400'}`}>
              {s.nome}
            </button>
          ))}
          {filtroSafraId && <button onClick={() => setFiltroSafraId('')} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>}
        </div>
      </div>

      <a href="/configuracoes" className="inline-flex items-center gap-2 text-xs text-gray-400 border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300 transition-colors">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600 flex-shrink-0" />
        Relatório mensal ativo · configurar
        <Settings size={11} />
      </a>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <CardIndicador
          titulo="Custo de produção"
          badge={safraRef ? { texto: safraRef.nome, bg: '#EAF3DE', cor: '#3B6D11' } : null}
          kpis={[
            { valor: custoPorSc !== null ? `R$ ${formatarValor(custoPorSc, 0)}` : '—', label: `por ${unidade}` },
            { valor: custoPorHa !== null ? `R$ ${formatarValor(custoPorHa, 0)}` : '—', label: 'por ha' },
          ]}
          grafico={custoPorLavoura.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Custo por lavoura (R$/{unidade})</p>
            {custoPorLavoura.map(l => <Barra key={l.id} nome={l.nome} largura={(l.custoSc / maxCustoLavoura) * 100} cor={l.custoSc > (custoPorSc * 1.1) ? '#EF9F27' : '#639922'} valor={`R$ ${formatarValor(l.custoSc, 0)}`} />)}</>
          ) : <p className="text-xs text-gray-400">Sem dados de custo para esta safra ainda.</p>}
          detalhe={custoPorLavoura.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600 mb-2">Custo por lavoura detalhado</p>
              {custoPorLavoura.map(l => <div key={l.id} className="flex justify-between text-xs text-gray-600"><span>{l.nome}</span><span className="font-medium">R$ {formatarValor(l.custoSc, 0)}/{unidade} · R$ {formatarValor(l.custoHa, 0)}/ha</span></div>)}
            </div>
          ) : null}
        />

        <CardIndicador
          titulo="Produtividade"
          badge={safraRef ? { texto: safraRef.nome, bg: '#EAF3DE', cor: '#3B6D11' } : null}
          kpis={[{ valor: totalColhido > 0 ? `${formatarValor(totalColhido)} ${unidade}` : '—', label: 'total colhido' }]}
          grafico={produtividadePorLavoura.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Volume por lavoura ({unidade})</p>
            {produtividadePorLavoura.map(l => <Barra key={l.nome} nome={l.nome} largura={(l.total / maxProd) * 100} cor="#639922" valor={`${formatarValor(l.total)} ${unidade}`} />)}</>
          ) : <p className="text-xs text-gray-400">Nenhuma colheita registrada ainda.</p>}
          detalhe={<div className="space-y-1"><p className="text-xs font-medium text-gray-600 mb-2">Produtividade por lavoura</p>{produtividadePorLavoura.map(l => <div key={l.nome} className="flex justify-between text-xs text-gray-600"><span>{l.nome}</span><span className="font-medium">{formatarValor(l.total)} {unidade}{l.area > 0 ? ` · ${formatarValor(l.total / l.area, 1)} ${unidade}/ha` : ''}</span></div>)}</div>}
        />

        <CardIndicador
          titulo="Margem e rentabilidade"
          badge={percVendido > 0 ? { texto: `${percVendido}% vendido`, bg: percVendido >= 80 ? '#EAF3DE' : '#FAEEDA', cor: percVendido >= 80 ? '#3B6D11' : '#854F0B' } : null}
          kpis={[{ valor: margemPorSc !== null ? `R$ ${formatarValor(margemPorSc, 0)}/${unidade}` : '—', label: 'margem parcial', delta: margemPorSc !== null ? (margemPorSc >= 0 ? `▲ positiva (${percVendido}% vendido)` : '▼ negativa') : null, deltaPositivo: margemPorSc !== null && margemPorSc >= 0 }]}
          grafico={totalColhido > 0 && percVendido > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Vendido vs. em armazém</p>
            <div className="flex h-3 rounded-sm overflow-hidden mb-2"><div style={{ width: `${percVendido}%`, background: '#639922' }} /><div style={{ width: `${100 - percVendido}%`, background: '#C0DD97' }} /></div>
            <div className="flex gap-4"><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm" style={{ background: '#639922' }} /><span className="text-[10px] text-gray-500">Vendido · {formatarMoeda(totalReceita)}</span></div><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm" style={{ background: '#C0DD97' }} /><span className="text-[10px] text-gray-500">Em armazém ({100 - percVendido}%)</span></div></div></>
          ) : <p className="text-xs text-gray-400">Nenhuma venda registrada para esta safra ainda.</p>}
        />

        <CardIndicador
          titulo="Custo por categoria"
          badge={safraRef ? { texto: safraRef.nome, bg: '#EAF3DE', cor: '#3B6D11' } : null}
          kpis={[{ valor: totalCatCusto > 0 ? formatarMoeda(totalCatCusto) : '—', label: 'custo total' }]}
          grafico={custoPorCategoria.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Distribuição de custos</p>
            {custoPorCategoria.map((c, i) => { const cores = ['#639922','#EF9F27','#378ADD','#B4B2A9','#E24B4A']; const perc = totalCatCusto > 0 ? Math.round((c.valor / totalCatCusto) * 100) : 0; return <Barra key={c.nome} nome={c.nome} largura={perc} cor={cores[i % cores.length]} valor={`${perc}%`} /> })}</>
          ) : <p className="text-xs text-gray-400">Sem dados de custo por categoria.</p>}
          detalhe={custoPorCategoria.length > 0 ? <div className="space-y-1">{custoPorCategoria.map(c => <div key={c.nome} className="flex justify-between text-xs text-gray-600"><span>{c.nome}</span><span className="font-medium">{formatarMoeda(c.valor)} · {totalCatCusto > 0 ? Math.round((c.valor / totalCatCusto) * 100) : 0}%</span></div>)}</div> : null}
        />

        <CardIndicador
          titulo="Fluxo de caixa"
          badge={{ texto: saldoAcumulado >= 0 ? `+${formatarMoeda(saldoAcumulado)} acumulado` : `${formatarMoeda(saldoAcumulado)} acumulado`, bg: saldoAcumulado >= 0 ? '#EAF3DE' : '#FCEBEB', cor: saldoAcumulado >= 0 ? '#3B6D11' : '#A32D2D' }}
          kpis={[{ valor: formatarMoeda(fluxoMensal[fluxoMensal.length - 1]?.saldo || 0), label: 'saldo este mês' }]}
          grafico={
            <><p className="text-[10px] text-gray-400 mb-2">Receitas e despesas — últimos 6 meses</p>
            <div className="flex items-end gap-1 h-10 mb-1">{fluxoMensal.map(m => <div key={m.chave} className="flex-1 flex gap-0.5 items-end"><div style={{ height: `${(m.receitas / maxFluxo) * 100}%`, minHeight: 2, background: '#639922', borderRadius: '2px 2px 0 0', flex: 1 }} /><div style={{ height: `${(m.despesas / maxFluxo) * 100}%`, minHeight: 2, background: '#E24B4A', borderRadius: '2px 2px 0 0', flex: 1 }} /></div>)}</div>
            <div className="flex gap-1">{fluxoMensal.map(m => <div key={m.chave} className="flex-1 text-center text-[9px] text-gray-400">{m.nomeMes}</div>)}</div></>
          }
          detalhe={<div className="space-y-1">{fluxoMensal.map(m => <div key={m.chave} className="flex justify-between text-xs text-gray-600"><span className="capitalize">{m.nomeMes}</span><span><span className="text-green-700">{formatarMoeda(m.receitas)}</span>{' / '}<span className="text-red-600">{formatarMoeda(m.despesas)}</span>{' → '}<span className={`font-medium ${m.saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatarMoeda(m.saldo)}</span></span></div>)}</div>}
        />

        <CardIndicador
          titulo="Insumos em estoque"
          badge={{ texto: `${insumos.filter(i => !i.cancelado && i.saldoAtual > 0).length} produtos`, bg: '#E6F1FB', cor: '#185FA5' }}
          kpis={[{ valor: formatarMoeda(valorTotalInsumos), label: 'valor total' }]}
          grafico={topInsumos.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Maiores valores em estoque</p>
            {topInsumos.map(i => <Barra key={i.nome} nome={i.nome} largura={(i.valor / maxInsValor) * 100} cor="#378ADD" valor={formatarMoeda(i.valor)} />)}</>
          ) : <p className="text-xs text-gray-400">Nenhum insumo com saldo em estoque.</p>}
          detalhe={<div className="space-y-1">{insumos.filter(i => !i.cancelado && i.saldoAtual > 0).slice(0, 8).map(i => <div key={i.id} className="flex justify-between text-xs text-gray-600"><span>{i.produto || i.nome || '—'}</span><span className="font-medium">{i.saldoAtual} {i.unidade || ''} · {formatarMoeda((Number(i.saldoAtual) || 0) * (Number(i.precoUnitario) || 0))}</span></div>)}</div>}
        />

        <CardIndicador
          titulo="Custo por equipamento"
          badge={custoPorEquipamento.some(e => e.total > mediaEquip * 1.3) ? { texto: 'atenção: 1 item', bg: '#FAEEDA', cor: '#854F0B' } : null}
          kpis={[{ valor: formatarMoeda(custoPorEquipamento.reduce((s, e) => s + e.total, 0)), label: 'custo total maquinário' }]}
          grafico={custoPorEquipamento.length > 0 ? (
            <><p className="text-[10px] text-gray-400 mb-2">Custo total por equipamento (gastos + depreciação)</p>
            {custoPorEquipamento.map(e => <Barra key={e.id} nome={e.nome} largura={(e.total / maxEquip) * 100} cor={e.total > mediaEquip * 1.3 ? '#EF9F27' : '#639922'} valor={formatarMoeda(e.total)} />)}
            {mediaEquip > 0 && <p className="text-[10px] text-gray-400 mt-2">Média: {formatarMoeda(mediaEquip)} por equipamento</p>}</>
          ) : <p className="text-xs text-gray-400">Nenhum patrimônio cadastrado ou com gastos registrados.</p>}
          detalhe={custoPorEquipamento.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600 mb-2">Detalhamento: gastos + depreciação anual</p>
              {custoPorEquipamento.map(e => <div key={e.id} className="flex justify-between text-xs text-gray-600"><span>{e.nome}</span><span>gastos: {formatarMoeda(e.gastos)} + deprec.: {formatarMoeda(e.depreciacao)} = <span className={`font-medium ${e.total > mediaEquip * 1.3 ? 'text-amber-600' : ''}`}>{formatarMoeda(e.total)}</span></span></div>)}
            </div>
          ) : null}
        />

      </div>
    </div>
  )
}
