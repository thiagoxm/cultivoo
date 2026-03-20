import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Pencil, Tractor, X } from 'lucide-react'
import { calcularDepreciacaoMensal, calcularValorAtual, calcularPercentualRateio } from '../services/depreciacao'
import {
  ComposedChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList
} from 'recharts'

const CATEGORIAS = ['Equipamentos Móveis', 'Equipamentos Fixos', 'Benfeitorias']
const ANO_ATUAL = new Date().getFullYear()
const MES_ATUAL = new Date().getMonth() + 1
const ANOS = Array.from({ length: 50 }, (_, i) => ANO_ATUAL - i)
const CORES = { 'Equipamentos Móveis': '#16a34a', 'Equipamentos Fixos': '#2563eb', 'Benfeitorias': '#d97706' }

function mascaraMoeda(valor) {
  const nums = String(valor).replace(/\D/g, '')
  if (!nums) return ''
  const n = (parseInt(nums, 10) / 100).toFixed(2)
  return 'R$ ' + n.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
function desmascarar(valor) {
  if (!valor) return 0
  return parseFloat(valor.replace(/[R$\s.]/g, '').replace(',', '.')) || 0
}
function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FORM_PADRAO = {
  nome: '', categoria: '', propriedadeIds: [],
  tipoRateio: 'igualitario', percentuaisRateio: {},
  valorAquisicaoMask: '', valorResidualMask: '',
  anoAquisicao: ANO_ATUAL, vidaUtil: '',
  numeroIdentificacao: '', descricao: ''
}

// Dropdown multiselect reutilizável
function DropdownMulti({ valor, onChange, opcoes, placeholder, aberto, setAberto }) {
  const nomesSelecionados = opcoes.filter(o => valor.includes(o.id)).map(o => o.nome).join(', ')
  return (
    <div className="relative" data-dropdown>
      <button type="button" onClick={() => setAberto(!aberto)}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-normal bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[180px] w-full flex items-center justify-between gap-2">
        <span className="text-gray-700 truncate">
          {valor.length > 0 ? nomesSelecionados : placeholder}
        </span>
        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {aberto && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] w-full py-1 max-h-48 overflow-y-auto">
          {opcoes.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Nenhuma opção disponível.</p>}
          {opcoes.map(o => {
            const sel = valor.includes(o.id)
            return (
              <button key={o.id} type="button" onClick={() => onChange(o.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors">
                <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>
                  {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>}
                </span>
                <span className={sel ? 'text-gray-800 font-medium' : 'text-gray-600'}>{o.nome}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Patrimonio() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)
  const [dropdownPropAberto, setDropdownPropAberto] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [patSnap, propSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'patrimonios'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])
    setLista(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown]')) {
        setDropdownFiltroAberto(false)
        setDropdownPropAberto(false)
      }
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  // Área total por propriedade
  const areasPropriedades = useMemo(() => {
    const areas = {}
    lavouras.forEach(l => {
      if (l.propriedadeId) {
        areas[l.propriedadeId] = (areas[l.propriedadeId] || 0) + (Number(l.areaHa) || 0)
      }
    })
    return areas
  }, [lavouras])

  // Lista filtrada
  const listaFiltrada = useMemo(() => {
    if (filtroPropriedadeIds.length === 0) return lista
    return lista.filter(p =>
      p.propriedadeIds?.some(id => filtroPropriedadeIds.includes(id))
    )
  }, [lista, filtroPropriedadeIds])

  // Agrupamento por propriedade → categoria, com valores rateados
  const agrupado = useMemo(() => {
    const grupos = {}
    listaFiltrada.forEach(p => {
      const ids = p.propriedadeIds?.length > 0 ? p.propriedadeIds : ['']
      ids.forEach(propId => {
        if (filtroPropriedadeIds.length > 0 && !filtroPropriedadeIds.includes(propId)) return
        const propNome = propriedades.find(x => x.id === propId)?.nome || 'Sem propriedade'
        if (!grupos[propId]) grupos[propId] = { propNome, categorias: {} }
        if (!grupos[propId].categorias[p.categoria]) grupos[propId].categorias[p.categoria] = []
        const percentual = calcularPercentualRateio(p, propId, areasPropriedades)
        grupos[propId].categorias[p.categoria].push({ ...p, _percentual: percentual })
      })
    })
    return grupos
  }, [listaFiltrada, propriedades, filtroPropriedadeIds, areasPropriedades])

  // Métricas dashboard — comparativo mesmo mês do ano anterior
  const metricas = useMemo(() => {
  const porCategoria = {}
  let totalAtual = 0, totalMesAnterior = 0, depreciacaoAnual = 0

  if (filtroPropriedadeIds.length > 0) {
    // Com filtro: soma apenas a fatia rateada de cada patrimônio
    // para cada propriedade selecionada
    filtroPropriedadeIds.forEach(propId => {
      listaFiltrada.forEach(p => {
        // Verifica se este patrimônio pertence a esta propriedade
        const ids = p.propriedadeIds || []
        if (!ids.includes(propId)) return

        const pct = calcularPercentualRateio(p, propId, areasPropriedades)
        const valorAtual = calcularValorAtual(p, ANO_ATUAL, MES_ATUAL) * pct
        const valorMesAnterior = calcularValorAtual(p, ANO_ATUAL - 1, MES_ATUAL) * pct
        const deprecMensal = calcularDepreciacaoMensal(p) * pct

        totalAtual += valorAtual
        totalMesAnterior += valorMesAnterior
        depreciacaoAnual += deprecMensal * 12

        const cat = p.categoria || 'Outros'
        porCategoria[cat] = (porCategoria[cat] || 0) + valorAtual
      })
    })
  } else {
    // Sem filtro: soma os valores totais de todos os patrimônios
    lista.forEach(p => {
      const valorAtual = calcularValorAtual(p, ANO_ATUAL, MES_ATUAL)
      const valorMesAnterior = calcularValorAtual(p, ANO_ATUAL - 1, MES_ATUAL)
      const deprecMensal = calcularDepreciacaoMensal(p)

      totalAtual += valorAtual
      totalMesAnterior += valorMesAnterior
      depreciacaoAnual += deprecMensal * 12

      const cat = p.categoria || 'Outros'
      porCategoria[cat] = (porCategoria[cat] || 0) + valorAtual
    })
  }

  const variacaoAbsoluta = totalAtual - totalMesAnterior
  const variacaoPercent = totalMesAnterior > 0
    ? (variacaoAbsoluta / totalMesAnterior) * 100 : 0

  // Dados bridge ordenados do maior para o menor
  const categoriaOrdenada = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])

  let acumulado = 0
  const dadosGrafico = categoriaOrdenada.map(([name, value]) => {
    const start = acumulado
    acumulado += value
    return { name, value, start, fill: CORES[name] || '#888' }
  })
  dadosGrafico.push({
    name: 'Total',
    value: totalAtual,
    start: 0,
    fill: '#374151',
    isTotal: true,
  })

  return {
    totalAtual, totalMesAnterior, depreciacaoAnual,
    variacaoAbsoluta, variacaoPercent, dadosGrafico
  }
}, [lista, listaFiltrada, filtroPropriedadeIds, areasPropriedades])


  // Percentual total dos rateios personalizados
  const totalPercentuais = useMemo(() => {
    if (form.tipoRateio !== 'personalizado') return 100
    return form.propriedadeIds.reduce((acc, id) => acc + (Number(form.percentuaisRateio[id]) || 0), 0)
  }, [form.tipoRateio, form.propriedadeIds, form.percentuaisRateio])

  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
    setFabAberto(false)
    setModal(true)
  }

  function abrirEdicao(item) {
    setEditando(item.id)
    setForm({
      nome: item.nome || '',
      categoria: item.categoria || '',
      propriedadeIds: item.propriedadeIds || [],
      tipoRateio: item.tipoRateio || 'igualitario',
      percentuaisRateio: item.percentuaisRateio || {},
      valorAquisicaoMask: item.valorAquisicao
        ? mascaraMoeda(String(Math.round(Number(item.valorAquisicao) * 100))) : '',
      valorResidualMask: item.valorResidual
        ? mascaraMoeda(String(Math.round(Number(item.valorResidual) * 100))) : '',
      anoAquisicao: item.anoAquisicao || ANO_ATUAL,
      vidaUtil: item.vidaUtil || '',
      numeroIdentificacao: item.numeroIdentificacao || '',
      descricao: item.descricao || '',
    })
    setModal(true)
  }

  async function salvar(e) {
    e.preventDefault()
    if (form.propriedadeIds.length === 0) return alert('Selecione ao menos uma propriedade.')
    if (form.tipoRateio === 'personalizado' && Math.abs(totalPercentuais - 100) > 0.01) {
      return alert(`A soma dos percentuais deve ser 100%. Atual: ${totalPercentuais.toFixed(1)}%`)
    }
    if (form.tipoRateio === 'area') {
      const semArea = form.propriedadeIds.filter(id => !areasPropriedades[id])
      if (semArea.length > 0) {
        const nomes = semArea.map(id => propriedades.find(p => p.id === id)?.nome || id).join(', ')
        return alert(`As seguintes propriedades não têm lavouras cadastradas e não podem usar rateio por área: ${nomes}`)
      }
    }
    setLoading(true)
    const propNomes = propriedades
      .filter(p => form.propriedadeIds.includes(p.id))
      .map(p => p.nome)
    const payload = {
      nome: form.nome,
      categoria: form.categoria,
      propriedadeIds: form.propriedadeIds,
      propriedadeNomes: propNomes,
      tipoRateio: form.propriedadeIds.length > 1 ? form.tipoRateio : 'igualitario',
      percentuaisRateio: form.tipoRateio === 'personalizado' ? form.percentuaisRateio : {},
      valorAquisicao: desmascarar(form.valorAquisicaoMask),
      valorResidual: desmascarar(form.valorResidualMask),
      anoAquisicao: Number(form.anoAquisicao),
      vidaUtil: Number(form.vidaUtil) || 0,
      numeroIdentificacao: form.numeroIdentificacao,
      descricao: form.descricao,
      uid: usuario.uid,
    }
    if (editando) {
      await updateDoc(doc(db, 'patrimonios', editando), payload)
    } else {
      await addDoc(collection(db, 'patrimonios'), { ...payload, criadoEm: new Date() })
    }
    setModal(false)
    setEditando(null)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir este patrimônio?')) return
    await deleteDoc(doc(db, 'patrimonios', id))
    await carregar()
  }

  // Tooltip customizado para o gráfico bridge
  function TooltipBridge({ active, payload }) {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
        <p className="font-semibold text-gray-700">{d.name}</p>
        <p className="text-gray-600">R$ {formatarMoeda(d.value)}</p>
        {!d.isTotal && metricas.totalAtual > 0 && (
          <p className="text-gray-400">{((d.value / metricas.totalAtual) * 100).toFixed(1)}% do total</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-24">

      <h1 className="text-2xl font-bold text-gray-800">Patrimônio</h1>

      {/* Filtro */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMulti
            valor={filtroPropriedadeIds}
            onChange={id => setFiltroPropriedadeIds(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id])}
            opcoes={propriedades}
            placeholder="Selecione a(s) Propriedade(s)"
            aberto={dropdownFiltroAberto}
            setAberto={setDropdownFiltroAberto}
          />
          {filtroPropriedadeIds.length > 0 && (
            <button onClick={() => setFiltroPropriedadeIds([])}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors underline">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Dashboard */}
      <div className="grid grid-cols-2 gap-3">

        {/* Card patrimônio atual */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Patrimônio atual estimado</p>
          <p className="text-base font-bold text-gray-800">R$ {formatarMoeda(metricas.totalAtual)}</p>
          <p className={`text-xs mt-1 font-medium ${metricas.variacaoAbsoluta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {metricas.variacaoAbsoluta >= 0 ? '▲' : '▼'} R$ {formatarMoeda(Math.abs(metricas.variacaoAbsoluta))}
          </p>
          <p className="text-xs text-gray-400">
            vs {ANO_ATUAL - 1} ({metricas.variacaoPercent.toFixed(1)}%)
          </p>
        </div>

        {/* Card depreciação — col-span-2 no mobile */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 col-span-1 sm:col-span-1">
          <p className="text-xs text-gray-500 mb-1">Depreciação estimada {ANO_ATUAL}</p>
          <p className="text-base font-bold text-red-500">R$ {formatarMoeda(metricas.depreciacaoAnual)}</p>
          <p className="text-xs text-gray-400 mt-1">R$ {formatarMoeda(metricas.depreciacaoAnual / 12)}/mês</p>
        </div>

        {/* Gráfico bridge — largura total */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 col-span-2">
          <p className="text-xs text-gray-500 mb-3">Distribuição por categoria</p>
          {metricas.dadosGrafico.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart
                data={metricas.dadosGrafico}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={120}
                />
                <Tooltip content={<TooltipBridge />} />
                {/* Barra invisível de offset */}
<Bar dataKey="start" stackId="a" isAnimationActive={false}>
  {metricas.dadosGrafico.map((_, i) => (
    <Cell key={i} fill="transparent" stroke="none" />
  ))}
</Bar>

{/* Barra visível */}
<Bar dataKey="value" stackId="a" radius={[0, 4, 4, 0]} isAnimationActive={false}>
  {metricas.dadosGrafico.map((entry, i) => (
    <Cell key={i} fill={entry.fill} stroke="none" />
  ))}
  <LabelList
    dataKey="value"
    position="right"
    formatter={v => `R$ ${formatarMoeda(v)}`}
    style={{ fontSize: 10, fill: '#6b7280' }}
  />
</Bar>
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">Nenhum patrimônio cadastrado.</p>
          )}
        </div>
      </div>

      {/* Lista agrupada */}
      {Object.keys(agrupado).length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Tractor size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum patrimônio cadastrado.</p>
        </div>
      )}

      {Object.entries(agrupado).map(([propId, grupo]) => (
        <div key={propId} className="space-y-3">
          <h2 className="text-sm font-bold text-gray-700 border-b border-gray-200 pb-1">
            {grupo.propNome}
          </h2>
          {Object.entries(grupo.categorias).map(([cat, itens]) => (
            <div key={cat} className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{cat}</p>
              {itens.map(p => {
                const valorAtualTotal = calcularValorAtual(p, ANO_ATUAL, MES_ATUAL)
                const deprecMensalTotal = calcularDepreciacaoMensal(p)
                const pct = p._percentual || 1
                const valorAtualRateado = valorAtualTotal * pct
                const deprecRateada = deprecMensalTotal * pct
                const isRateado = p.propriedadeIds?.length > 1
                return (
                  <div key={`${p.id}-${propId}`}
                    className="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{p.nome}</p>
                        {isRateado && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            {(pct * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        <p className="text-xs text-gray-500">
                          Aquisição: R$ {formatarMoeda(Number(p.valorAquisicao) * pct)}
                        </p>
                        <p className="text-xs text-green-700 font-medium">
                          Atual: R$ {formatarMoeda(valorAtualRateado)}
                        </p>
                        {deprecRateada > 0 && (
                          <p className="text-xs text-red-400">
                            Deprec.: R$ {formatarMoeda(deprecRateada)}/mês
                          </p>
                        )}
                      </div>
                      {p.descricao && <p className="text-xs text-gray-400 mt-0.5">{p.descricao}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => abrirEdicao(p)} className="text-gray-300 hover:text-blue-500 p-1">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => excluir(p.id)} className="text-gray-300 hover:text-red-500 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">
                Novo patrimônio
              </span>
              <button onClick={abrirModal}
                className="w-11 h-11 rounded-full bg-green-600 text-white flex items-center justify-center shadow hover:bg-green-700 transition-colors">
                <Plus size={18} />
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setFabAberto(!fabAberto)}
          className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${
            fabAberto ? 'bg-gray-600 rotate-45' : 'bg-green-700 hover:bg-green-800'
          }`}>
          <Plus size={24} />
        </button>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editando ? 'Editar patrimônio' : 'Novo patrimônio'}</h2>
              <button onClick={() => { setModal(false); setEditando(null) }}
                className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">

              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Trator John Deere 5075E"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                  <option value="">Selecione...</option>
                  {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              {/* Propriedades */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Propriedade(s) <span className="text-red-500">*</span>
                </label>
                <DropdownMulti
                  valor={form.propriedadeIds}
                  onChange={id => setForm(f => ({
                    ...f,
                    propriedadeIds: f.propriedadeIds.includes(id)
                      ? f.propriedadeIds.filter(x => x !== id)
                      : [...f.propriedadeIds, id],
                    percentuaisRateio: {}
                  }))}
                  opcoes={propriedades}
                  placeholder="Selecione a(s) Propriedade(s)"
                  aberto={dropdownPropAberto}
                  setAberto={setDropdownPropAberto}
                />
              </div>

              {/* Rateio — aparece apenas quando há mais de 1 propriedade */}
              {form.propriedadeIds.length > 1 && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <label className="block text-sm font-medium text-gray-700">Tipo de rateio</label>
                  <div className="flex gap-2">
                    {[
                      { val: 'igualitario', label: 'Igualitário' },
                      { val: 'area', label: 'Por área' },
                      { val: 'personalizado', label: 'Personalizado' },
                    ].map(op => (
                      <button key={op.val} type="button"
                        onClick={() => setForm(f => ({ ...f, tipoRateio: op.val, percentuaisRateio: {} }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          form.tipoRateio === op.val
                            ? 'bg-green-700 text-white border-green-700'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                        }`}>
                        {op.label}
                      </button>
                    ))}
                  </div>

                  {/* Preview rateio igualitário e por área */}
                  {(form.tipoRateio === 'igualitario' || form.tipoRateio === 'area') && (
                    <div className="space-y-1">
                      {form.propriedadeIds.map(id => {
                        const prop = propriedades.find(p => p.id === id)
                        const pct = form.tipoRateio === 'igualitario'
                          ? 100 / form.propriedadeIds.length
                          : (() => {
                            const totalArea = form.propriedadeIds.reduce((a, pid) => a + (areasPropriedades[pid] || 0), 0)
                            return totalArea > 0 ? ((areasPropriedades[id] || 0) / totalArea) * 100 : 0
                          })()
                        return (
                          <div key={id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600">{prop?.nome}</span>
                            <span className="font-medium text-gray-800">
                              {pct.toFixed(1)}%
                              {form.tipoRateio === 'area' && (
                                <span className="text-gray-400 ml-1">
                                  ({areasPropriedades[id]?.toFixed(1) || '0'} ha)
                                </span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Rateio personalizado */}
                  {form.tipoRateio === 'personalizado' && (
                    <div className="space-y-2">
                      {form.propriedadeIds.map(id => {
                        const prop = propriedades.find(p => p.id === id)
                        return (
                          <div key={id} className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 flex-1 truncate">{prop?.nome}</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number" min="0" max="100" step="0.1"
                                value={form.percentuaisRateio[id] || ''}
                                onChange={e => setForm(f => ({
                                  ...f,
                                  percentuaisRateio: { ...f.percentuaisRateio, [id]: e.target.value }
                                }))}
                                placeholder="0"
                                className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 text-right"
                              />
                              <span className="text-xs text-gray-500">%</span>
                            </div>
                          </div>
                        )
                      })}
                      <div className={`flex justify-end text-xs font-medium ${
                        Math.abs(totalPercentuais - 100) < 0.01 ? 'text-green-600' : 'text-red-500'
                      }`}>
                        Total: {totalPercentuais.toFixed(1)}% {Math.abs(totalPercentuais - 100) < 0.01 ? '✓' : '(deve ser 100%)'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Valores */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor de aquisição</label>
                  <input value={form.valorAquisicaoMask}
                    onChange={e => setForm(f => ({ ...f, valorAquisicaoMask: mascaraMoeda(e.target.value) }))}
                    placeholder="R$ 0,00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor residual</label>
                  <input value={form.valorResidualMask}
                    onChange={e => setForm(f => ({ ...f, valorResidualMask: mascaraMoeda(e.target.value) }))}
                    placeholder="Valor de revenda esperado"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>

              {/* Ano de aquisição + Vida útil */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ano de aquisição</label>
                  <select value={form.anoAquisicao}
                    onChange={e => setForm(f => ({ ...f, anoAquisicao: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {ANOS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vida útil (anos)</label>
                  <input type="number" value={form.vidaUtil}
                    onChange={e => setForm(f => ({ ...f, vidaUtil: e.target.value }))}
                    placeholder="Nº de anos (1-100)"
                    min={1} max={100}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>

              {/* Nº Identificação */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº de Identificação</label>
                <input value={form.numeroIdentificacao}
                  onChange={e => setForm(f => ({ ...f, numeroIdentificacao: e.target.value }))}
                  placeholder="Número de série, chassi, etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setModal(false); setEditando(null) }}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm hover:bg-green-800 disabled:opacity-50">
                  {loading ? 'Salvando...' : editando ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}