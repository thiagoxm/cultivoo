import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  Plus, Trash2, Pencil, X, ChevronDown, ChevronUp,
  PackageOpen, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Info
} from 'lucide-react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  TIPOS_INSUMOS, UNIDADES_INSUMOS,
  getLabelUnidadeInsumo, getTipoInsumo
} from '../config/culturasConfig'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HOJE = getHoje()

function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function mascaraMoeda(valor) {
  const nums = valor.replace(/\D/g, '')
  if (!nums) return ''
  const n = (parseInt(nums, 10) / 100).toFixed(2)
  return 'R$ ' + n.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function desmascarar(valor) {
  if (!valor) return ''
  return valor.replace(/[R$\s.]/g, '').replace(',', '.')
}

function formatarNumero(valor, decimais = 2) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimais,
    maximumFractionDigits: decimais,
  })
}

// Status de validade: ok | alerta (≤30 dias) | vencido
function statusValidade(dataValidade) {
  if (!dataValidade) return null
  const dias = differenceInDays(parseISO(dataValidade), parseISO(HOJE))
  if (dias < 0) return { tipo: 'vencido', dias: Math.abs(dias), label: `Vencido há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}` }
  if (dias <= 30) return { tipo: 'alerta', dias, label: `Vence em ${dias} dia${dias !== 1 ? 's' : ''}` }
  return { tipo: 'ok', dias, label: formatarData(dataValidade) }
}

// Custo médio ponderado das entradas de um produto
function calcularCustoMedio(movimentacoes) {
  const entradas = movimentacoes.filter(m => m.tipoMov === 'entrada')
  const totalQtd = entradas.reduce((a, m) => a + (Number(m.quantidade) || 0), 0)
  const totalValor = entradas.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
  return totalQtd > 0 ? totalValor / totalQtd : 0
}

// Saldo atual (entradas - saídas)
function calcularSaldo(movimentacoes) {
  return movimentacoes.reduce((a, m) => {
    return m.tipoMov === 'entrada'
      ? a + (Number(m.quantidade) || 0)
      : a - (Number(m.quantidade) || 0)
  }, 0)
}

// ─────────────────────────────────────────────
// Formulários padrão
// ─────────────────────────────────────────────
const PRODUTO_PADRAO = {
  produto: '',
  tipo: '',
  unidade: 'l',
  propriedadeId: '',
  temEstoqueMinimo: false,
  estoqueMinimo: '',
  dataValidade: '',
  observacoes: '',
}

const MOV_PADRAO = {
  tipoMov: 'entrada',   // entrada | saida
  produtoId: '',
  quantidade: '',
  valorTotal: '',       // só para entradas
  valorMask: '',
  dataMovimento: HOJE,
  safraId: '',
  lavouraId: '',
  notaRef: '',
  statusPagamento: 'pendente',
  dataVencimentoPagamento: '',
  observacoes: '',
}

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
export default function Estoque() {
  const { usuario } = useAuth()

  // Dados
  const [produtos, setProdutos] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])

  // UI
  const [modalProduto, setModalProduto] = useState(false)
  const [modalMov, setModalMov] = useState(false)
  const [modalDetalhe, setModalDetalhe] = useState(null)  // produto completo
  const [editandoProduto, setEditandoProduto] = useState(null)
  const [formProduto, setFormProduto] = useState(PRODUTO_PADRAO)
  const [formMov, setFormMov] = useState(MOV_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})

  // Filtros
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)

  // ── Carregar dados ──
  async function carregar() {
    const uid = usuario.uid
    const [prodSnap, movSnap, propSnap, safSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'insumos'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])
    setProdutos(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setMovimentacoes(movSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-estoque]')) setDropdownFiltroAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  // ── Produtos filtrados e enriquecidos com saldo/custo ──
  const produtosEnriquecidos = useMemo(() => {
    let base = produtos
    if (filtroPropriedadeIds.length > 0)
      base = base.filter(p => filtroPropriedadeIds.includes(p.propriedadeId))

    return base.map(p => {
      const movs = movimentacoes.filter(m => m.produtoId === p.id)
      const saldo = calcularSaldo(movs)
      const custoMedio = calcularCustoMedio(movs)
      const validade = statusValidade(p.dataValidade)
      const abaixoMinimo = p.temEstoqueMinimo && Number(p.estoqueMinimo) > 0 && saldo < Number(p.estoqueMinimo)
      return { ...p, saldo, custoMedio, validade, abaixoMinimo, movs }
    })
  }, [produtos, movimentacoes, filtroPropriedadeIds])

  // ── Agrupado por tipo ──
  const agrupado = useMemo(() => {
    const grupos = {}
    produtosEnriquecidos.forEach(p => {
      const tipo = p.tipo || 'outros'
      if (!grupos[tipo]) grupos[tipo] = []
      grupos[tipo].push(p)
    })

    return TIPOS_INSUMOS
      .filter(t => grupos[t.value])
      .map(t => {
        const itens = grupos[t.value]
        const totalAlertas = itens.filter(p =>
          p.abaixoMinimo || p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta'
        ).length
        const valorTotalEstoque = itens.reduce((a, p) => a + (p.saldo * p.custoMedio), 0)
        return { ...t, itens, totalAlertas, valorTotalEstoque }
      })
  }, [produtosEnriquecidos])

  // ── Lavouras da safra selecionada no form de movimentação ──
  const lavourasDaSafra = useMemo(() => {
    if (!formMov.safraId) return []
    const safra = safras.find(s => s.id === formMov.safraId)
    return lavouras.filter(l => safra?.lavouraIds?.includes(l.id))
  }, [formMov.safraId, safras, lavouras])

  // ── Produto selecionado no form de movimentação ──
  const produtoMov = useMemo(
    () => produtosEnriquecidos.find(p => p.id === formMov.produtoId) || null,
    [produtosEnriquecidos, formMov.produtoId]
  )

  // ── Toggle grupo ──
  function toggleGrupo(tipo) {
    setGruposExpandidos(g => ({ ...g, [tipo]: !expandidoPorPadrao(tipo) }))
  }
  function expandidoPorPadrao(tipo) {
    if (tipo in gruposExpandidos) return gruposExpandidos[tipo]
    return true // aberto por padrão
  }

  // ── Modal produto ──
  function abrirModalProduto(produto = null) {
    if (produto) {
      setEditandoProduto(produto.id)
      setFormProduto({
        produto: produto.produto || '',
        tipo: produto.tipo || '',
        unidade: produto.unidade || 'l',
        propriedadeId: produto.propriedadeId || '',
        temEstoqueMinimo: produto.temEstoqueMinimo || false,
        estoqueMinimo: produto.estoqueMinimo ? String(produto.estoqueMinimo) : '',
        dataValidade: produto.dataValidade || '',
        observacoes: produto.observacoes || '',
      })
    } else {
      setEditandoProduto(null)
      setFormProduto(PRODUTO_PADRAO)
    }
    setFabAberto(false)
    setModalProduto(true)
  }

  // ── Salvar produto ──
  async function salvarProduto(e) {
    e.preventDefault()
    if (!formProduto.produto.trim()) return alert('Informe o nome do produto.')
    if (!formProduto.tipo) return alert('Selecione o tipo do insumo.')
    if (!formProduto.propriedadeId) return alert('Selecione a propriedade.')
    setLoading(true)

    const prop = propriedades.find(p => p.id === formProduto.propriedadeId)
    const payload = {
      produto: formProduto.produto.trim(),
      tipo: formProduto.tipo,
      unidade: formProduto.unidade,
      propriedadeId: formProduto.propriedadeId,
      propriedadeNome: prop?.nome || '',
      temEstoqueMinimo: formProduto.temEstoqueMinimo,
      estoqueMinimo: formProduto.temEstoqueMinimo ? Number(formProduto.estoqueMinimo) : 0,
      dataValidade: formProduto.dataValidade || '',
      observacoes: formProduto.observacoes || '',
      uid: usuario.uid,
    }

    if (editandoProduto) {
      await updateDoc(doc(db, 'insumos', editandoProduto), payload)
    } else {
      await addDoc(collection(db, 'insumos'), { ...payload, criadoEm: new Date() })
    }

    setModalProduto(false)
    setEditandoProduto(null)
    setFormProduto(PRODUTO_PADRAO)
    await carregar()
    setLoading(false)
  }

  // ── Excluir produto ──
  function excluirProduto(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir o produto "${nome}"? Todas as movimentações vinculadas também serão excluídas.`,
      onConfirmar: async () => {
        // Exclui movimentações vinculadas
        const movsVinculadas = movimentacoes.filter(m => m.produtoId === id)
        await Promise.all(movsVinculadas.map(m => deleteDoc(doc(db, 'movimentacoesInsumos', m.id))))
        await deleteDoc(doc(db, 'insumos', id))
        await carregar()
      },
    })
  }

  // ── Modal movimentação ──
  function abrirModalMov(produtoId, tipoMov = 'entrada') {
    setFormMov({
      ...MOV_PADRAO,
      produtoId,
      tipoMov,
      dataMovimento: HOJE,
    })
    setFabAberto(false)
    setModalMov(true)
  }

  // ── Salvar movimentação ──
  async function salvarMov(e) {
    e.preventDefault()
    if (!formMov.quantidade || isNaN(Number(formMov.quantidade))) return alert('Informe a quantidade.')
    if (formMov.tipoMov === 'entrada' && !formMov.valorMask) return alert('Informe o valor total da compra.')

    const produto = produtosEnriquecidos.find(p => p.id === formMov.produtoId)
    const safra = safras.find(s => s.id === formMov.safraId)
    const lavoura = lavouras.find(l => l.id === formMov.lavouraId)
    const prop = propriedades.find(p => p.id === produto?.propriedadeId)
    const valorTotal = formMov.tipoMov === 'entrada' ? Number(desmascarar(formMov.valorMask)) : 0

    setLoading(true)

    const payloadMov = {
      produtoId: formMov.produtoId,
      produtoNome: produto?.produto || '',
      tipoProduto: produto?.tipo || '',
      unidade: produto?.unidade || '',
      tipoMov: formMov.tipoMov,
      quantidade: Number(formMov.quantidade),
      valorTotal,
      dataMovimento: formMov.dataMovimento,
      safraId: formMov.safraId || '',
      safraNome: safra?.nome || '',
      lavouraId: formMov.lavouraId || '',
      lavouraNome: lavoura?.nome || '',
      propriedadeId: produto?.propriedadeId || '',
      propriedadeNome: prop?.nome || '',
      notaRef: formMov.notaRef || '',
      statusPagamento: formMov.statusPagamento || 'pendente',
      dataVencimentoPagamento: formMov.dataVencimentoPagamento || '',
      observacoes: formMov.observacoes || '',
      uid: usuario.uid,
    }

    await addDoc(collection(db, 'movimentacoesInsumos'), { ...payloadMov, criadoEm: new Date() })

    // ── Lançamento automático no Financeiro para entradas ──
    if (formMov.tipoMov === 'entrada') {
      const tipoConfig = getTipoInsumo(produto?.tipo)
      const dataVenc = formMov.dataVencimentoPagamento || formMov.dataMovimento

      await addDoc(collection(db, 'financeiro'), {
        descricao: `Compra: ${produto?.produto || 'Insumo'}`,
        tipo: 'despesa',
        categoria: tipoConfig?.categoriaFinanceiro || 'Insumos',
        tipoDespesa: tipoConfig?.tipoFinanceiro || 'Outros',
        valor: valorTotal,
        vencimento: dataVenc,
        status: formMov.statusPagamento === 'pago' ? 'pago' : 'pendente',
        notaRef: formMov.notaRef || '',
        propriedadeId: produto?.propriedadeId || '',
        propriedadeNome: prop?.nome || '',
        safraId: formMov.safraId || '',
        patrimonioId: '',
        // referência cruzada para rastreabilidade
        origemEstoque: true,
        produtoId: formMov.produtoId,
        uid: usuario.uid,
        criadoEm: new Date(),
      })
    }

    setModalMov(false)
    setFormMov(MOV_PADRAO)
    await carregar()
    setLoading(false)
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-24">

      <h1 className="text-2xl font-bold text-gray-800">Estoque de Insumos</h1>

      {/* ── Filtro propriedade ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-estoque>
            <button type="button"
              onClick={() => setDropdownFiltroAberto(!dropdownFiltroAberto)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none min-w-[180px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">
                {filtroPropriedadeIds.length > 0
                  ? propriedades.filter(p => filtroPropriedadeIds.includes(p.id)).map(p => p.nome).join(', ')
                  : 'Selecione a(s) Propriedade(s)'}
              </span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {dropdownFiltroAberto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] py-1 max-h-48 overflow-y-auto">
                {propriedades.length === 0 && (
                  <p className="text-xs text-gray-400 px-3 py-2">Nenhuma propriedade cadastrada.</p>
                )}
                {propriedades.map(p => {
                  const sel = filtroPropriedadeIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setFiltroPropriedadeIds(f => sel ? f.filter(id => id !== p.id) : [...f, p.id])}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50">
                      <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>}
                      </span>
                      <span className={sel ? 'text-gray-800 font-medium' : 'text-gray-600'}>{p.nome}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {filtroPropriedadeIds.length > 0 && (
            <button onClick={() => setFiltroPropriedadeIds([])}
              className="text-xs text-gray-400 hover:text-red-400 underline">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* ── Lista vazia ── */}
      {agrupado.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <PackageOpen size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum insumo cadastrado.</p>
          <p className="text-xs mt-1 text-gray-300">Use o botão + para cadastrar o primeiro insumo.</p>
        </div>
      )}

      {/* ── Cards por tipo ── */}
      <div className="space-y-4">
        {agrupado.map(grupo => {
          const expandido = expandidoPorPadrao(grupo.value)

          return (
            <div key={grupo.value} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

              {/* Cabeçalho do tipo */}
              <button type="button"
                onClick={() => toggleGrupo(grupo.value)}
                className="w-full text-left transition-colors hover:brightness-95"
                style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>

                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--brand-gradient)' }}>
                      <span style={{ fontSize: 14 }}>{grupo.icone}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{grupo.label}</p>
                      <p className="text-xs text-gray-400">{grupo.itens.length} produto{grupo.itens.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {grupo.totalAlertas > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                        <AlertTriangle size={11} />
                        {grupo.totalAlertas}
                      </span>
                    )}
                    {expandido
                      ? <ChevronUp size={15} className="text-gray-400" />
                      : <ChevronDown size={15} className="text-gray-400" />}
                  </div>
                </div>

                {/* Indicador de valor em estoque */}
                <div className="px-4 pb-2 pt-1 border-t border-green-100 mt-1">
                  <p className="text-xs text-gray-400">
                    Valor em estoque:{' '}
                    <span className="font-semibold text-green-700">
                      R$ {formatarMoeda(grupo.valorTotalEstoque)}
                    </span>
                  </p>
                </div>
              </button>

              {/* Lista de produtos */}
              {expandido && (
                <div className="border-t border-gray-100">
                  {grupo.itens.map((produto, idx) => {
                    const bgZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
                    const prop = propriedades.find(p => p.id === produto.propriedadeId)

                    return (
                      <div key={produto.id}
                        className={`${bgZebra} px-4 py-3 hover:bg-blue-50/20 transition-colors`}>
                        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">

                          {/* Col 1 — Nome + propriedade */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-800">{produto.produto}</p>
                              {/* Alertas inline */}
                              {produto.validade?.tipo === 'vencido' && (
                                <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">
                                  ⚠️ Vencido
                                </span>
                              )}
                              {produto.validade?.tipo === 'alerta' && (
                                <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">
                                  ⏳ {produto.validade.label}
                                </span>
                              )}
                              {produto.abaixoMinimo && (
                                <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-100">
                                  📉 Abaixo do mínimo
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">{prop?.nome || produto.propriedadeNome}</p>
                          </div>

                          {/* Col 2 — Saldo + custo médio */}
                          <div className="flex-1 min-w-0 md:text-center">
                            <p className="text-sm font-bold text-green-700">
                              {formatarNumero(produto.saldo)} {getLabelUnidadeInsumo(produto.unidade)}
                            </p>
                            {produto.custoMedio > 0 && (
                              <p className="text-xs text-gray-400">
                                Custo médio: R$ {formatarMoeda(produto.custoMedio)}/{produto.unidade}
                              </p>
                            )}
                          </div>

                          {/* Col 3 — Ações */}
                          <div className="flex items-center gap-1 flex-shrink-0 md:justify-end">
                            {/* Botão detalhes */}
                            <button
                              onClick={e => { e.stopPropagation(); setModalDetalhe(produto) }}
                              className="text-gray-300 hover:text-blue-500 p-1 transition-colors"
                              title="Ver detalhes">
                              <Info size={15} />
                            </button>
                            {/* Entrada */}
                            <button
                              onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'entrada') }}
                              className="text-gray-300 hover:text-green-600 p-1 transition-colors"
                              title="Registrar entrada">
                              <ArrowDownCircle size={15} />
                            </button>
                            {/* Saída */}
                            <button
                              onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'saida') }}
                              className="text-gray-300 hover:text-amber-600 p-1 transition-colors"
                              title="Registrar saída">
                              <ArrowUpCircle size={15} />
                            </button>
                            {/* Editar */}
                            <button
                              onClick={e => { e.stopPropagation(); abrirModalProduto(produto) }}
                              className="text-gray-300 hover:text-blue-500 p-1 transition-colors"
                              title="Editar produto">
                              <Pencil size={15} />
                            </button>
                            {/* Excluir */}
                            <button
                              onClick={e => { e.stopPropagation(); excluirProduto(produto.id, produto.produto) }}
                              className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                              title="Excluir produto">
                              <Trash2 size={15} />
                            </button>
                          </div>

                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── FAB ── */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">
                Cadastrar insumo
              </span>
              <button onClick={() => abrirModalProduto()}
                className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90"
                style={{ background: 'var(--brand-gradient)' }}>
                <Plus size={18} />
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setFabAberto(!fabAberto)}
          className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${fabAberto ? 'rotate-45' : ''}`}
          style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}>
          <Plus size={24} />
        </button>
      </div>

      {/* ── Modal cadastro/edição de produto ── */}
      {modalProduto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">

            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                {editandoProduto ? 'Editar insumo' : 'Cadastrar insumo'}
              </h2>
              <button onClick={() => { setModalProduto(false); setEditandoProduto(null) }}
                className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={salvarProduto} className="p-5 space-y-4">

              {/* Produto */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Produto <span className="text-red-500">*</span>
                </label>
                <input type="text" value={formProduto.produto}
                  onChange={e => setFormProduto(f => ({ ...f, produto: e.target.value }))}
                  placeholder="Ex: Roundup, Urea 45%, Milho DKB 390..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo <span className="text-red-500">*</span>
                </label>
                <select value={formProduto.tipo}
                  onChange={e => setFormProduto(f => ({ ...f, tipo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione o tipo...</option>
                  {TIPOS_INSUMOS.map(t => (
                    <option key={t.value} value={t.value}>{t.icone} {t.label}</option>
                  ))}
                </select>
              </div>

              {/* Unidade + Propriedade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                  <select value={formProduto.unidade}
                    onChange={e => setFormProduto(f => ({ ...f, unidade: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {UNIDADES_INSUMOS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Propriedade <span className="text-red-500">*</span>
                  </label>
                  <select value={formProduto.propriedadeId}
                    onChange={e => setFormProduto(f => ({ ...f, propriedadeId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required>
                    <option value="">Selecione...</option>
                    {propriedades.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Data de validade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de validade <span className="text-xs text-gray-400 font-normal">(opcional)</span>
                </label>
                <input type="date" value={formProduto.dataValidade}
                  onChange={e => setFormProduto(f => ({ ...f, dataValidade: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              {/* Estoque mínimo — toggle */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => setFormProduto(f => ({ ...f, temEstoqueMinimo: !f.temEstoqueMinimo, estoqueMinimo: '' }))}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formProduto.temEstoqueMinimo ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formProduto.temEstoqueMinimo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Definir alerta de estoque mínimo</p>
                    <p className="text-xs text-gray-400">Receba alertas quando o saldo estiver abaixo do mínimo</p>
                  </div>
                </label>
                {formProduto.temEstoqueMinimo && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Quantidade mínima ({getLabelUnidadeInsumo(formProduto.unidade)})
                    </label>
                    <input type="number" min="0" step="0.01"
                      value={formProduto.estoqueMinimo}
                      onChange={e => setFormProduto(f => ({ ...f, estoqueMinimo: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                )}
              </div>

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={formProduto.observacoes}
                  onChange={e => setFormProduto(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder="Marca, fornecedor, dosagem recomendada, etc."
                  rows={2}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button"
                  onClick={() => { setModalProduto(false); setEditandoProduto(null) }}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                  style={{ background: 'var(--brand-gradient)' }}>
                  {loading ? 'Salvando...' : editandoProduto ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal movimentação (entrada / saída) ── */}
      {modalMov && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">

            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {formMov.tipoMov === 'entrada'
                  ? <ArrowDownCircle size={18} className="text-green-600" />
                  : <ArrowUpCircle size={18} className="text-amber-600" />}
                <h2 className="font-bold text-gray-800">
                  {formMov.tipoMov === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}
                </h2>
              </div>
              <button onClick={() => setModalMov(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={salvarMov} className="p-5 space-y-4">

              {/* Produto selecionado — info */}
              {produtoMov && (
                <div className="bg-green-50 rounded-xl px-3 py-2 border border-green-100">
                  <p className="text-xs text-gray-500">Produto</p>
                  <p className="text-sm font-semibold text-gray-800">{produtoMov.produto}</p>
                  <p className="text-xs text-gray-500">
                    Saldo atual: <span className="font-medium text-green-700">
                      {formatarNumero(produtoMov.saldo)} {getLabelUnidadeInsumo(produtoMov.unidade)}
                    </span>
                  </p>
                </div>
              )}

              {/* Data */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data <span className="text-red-500">*</span>
                </label>
                <input type="date" value={formMov.dataMovimento}
                  onChange={e => setFormMov(f => ({ ...f, dataMovimento: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              {/* Quantidade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantidade ({produtoMov ? getLabelUnidadeInsumo(produtoMov.unidade) : ''}) <span className="text-red-500">*</span>
                </label>
                <input type="number" min="0" step="0.01" value={formMov.quantidade}
                  onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              {/* Campos específicos de entrada */}
              {formMov.tipoMov === 'entrada' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valor total da compra <span className="text-red-500">*</span>
                    </label>
                    <input value={formMov.valorMask}
                      onChange={e => setFormMov(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))}
                      placeholder="R$ 0,00"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      required />
                  </div>

                  {/* Status de pagamento */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Situação do pagamento</label>
                    <div className="flex gap-2">
                      {[
                        { val: 'pendente', label: 'Pendente', cor: 'border-yellow-400 bg-yellow-50 text-yellow-700' },
                        { val: 'pago', label: 'Pago', cor: 'border-green-500 bg-green-50 text-green-700' },
                      ].map(op => (
                        <button key={op.val} type="button"
                          onClick={() => setFormMov(f => ({ ...f, statusPagamento: op.val }))}
                          className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                            formMov.statusPagamento === op.val ? op.cor : 'border-gray-200 text-gray-400 hover:border-gray-300'
                          }`}>
                          {op.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Data de vencimento do pagamento — só se pendente */}
                  {formMov.statusPagamento === 'pendente' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vencimento do pagamento
                      </label>
                      <input type="date" value={formMov.dataVencimentoPagamento}
                        onChange={e => setFormMov(f => ({ ...f, dataVencimentoPagamento: e.target.value }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <p className="text-xs text-gray-400 mt-1">
                        Um lançamento de despesa será criado automaticamente no Financeiro.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nº Doc. Referência</label>
                    <input value={formMov.notaRef}
                      onChange={e => setFormMov(f => ({ ...f, notaRef: e.target.value }))}
                      placeholder="Nota Fiscal, Boleto, etc."
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </>
              )}

              {/* Campos específicos de saída */}
              {formMov.tipoMov === 'saida' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Safra</label>
                    <select value={formMov.safraId}
                      onChange={e => setFormMov(f => ({ ...f, safraId: e.target.value, lavouraId: '' }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      <option value="">Selecione a safra...</option>
                      {safras.filter(s => s.status === 'Em andamento').map(s => (
                        <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>
                      ))}
                    </select>
                  </div>
                  {lavourasDaSafra.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lavoura</label>
                      <select value={formMov.lavouraId}
                        onChange={e => setFormMov(f => ({ ...f, lavouraId: e.target.value }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione a lavoura...</option>
                        {lavourasDaSafra.map(l => (
                          <option key={l.id} value={l.id}>{l.nome}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={formMov.observacoes}
                  onChange={e => setFormMov(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder={formMov.tipoMov === 'entrada' ? 'Fornecedor, lote, condições, etc.' : 'Área aplicada, dosagem, condições, etc.'}
                  rows={2}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModalMov(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                  style={{ background: 'var(--brand-gradient)' }}>
                  {loading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal detalhes do produto ── */}
      {modalDetalhe && (() => {
        const prod = modalDetalhe
        const validade = prod.validade
        const pctMinimo = prod.temEstoqueMinimo && Number(prod.estoqueMinimo) > 0
          ? Math.min(100, Math.round((prod.saldo / Number(prod.estoqueMinimo)) * 100))
          : null
        const movsOrdenadas = [...(prod.movs || [])].sort((a, b) =>
          (b.dataMovimento || '').localeCompare(a.dataMovimento || '')
        )

        return (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto">

              <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">{prod.produto}</h2>
                  <p className="text-xs text-gray-400">
                    {getTipoInsumo(prod.tipo)?.icone} {getTipoInsumo(prod.tipo)?.label} · {prod.propriedadeNome}
                  </p>
                </div>
                <button onClick={() => setModalDetalhe(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-5">

                {/* Situação atual */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Situação Atual</p>
                  <div className="grid grid-cols-2 gap-3">

                    {/* Saldo */}
                    <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                      <p className="text-xs text-gray-500">Saldo em estoque</p>
                      <p className="text-lg font-bold text-green-700 mt-0.5">
                        {formatarNumero(prod.saldo)}
                        <span className="text-sm font-medium ml-1">{getLabelUnidadeInsumo(prod.unidade)}</span>
                      </p>
                    </div>

                    {/* Custo médio */}
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">Custo médio</p>
                      <p className="text-lg font-bold text-gray-700 mt-0.5">
                        R$ {formatarMoeda(prod.custoMedio)}
                        <span className="text-xs font-normal text-gray-400 ml-1">/{prod.unidade}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Estoque mínimo com barra */}
                {prod.temEstoqueMinimo && pctMinimo !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-600">
                        Estoque mínimo: {formatarNumero(prod.estoqueMinimo)} {getLabelUnidadeInsumo(prod.unidade)}
                      </p>
                      <p className={`text-xs font-semibold ${prod.abaixoMinimo ? 'text-orange-600' : 'text-green-600'}`}>
                        {pctMinimo}% do mínimo
                      </p>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          pctMinimo < 50 ? 'bg-orange-500' : pctMinimo < 100 ? 'bg-amber-400' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(pctMinimo, 100)}%` }}
                      />
                    </div>
                    {prod.abaixoMinimo && (
                      <p className="text-xs text-orange-600 mt-1">⚠️ Saldo abaixo do estoque mínimo</p>
                    )}
                  </div>
                )}

                {/* Validade */}
                {validade && (
                  <div className={`rounded-xl p-3 border ${
                    validade.tipo === 'vencido' ? 'bg-red-50 border-red-100' :
                    validade.tipo === 'alerta' ? 'bg-amber-50 border-amber-100' :
                    'bg-gray-50 border-gray-100'
                  }`}>
                    <p className="text-xs text-gray-500">Data de validade</p>
                    <p className={`text-sm font-semibold mt-0.5 ${
                      validade.tipo === 'vencido' ? 'text-red-600' :
                      validade.tipo === 'alerta' ? 'text-amber-600' :
                      'text-gray-700'
                    }`}>
                      {formatarData(prod.dataValidade)} — {validade.label}
                    </p>
                  </div>
                )}

                {/* Histórico de movimentações */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Histórico de Movimentações
                  </p>
                  {movsOrdenadas.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Nenhuma movimentação registrada.</p>
                  ) : (
                    <div className="space-y-2">
                      {movsOrdenadas.map((m, idx) => (
                        <div key={m.id || idx}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                          <div className="flex items-center gap-2 min-w-0">
                            {m.tipoMov === 'entrada'
                              ? <ArrowDownCircle size={14} className="text-green-600 flex-shrink-0" />
                              : <ArrowUpCircle size={14} className="text-amber-600 flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700">
                                {m.tipoMov === 'entrada' ? 'Entrada' : 'Saída'}
                                {m.safraNome ? ` · ${m.safraNome}` : ''}
                                {m.lavouraNome ? ` · ${m.lavouraNome}` : ''}
                              </p>
                              <p className="text-xs text-gray-400">{formatarData(m.dataMovimento)}</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            <p className={`text-sm font-bold ${m.tipoMov === 'entrada' ? 'text-green-700' : 'text-amber-700'}`}>
                              {m.tipoMov === 'entrada' ? '+' : '-'}{formatarNumero(m.quantidade)} {getLabelUnidadeInsumo(prod.unidade)}
                            </p>
                            {m.valorTotal > 0 && (
                              <p className="text-xs text-gray-400">R$ {formatarMoeda(m.valorTotal)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Observações do produto */}
                {prod.observacoes && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Observações</p>
                    <p className="text-sm text-gray-600">{prod.observacoes}</p>
                  </div>
                )}

              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Modal confirmação exclusão ── */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600">{confirmacao.mensagem}</p>
            <p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacao(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => { confirmacao.onConfirmar(); setConfirmacao(null) }}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}