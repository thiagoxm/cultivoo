import { useEffect, useState, useMemo, useRef } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  Plus, Trash2, Pencil, X,
  ChevronDown, ChevronUp,
  PackageOpen, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle,
  Info, Search, Clock, TrendingDown,
  Ban, Edit3, History
} from 'lucide-react'
import { format, parseISO, differenceInDays, subYears } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  TIPOS_INSUMOS, UNIDADES_INSUMOS,
  getLabelUnidadeInsumo, getTipoInsumo,
  getVinculosInsumo, getTiposSaidaDisponiveis, getTipoSaida,
} from '../config/culturasConfig'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HOJE = getHoje()
const UM_ANO_ATRAS = subYears(new Date(), 1).toISOString().split('T')[0]

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

// "L" maiúsculo: substitui /l e l/ na exibição de unidades
function labelUnidadeDisplay(value) {
  const label = getLabelUnidadeInsumo(value)
  return label.replace(/\bL\b/i, 'L').replace(/litros/i, 'Litros')
}
function unidadeDisplay(value) {
  if (!value) return ''
  if (value === 'l') return 'L'
  if (value === 'ml') return 'mL'
  return value
}

function statusValidade(dataValidade) {
  if (!dataValidade) return null
  try {
    const dias = differenceInDays(parseISO(dataValidade), parseISO(HOJE))
    if (dias < 0) return { tipo: 'vencido', dias: Math.abs(dias), label: `Vencido há ${Math.abs(dias)}d` }
    if (dias <= 30) return { tipo: 'alerta', dias, label: dias === 0 ? 'Vence hoje' : `Vence em ${dias}d` }
    return { tipo: 'ok', dias, label: formatarData(dataValidade) }
  } catch { return null }
}

function calcularCustoMedioTotal(movimentacoes) {
  const entradas = movimentacoes.filter(m => m.tipoMov === 'entrada' && !m.cancelado)
  const totalQtd = entradas.reduce((a, m) => a + (Number(m.quantidade) || 0), 0)
  const totalValor = entradas.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
  if (totalQtd === 0) return 0
  return totalValor / totalQtd
}

function calcularCustoMedio12m(movimentacoes) {
  const entradas = movimentacoes.filter(m =>
    m.tipoMov === 'entrada' && !m.cancelado && m.dataMovimento >= UM_ANO_ATRAS
  )
  const totalQtd = entradas.reduce((a, m) => a + (Number(m.quantidade) || 0), 0)
  const totalValor = entradas.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
  if (totalQtd === 0) return null
  return totalValor / totalQtd
}

function calcularSaldo(movimentacoes) {
  return movimentacoes
    .filter(m => !m.cancelado)
    .reduce((a, m) => {
      if (m.tipoMov === 'entrada') return a + (Number(m.quantidade) || 0)
      if (m.tipoMov === 'saida') return a - (Number(m.quantidade) || 0)
      return a
    }, 0)
}

function calcularLotesRestantes(movimentacoes) {
  const entradasAtivas = movimentacoes
    .filter(m => m.tipoMov === 'entrada' && !m.cancelado)
    .sort((a, b) => (a.dataMovimento || '').localeCompare(b.dataMovimento || ''))
    .map(m => ({ ...m, saldoLote: Number(m.quantidade) || 0 }))

  const saidas = movimentacoes
    .filter(m => m.tipoMov === 'saida' && !m.cancelado)
    .sort((a, b) => (a.dataMovimento || '').localeCompare(b.dataMovimento || ''))

  saidas.forEach(saida => {
    if (saida.lotesConsumidos?.length > 0) {
      saida.lotesConsumidos.forEach(lc => {
        const lote = entradasAtivas.find(e => e.id === lc.entradaId)
        if (lote) lote.saldoLote -= Number(lc.quantidade) || 0
      })
    } else {
      let restante = Number(saida.quantidade) || 0
      for (const lote of entradasAtivas) {
        if (restante <= 0) break
        const consumido = Math.min(lote.saldoLote, restante)
        lote.saldoLote -= consumido
        restante -= consumido
      }
    }
  })

  return entradasAtivas.filter(l => l.saldoLote > 0.001)
}

function validadeMaisCriticaFIFO(movimentacoes) {
  const lotes = calcularLotesRestantes(movimentacoes)
    .filter(l => l.dataValidade)
    .map(l => ({ ...statusValidade(l.dataValidade), dataValidade: l.dataValidade }))
    .filter(Boolean)
  if (lotes.length === 0) return null
  const vencidos = lotes.filter(l => l.tipo === 'vencido')
  if (vencidos.length > 0) return vencidos.sort((a, b) => b.dias - a.dias)[0]
  const alertas = lotes.filter(l => l.tipo === 'alerta')
  if (alertas.length > 0) return alertas.sort((a, b) => a.dias - b.dias)[0]
  return lotes.sort((a, b) => a.dias - b.dias)[0]
}

function calcularCustoTransferencia(movimentacoes, volume) {
  const entradas = movimentacoes
    .filter(m => m.tipoMov === 'entrada' && !m.cancelado && Number(m.valorTotal) > 0)
    .sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
  let restante = volume
  let custoTotal = 0
  const lotesUsados = []
  for (const entrada of entradas) {
    if (restante <= 0) break
    const qtdEntrada = Number(entrada.quantidade) || 0
    const valorEntrada = Number(entrada.valorTotal) || 0
    if (qtdEntrada === 0) continue
    const precoPorUnidade = valorEntrada / qtdEntrada
    const consumido = Math.min(qtdEntrada, restante)
    custoTotal += consumido * precoPorUnidade
    lotesUsados.push({ entradaId: entrada.id, dataMovimento: entrada.dataMovimento, quantidade: consumido, dataValidade: entrada.dataValidade || '' })
    restante -= consumido
  }
  return { custoTotal, lotesUsados }
}

function gerarResumoFIFO(lotesRestantes, qtd) {
  let restante = qtd
  const resumo = []
  for (const lote of lotesRestantes) {
    if (restante <= 0) break
    const consumido = Math.min(lote.saldoLote, restante)
    resumo.push({ entradaId: lote.id, dataMovimento: lote.dataMovimento, saldoLote: lote.saldoLote, consumido, dataValidade: lote.dataValidade || '', notaRef: lote.notaRef || '' })
    restante -= consumido
  }
  return resumo
}

// ─────────────────────────────────────────────
// Formulários padrão
// ─────────────────────────────────────────────
const PRODUTO_PADRAO = {
  produto: '', tipo: '', unidade: 'l', propriedadeId: '',
  temEstoqueMinimo: false, estoqueMinimo: '', observacoes: '',
}
const MOV_PADRAO = {
  tipoMov: 'entrada', tipoSaida: 'aplicacao', produtoId: '',
  quantidade: '', valorTotal: '', valorMask: '',
  statusPagamento: 'pendente', dataVencimentoPagamento: '',
  notaRef: '', temValidade: false, dataValidade: '',
  safraId: '', lavouraIds: [], dosagem: '', usarDosagem: false,
  editandoLotes: false, lotesEditados: [],
  patrimonioId: '', propriedadeDestinoId: '',
  dataMovimento: HOJE, observacoes: '',
}

// ─────────────────────────────────────────────
// Tooltip customizado (desktop: title nativo; mobile: 3s visível)
// ─────────────────────────────────────────────
function TooltipChip({ children, texto, className = '' }) {
  const [visivel, setVisivel] = useState(false)
  const timerRef = useRef(null)

  function handleTouch() {
    setVisivel(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisivel(false), 3000)
  }
  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div className={`relative inline-flex ${className}`}>
      <div title={texto} onTouchStart={handleTouch}>
        {children}
      </div>
      {visivel && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap z-50 pointer-events-none shadow-lg">
          {texto}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
export default function Estoque() {
  const { usuario } = useAuth()

  const [produtos, setProdutos] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [patrimonios, setPatrimonios] = useState([])

  const [modalProduto, setModalProduto] = useState(false)
  const [modalMov, setModalMov] = useState(false)
  const [modalDetalhe, setModalDetalhe] = useState(null)
  const [editandoProduto, setEditandoProduto] = useState(null)
  const [formProduto, setFormProduto] = useState(PRODUTO_PADRAO)
  const [formMov, setFormMov] = useState(MOV_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})
  const [propriedadesExpandidas, setPropriedadesExpandidas] = useState({})
  const [modalSugerirEntrada, setModalSugerirEntrada] = useState(null)
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState(null)
  const [historicoExpandido, setHistoricoExpandido] = useState(false)
  // Modal pagamentos pendentes
  const [modalPagamentos, setModalPagamentos] = useState(false)
  const [confirmacaoPagamento, setConfirmacaoPagamento] = useState(null) // { mov, dataPagamento }
  const [saidasExpandidas, setSaidasExpandidas] = useState({}) // chave: movId

  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [busca, setBusca] = useState('')
  const [filtroAlerta, setFiltroAlerta] = useState(null)
  const [filtroPagPendente] = useState(false) // mantido internamente, sem toggle de lista
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [prodSnap, movSnap, propSnap, safSnap, lavSnap, patSnap] = await Promise.all([
      getDocs(query(collection(db, 'insumos'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'patrimonios'), where('uid', '==', uid))),
    ])
    setProdutos(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setMovimentacoes(movSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPatrimonios(patSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.categoria === 'Equipamentos Móveis' && !p.isImplemento)
    )
  }

  useEffect(() => { carregar() }, [])
  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-estoque]')) setDropdownFiltroAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const produtosEnriquecidos = useMemo(() => {
    return produtos.map(p => {
      const movs = movimentacoes.filter(m => m.produtoId === p.id)
      const saldo = calcularSaldo(movs)
      const custoMedioTotal = calcularCustoMedioTotal(movs)
      const custoMedio12m = calcularCustoMedio12m(movs)
      const validade = validadeMaisCriticaFIFO(movs)
      const abaixoMinimo = p.temEstoqueMinimo && Number(p.estoqueMinimo) > 0 && saldo < Number(p.estoqueMinimo)
      const temPagPendente = movs.some(m => m.tipoMov === 'entrada' && m.statusPagamento === 'pendente' && !m.cancelado)
      return { ...p, saldo, custoMedioTotal, custoMedio12m, validade, abaixoMinimo, temPagPendente, movs }
    })
  }, [produtos, movimentacoes])

  // Sincroniza modal de detalhe
  useEffect(() => {
    if (modalDetalhe) {
      const atualizado = produtosEnriquecidos.find(p => p.id === modalDetalhe.id)
      if (atualizado) setModalDetalhe(atualizado)
    }
  }, [produtosEnriquecidos])

  // Pagamentos pendentes para o modal
  const pagamentosPendentes = useMemo(() => {
    return movimentacoes
      .filter(m => m.tipoMov === 'entrada' && m.statusPagamento === 'pendente' && !m.cancelado &&
        (filtroPropriedadeIds.length === 0 || filtroPropriedadeIds.includes(m.propriedadeId)))
      .sort((a, b) => (a.dataVencimentoPagamento || a.dataMovimento || '').localeCompare(b.dataVencimentoPagamento || b.dataMovimento || ''))
  }, [movimentacoes, filtroPropriedadeIds])

  const dashboards = useMemo(() => {
    let base = produtosEnriquecidos
    if (filtroPropriedadeIds.length > 0)
      base = base.filter(p => filtroPropriedadeIds.includes(p.propriedadeId))

    const comValidadeAlerta = base.filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta').length
    const comMinimoAlerta = base.filter(p => p.abaixoMinimo).length
    const valorTotalEstoque = base.reduce((a, p) => a + (p.saldo * p.custoMedioTotal), 0)

    const movsBase = movimentacoes.filter(m =>
      (filtroPropriedadeIds.length === 0 || filtroPropriedadeIds.includes(m.propriedadeId)) && !m.cancelado
    )
    const movsPendentes = movsBase.filter(m => m.tipoMov === 'entrada' && m.statusPagamento === 'pendente')
    const pendValor = movsPendentes.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
    const pendQtd = movsPendentes.length

    const ultimaMov = [...movsBase].sort((a, b) =>
      (b.dataMovimento || '').localeCompare(a.dataMovimento || '')
    )[0]
    const produtoUltimaMov = ultimaMov ? produtosEnriquecidos.find(p => p.id === ultimaMov.produtoId) || null : null

    // Tooltip de alertas
    const tooltipValidadeAlerta = base
      .filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta')
      .map(p => `${p.produto}: ${p.validade?.label}`)
      .join('\n') || 'Nenhum alerta de validade'
    const tooltipMinimoAlerta = base
      .filter(p => p.abaixoMinimo)
      .map(p => `${p.produto}: ${formatarNumero(p.saldo)} ${unidadeDisplay(p.unidade)} (mín. ${formatarNumero(p.estoqueMinimo)})`)
      .join('\n') || 'Nenhum alerta de estoque mínimo'

    return { comValidadeAlerta, comMinimoAlerta, valorTotalEstoque, pendValor, pendQtd, ultimaMov, produtoUltimaMov, tooltipValidadeAlerta, tooltipMinimoAlerta }
  }, [produtosEnriquecidos, movimentacoes, filtroPropriedadeIds])

  const agrupado = useMemo(() => {
    let base = produtosEnriquecidos
    if (busca.trim()) { const t = busca.toLowerCase(); base = base.filter(p => p.produto?.toLowerCase().includes(t)) }
    if (filtroAlerta === 'validade') base = base.filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta')
    if (filtroAlerta === 'minimo') base = base.filter(p => p.abaixoMinimo)
    if (filtroPagPendente) base = base.filter(p => p.temPagPendente)

    const porProp = {}
    base.forEach(p => {
      const propId = p.propriedadeId || ''
      const propNome = propriedades.find(x => x.id === propId)?.nome || 'Sem propriedade'
      if (!porProp[propId]) porProp[propId] = { propNome, tipos: {} }
      const tipo = p.tipo || 'outros'
      if (!porProp[propId].tipos[tipo]) porProp[propId].tipos[tipo] = []
      porProp[propId].tipos[tipo].push(p)
    })

    let entradas = Object.entries(porProp)
    if (filtroPropriedadeIds.length > 0) entradas = entradas.filter(([id]) => filtroPropriedadeIds.includes(id))

    return entradas
      .sort((a, b) => a[1].propNome.localeCompare(b[1].propNome))
      .map(([propId, grupo]) => ({
        propId, propNome: grupo.propNome,
        tipos: TIPOS_INSUMOS.filter(t => grupo.tipos[t.value]).map(t => {
          const itens = grupo.tipos[t.value]
          // Soma todos os tipos de alerta separadamente (um produto pode ter validade + mínimo = 2 alertas)
          const totalAlertas =
            itens.filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta').length +
            itens.filter(p => p.abaixoMinimo).length
          const valorEstoque = itens.reduce((a, p) => a + (p.saldo * p.custoMedioTotal), 0)
          // Tooltip do chip de alerta no cabeçalho do tipo
          const tooltipTipo = [
            itens.filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta').length > 0
              ? `${itens.filter(p => p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta').length} insumo(s) com validade próxima/vencida`
              : '',
            itens.filter(p => p.abaixoMinimo).length > 0
              ? `${itens.filter(p => p.abaixoMinimo).length} insumo(s) abaixo do estoque mínimo`
              : '',
          ].filter(Boolean).join('\n')
          return { ...t, itens, totalAlertas, valorEstoque, tooltipTipo }
        }),
      }))
  }, [produtosEnriquecidos, propriedades, filtroPropriedadeIds, busca, filtroAlerta, filtroPagPendente])

  // ── Derivados do form ──
  const lavourasDaSafra = useMemo(() => {
    if (!formMov.safraId) return []
    const safra = safras.find(s => s.id === formMov.safraId)
    return lavouras.filter(l => safra?.lavouraIds?.includes(l.id))
  }, [formMov.safraId, safras, lavouras])

  const areaLavourasSelecionadas = useMemo(() =>
    lavouras.filter(l => formMov.lavouraIds.includes(l.id)).reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
  , [formMov.lavouraIds, lavouras])

  const quantidadeCalculada = useMemo(() => {
    if (!formMov.usarDosagem || !formMov.dosagem || areaLavourasSelecionadas === 0) return null
    return Number(formMov.dosagem) * areaLavourasSelecionadas
  }, [formMov.usarDosagem, formMov.dosagem, areaLavourasSelecionadas])

  const produtoMov = useMemo(
    () => produtosEnriquecidos.find(p => p.id === formMov.produtoId) || null,
    [produtosEnriquecidos, formMov.produtoId]
  )
  const vinculos = useMemo(() => {
    if (!produtoMov) return { safra: 'opcional', lavoura: 'opcional', patrimonio: 'oculto' }
    return getVinculosInsumo(produtoMov.tipo)
  }, [produtoMov])
  const tiposSaidaDisponiveis = useMemo(() => {
    if (!produtoMov) return []
    return getTiposSaidaDisponiveis(produtoMov.tipo)
  }, [produtoMov])
  const saidaSimples = formMov.tipoMov === 'saida' && (formMov.tipoSaida === 'transferencia' || formMov.tipoSaida === 'venda')
  const lotesRestantes = useMemo(() => {
    if (!produtoMov || formMov.tipoMov !== 'saida') return []
    return calcularLotesRestantes(produtoMov.movs)
  }, [produtoMov, formMov.tipoMov])
  const qtdFinalLotesEditados = useMemo(() => {
    if (!formMov.editandoLotes) return null
    return formMov.lotesEditados.reduce((a, l) => a + (Number(l.consumido) || 0), 0)
  }, [formMov.editandoLotes, formMov.lotesEditados])
  const resumoFIFO = useMemo(() => {
    if (formMov.tipoMov !== 'saida' || formMov.editandoLotes) return []
    const qtd = formMov.usarDosagem && quantidadeCalculada !== null ? quantidadeCalculada : Number(formMov.quantidade) || 0
    if (qtd <= 0 || lotesRestantes.length === 0) return []
    return gerarResumoFIFO(lotesRestantes, qtd)
  }, [formMov.tipoMov, formMov.editandoLotes, formMov.quantidade, formMov.usarDosagem, quantidadeCalculada, lotesRestantes])

  const errQtdExcedeSaldo = useMemo(() => {
    if (formMov.tipoMov !== 'saida' || !produtoMov) return ''
    const qtd = formMov.usarDosagem && quantidadeCalculada !== null ? quantidadeCalculada
      : formMov.editandoLotes ? qtdFinalLotesEditados || 0
      : Number(formMov.quantidade) || 0
    if (qtd > produtoMov.saldo) return `Quantidade superior ao saldo disponível (${formatarNumero(produtoMov.saldo)} ${unidadeDisplay(produtoMov.unidade)}).`
    return ''
  }, [formMov.tipoMov, formMov.quantidade, formMov.usarDosagem, quantidadeCalculada, formMov.editandoLotes, qtdFinalLotesEditados, produtoMov])

  function iniciarEdicaoLotes() {
    const qtd = formMov.usarDosagem && quantidadeCalculada !== null ? quantidadeCalculada : Number(formMov.quantidade) || 0
    const resumo = gerarResumoFIFO(lotesRestantes, qtd)
    setFormMov(f => ({
      ...f, editandoLotes: true,
      lotesEditados: resumo.map(l => ({ ...l, consumido: formatarNumero(l.consumido, 2) })),
    }))
  }

  function propExpandida(propId) {
    return propId in propriedadesExpandidas ? propriedadesExpandidas[propId] : true
  }
  function expandidoPorPadrao(key) {
    return key in gruposExpandidos ? gruposExpandidos[key] : true
  }
  function toggleGrupo(key) { setGruposExpandidos(g => ({ ...g, [key]: !expandidoPorPadrao(key) })) }
  function toggleProp(propId) { setPropriedadesExpandidas(p => ({ ...p, [propId]: !propExpandida(propId) })) }

  function abrirModalProduto(produto = null) {
    if (produto) {
      setEditandoProduto(produto.id)
      setFormProduto({ produto: produto.produto || '', tipo: produto.tipo || '', unidade: produto.unidade || 'l', propriedadeId: produto.propriedadeId || '', temEstoqueMinimo: produto.temEstoqueMinimo || false, estoqueMinimo: produto.estoqueMinimo ? String(produto.estoqueMinimo) : '', observacoes: produto.observacoes || '' })
    } else {
      setEditandoProduto(null)
      setFormProduto(PRODUTO_PADRAO)
    }
    setFabAberto(false); setModalProduto(true)
  }

  async function salvarProduto(e) {
    e.preventDefault()
    if (!formProduto.produto.trim()) return alert('Informe o nome do produto.')
    if (!formProduto.tipo) return alert('Selecione o tipo do insumo.')
    if (!formProduto.propriedadeId) return alert('Selecione a propriedade.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === formProduto.propriedadeId)
    const payload = { produto: formProduto.produto.trim(), tipo: formProduto.tipo, unidade: formProduto.unidade, propriedadeId: formProduto.propriedadeId, propriedadeNome: prop?.nome || '', temEstoqueMinimo: formProduto.temEstoqueMinimo, estoqueMinimo: formProduto.temEstoqueMinimo ? Number(formProduto.estoqueMinimo) : 0, observacoes: formProduto.observacoes || '', uid: usuario.uid }
    let novoProdutoId = editandoProduto
    if (editandoProduto) {
      await updateDoc(doc(db, 'insumos', editandoProduto), payload)
      const movsSnap = await getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', usuario.uid), where('produtoId', '==', editandoProduto)))
      await Promise.all(movsSnap.docs.map(d => updateDoc(doc(db, 'movimentacoesInsumos', d.id), { produtoNome: payload.produto })))
      const finSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('produtoId', '==', editandoProduto), where('origemEstoque', '==', true)))
      await Promise.all(finSnap.docs.map(async d => {
        const data = d.data()
        let novaDescricao = data.descricao
        if (data.tipo === 'despesa' && !data.origemTransferencia) novaDescricao = `Compra: ${payload.produto}`
        else if (data.tipo === 'receita' && data.tipoSaida === 'venda') novaDescricao = `Venda de excedente: ${payload.produto}`
        else if (data.origemTransferencia && data.tipo === 'receita') novaDescricao = data.descricao.replace(/Transferência saída: .+ →/, `Transferência saída: ${payload.produto} →`)
        else if (data.origemTransferencia && data.tipo === 'despesa') novaDescricao = data.descricao.replace(/Transferência entrada: .+ ←/, `Transferência entrada: ${payload.produto} ←`)
        if (novaDescricao !== data.descricao) await updateDoc(doc(db, 'financeiro', d.id), { descricao: novaDescricao })
      }))
    } else {
      const ref = await addDoc(collection(db, 'insumos'), { ...payload, criadoEm: new Date() })
      novoProdutoId = ref.id
    }
    setModalProduto(false); setEditandoProduto(null); setFormProduto(PRODUTO_PADRAO)
    await carregar(); setLoading(false)
    if (!editandoProduto) setModalSugerirEntrada({ produtoId: novoProdutoId, produtoNome: payload.produto })
  }

  function excluirProduto(id, nome) {
    setConfirmacao({ mensagem: `Deseja excluir o produto "${nome}"? Todas as movimentações vinculadas também serão excluídas.`, onConfirmar: async () => { const movsVinculadas = movimentacoes.filter(m => m.produtoId === id); await Promise.all(movsVinculadas.map(m => deleteDoc(doc(db, 'movimentacoesInsumos', m.id)))); await deleteDoc(doc(db, 'insumos', id)); await carregar() } })
  }

  function solicitarCancelamento(mov, prod) { setConfirmacaoCancelamento({ mov, prod }) }

  async function confirmarCancelamento() {
    const { mov } = confirmacaoCancelamento
    setConfirmacaoCancelamento(null); setLoading(true)
    await updateDoc(doc(db, 'movimentacoesInsumos', mov.id), { cancelado: true, canceladoEm: new Date() })
    if (mov.tipoSaida === 'transferencia' || mov.origemTransferencia) {
      const movDestSnap = await getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', usuario.uid), where('origemTransferencia', '==', true), where('dataMovimento', '==', mov.dataMovimento)))
      await Promise.all(movDestSnap.docs.filter(d => d.id !== mov.id).map(d => updateDoc(doc(db, 'movimentacoesInsumos', d.id), { cancelado: true, canceladoEm: new Date() })))
    }
    const finSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('movimentacaoId', '==', mov.id)))
    await Promise.all(finSnap.docs.map(d => updateDoc(doc(db, 'financeiro', d.id), { cancelado: true, canceladoEm: new Date() })))
    if (finSnap.empty) {
      const finFallSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('produtoId', '==', mov.produtoId), where('origemEstoque', '==', true)))
      const dataRef = mov.dataVencimentoPagamento || mov.dataMovimento
      await Promise.all(finFallSnap.docs.filter(d => d.data().vencimento === dataRef && !d.data().cancelado).map(d => updateDoc(doc(db, 'financeiro', d.id), { cancelado: true, canceladoEm: new Date() })))
    }
    await carregar(); setLoading(false)
  }

  // Marcar pagamento como pago (mov + financeiro)
  async function confirmarPagamento() {
    const { mov, dataPagamento } = confirmacaoPagamento
    setConfirmacaoPagamento(null); setLoading(true)
    await updateDoc(doc(db, 'movimentacoesInsumos', mov.id), { statusPagamento: 'pago', dataVencimentoPagamento: dataPagamento })
    const finSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('movimentacaoId', '==', mov.id)))
    await Promise.all(finSnap.docs.map(d => updateDoc(doc(db, 'financeiro', d.id), { status: 'pago', vencimento: dataPagamento })))
    if (finSnap.empty) {
      const finFallSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('produtoId', '==', mov.produtoId), where('origemEstoque', '==', true)))
      const dataRef = mov.dataVencimentoPagamento || mov.dataMovimento
      await Promise.all(finFallSnap.docs.filter(d => d.data().vencimento === dataRef && d.data().status === 'pendente').map(d => updateDoc(doc(db, 'financeiro', d.id), { status: 'pago', vencimento: dataPagamento })))
    }
    await carregar(); setLoading(false)
  }

  function abrirModalMov(produtoId, tipoMov = 'entrada') {
    const produto = produtosEnriquecidos.find(p => p.id === produtoId)
    const tiposSaida = produto ? getTiposSaidaDisponiveis(produto.tipo) : []
    setFormMov({ ...MOV_PADRAO, produtoId, tipoMov, tipoSaida: tiposSaida[0]?.value || 'aplicacao', dataMovimento: HOJE })
    setFabAberto(false); setModalMov(true)
  }
  function toggleLavoura(id) { setFormMov(f => ({ ...f, lavouraIds: f.lavouraIds.includes(id) ? f.lavouraIds.filter(x => x !== id) : [...f.lavouraIds, id] })) }

  async function salvarMov(e) {
    e.preventDefault()
    const qtdFinal = formMov.editandoLotes ? qtdFinalLotesEditados || 0
      : formMov.usarDosagem && quantidadeCalculada !== null ? quantidadeCalculada
      : Number(formMov.quantidade)
    if (!qtdFinal || isNaN(qtdFinal)) return alert('Informe a quantidade.')
    if (formMov.tipoMov === 'entrada' && !formMov.valorMask) return alert('Informe o valor total da compra.')
    if (errQtdExcedeSaldo) return
    if (formMov.tipoMov === 'saida' && !saidaSimples) {
      if (vinculos.safra === 'obrigatorio' && !formMov.safraId) return alert('Selecione a safra.')
      if (vinculos.lavoura === 'obrigatorio' && formMov.lavouraIds.length === 0) return alert('Selecione ao menos uma lavoura.')
      if (vinculos.patrimonio === 'obrigatorio' && !formMov.patrimonioId) return alert('Selecione o equipamento.')
    }
    if (formMov.tipoSaida === 'transferencia' && !formMov.propriedadeDestinoId) return alert('Selecione a propriedade de destino.')
    if (formMov.tipoSaida === 'venda' && !formMov.valorMask) return alert('Informe o valor da venda.')

    const produto = produtoMov
    const safra = safras.find(s => s.id === formMov.safraId)
    const prop = propriedades.find(p => p.id === produto?.propriedadeId)
    const patrimonio = patrimonios.find(p => p.id === formMov.patrimonioId)
    const valorTotal = (formMov.tipoMov === 'entrada' || formMov.tipoSaida === 'venda') ? Number(desmascarar(formMov.valorMask)) : 0
    setLoading(true)

    let lotesConsumidos = []
    if (formMov.tipoMov === 'saida') {
      if (formMov.editandoLotes && formMov.lotesEditados.length > 0) {
        lotesConsumidos = formMov.lotesEditados.filter(l => Number(l.consumido) > 0).map(l => ({ entradaId: l.entradaId, dataMovimento: l.dataMovimento, quantidade: Number(l.consumido), dataValidade: l.dataValidade || '' }))
      } else {
        lotesConsumidos = resumoFIFO.map(l => ({ entradaId: l.entradaId, dataMovimento: l.dataMovimento, quantidade: l.consumido, dataValidade: l.dataValidade || '' }))
      }
    }

    // ── Calcular custoCalculado para saídas de aplicação/consumo ──────────────
    // Armazena o custo real (R$) diretamente na movimentação para facilitar
    // o cálculo de custo de produção sem precisar reconstruir o FIFO depois.
    let custoCalculado = 0
    let custoUnitario  = 0
    if (formMov.tipoMov === 'saida' && (formMov.tipoSaida === 'aplicacao' || formMov.tipoSaida === 'consumo')) {
      // Buscar custo unitário de cada lote consumido via movimentações de entrada
      const entradasLocais = produto?.movs?.filter(m => m.tipoMov === 'entrada' && !m.cancelado) || []
      const cuPorEntrada = {}
      entradasLocais.forEach(e => {
        const qtd = Number(e.quantidade) || 0
        const val = Number(e.valorTotal) || 0
        if (qtd > 0 && val > 0) cuPorEntrada[e.id] = val / qtd
      })

      custoCalculado = lotesConsumidos.reduce((sum, lc) => {
        const cu = cuPorEntrada[lc.entradaId] || 0
        return sum + cu * (Number(lc.quantidade) || 0)
      }, 0)

      const qtdTotal = lotesConsumidos.reduce((s, lc) => s + (Number(lc.quantidade) || 0), 0)
      custoUnitario  = qtdTotal > 0 ? custoCalculado / qtdTotal : 0
    }

    const dosagemCalculada = (formMov.tipoMov === 'saida' && areaLavourasSelecionadas > 0) ? Number((qtdFinal / areaLavourasSelecionadas).toFixed(2)) : null
    const propDestino = formMov.tipoSaida === 'transferencia' ? propriedades.find(p => p.id === formMov.propriedadeDestinoId) : null

    // Observações: não incluir info de transferência (fica no título)
    const observacoesFinal = formMov.tipoSaida === 'transferencia' ? (formMov.observacoes || '') : (formMov.observacoes || '')

    const payloadBase = {
      produtoId: formMov.produtoId, produtoNome: produto?.produto || '', tipoProduto: produto?.tipo || '', unidade: produto?.unidade || '',
      tipoMov: formMov.tipoMov, tipoSaida: formMov.tipoMov === 'saida' ? formMov.tipoSaida : null,
      quantidade: qtdFinal, valorTotal: formMov.tipoMov === 'entrada' ? valorTotal : 0,
      // Custo calculado no momento da saída (via FIFO) — usado pelo hook de custo de produção
      custoCalculado: formMov.tipoMov === 'saida' ? custoCalculado : 0,
      custoUnitario:  formMov.tipoMov === 'saida' ? custoUnitario  : 0,
      dataMovimento: formMov.dataMovimento, propriedadeId: produto?.propriedadeId || '', propriedadeNome: prop?.nome || '',
      safraId: formMov.safraId || '', safraNome: safra?.nome || '',
      lavouraIds: formMov.lavouraIds, lavouraNomes: lavouras.filter(l => formMov.lavouraIds.includes(l.id)).map(l => l.nome),
      areaHa: areaLavourasSelecionadas || null, dosagem: dosagemCalculada,
      patrimonioId: formMov.patrimonioId || '', patrimonioNome: patrimonio?.nome || '',
      statusPagamento: formMov.statusPagamento || 'pendente',
      dataVencimentoPagamento: formMov.dataVencimentoPagamento || '',
      notaRef: formMov.notaRef || '',
      dataValidade: (formMov.tipoMov === 'entrada' && formMov.temValidade) ? formMov.dataValidade : '',
      lotesConsumidos,
      propriedadeDestinoId: formMov.tipoSaida === 'transferencia' ? formMov.propriedadeDestinoId : '',
      propriedadeDestinoNome: propDestino?.nome || '',
      observacoes: observacoesFinal,
      cancelado: false, uid: usuario.uid,
    }

    const movRef = await addDoc(collection(db, 'movimentacoesInsumos'), { ...payloadBase, criadoEm: new Date() })
    const movimentacaoId = movRef.id
    await updateDoc(doc(db, 'movimentacoesInsumos', movimentacaoId), { movimentacaoId })

    if (formMov.tipoMov === 'entrada') {
      const tipoConfig = getTipoInsumo(produto?.tipo)
      const dataVenc = formMov.dataVencimentoPagamento || formMov.dataMovimento
      await addDoc(collection(db, 'financeiro'), { descricao: `Compra: ${produto?.produto || 'Insumo'}`, tipo: 'despesa', categoria: tipoConfig?.categoriaFinanceiro || 'Insumos', tipoDespesa: tipoConfig?.tipoFinanceiro || 'Outros', valor: valorTotal, vencimento: dataVenc, status: formMov.statusPagamento === 'pago' ? 'pago' : 'pendente', notaRef: formMov.notaRef || '', propriedadeId: produto?.propriedadeId || '', propriedadeNome: prop?.nome || '', safraId: '', patrimonioId: '', origemEstoque: true, produtoId: formMov.produtoId, movimentacaoId, cancelado: false, uid: usuario.uid, criadoEm: new Date() })
    }
    if (formMov.tipoMov === 'saida' && formMov.tipoSaida === 'venda' && valorTotal > 0) {
      await addDoc(collection(db, 'financeiro'), { descricao: `Venda de excedente: ${produto?.produto || 'Insumo'}`, tipo: 'receita', categoria: '', tipoDespesa: '', valor: valorTotal, vencimento: formMov.dataMovimento, status: 'recebido', notaRef: formMov.notaRef || '', propriedadeId: produto?.propriedadeId || '', propriedadeNome: prop?.nome || '', safraId: '', patrimonioId: '', origemEstoque: true, produtoId: formMov.produtoId, movimentacaoId, cancelado: false, uid: usuario.uid, criadoEm: new Date() })
    }
    if (formMov.tipoMov === 'saida' && formMov.tipoSaida === 'transferencia') {
      const { custoTotal, lotesUsados } = calcularCustoTransferencia(produto.movs, qtdFinal)
      await addDoc(collection(db, 'financeiro'), { descricao: `Transferência saída: ${produto?.produto || 'Insumo'} → ${propDestino?.nome || ''}`, tipo: 'receita', categoria: 'Transferência Interna', tipoDespesa: '', valor: custoTotal, vencimento: formMov.dataMovimento, status: 'recebido', propriedadeId: produto?.propriedadeId || '', propriedadeNome: prop?.nome || '', safraId: '', patrimonioId: '', origemEstoque: true, origemTransferencia: true, produtoId: formMov.produtoId, movimentacaoId, cancelado: false, uid: usuario.uid, criadoEm: new Date() })
      const produtoDestino = produtos.find(p => p.produto === produto?.produto && p.tipo === produto?.tipo && p.propriedadeId === formMov.propriedadeDestinoId)
      let produtoDestinoId = produtoDestino?.id
      if (!produtoDestinoId) {
        const ref = await addDoc(collection(db, 'insumos'), { produto: produto?.produto || '', tipo: produto?.tipo || '', unidade: produto?.unidade || '', propriedadeId: formMov.propriedadeDestinoId, propriedadeNome: propDestino?.nome || '', temEstoqueMinimo: false, estoqueMinimo: 0, observacoes: '', uid: usuario.uid, criadoEm: new Date() })
        produtoDestinoId = ref.id
      }
      const dataValidadeTransf = lotesUsados.find(l => l.dataValidade)?.dataValidade || ''
      const movDestinoRef = await addDoc(collection(db, 'movimentacoesInsumos'), { produtoId: produtoDestinoId, produtoNome: produto?.produto || '', tipoProduto: produto?.tipo || '', unidade: produto?.unidade || '', tipoMov: 'entrada', tipoSaida: null, quantidade: qtdFinal, valorTotal: custoTotal, dataMovimento: formMov.dataMovimento, propriedadeId: formMov.propriedadeDestinoId, propriedadeNome: propDestino?.nome || '', safraId: '', safraNome: '', lavouraIds: [], lavouraNomes: [], areaHa: null, dosagem: null, patrimonioId: '', patrimonioNome: '', statusPagamento: 'pago', dataVencimentoPagamento: '', notaRef: '', dataValidade: dataValidadeTransf, observacoes: '', origemTransferencia: true, propriedadeOrigemId: produto?.propriedadeId || '', propriedadeOrigemNome: prop?.nome || '', movimentacaoOrigemId: movimentacaoId, lotesConsumidos: lotesUsados, cancelado: false, uid: usuario.uid, criadoEm: new Date() })
      await updateDoc(doc(db, 'movimentacoesInsumos', movDestinoRef.id), { movimentacaoId: movDestinoRef.id })
      await addDoc(collection(db, 'financeiro'), { descricao: `Transferência entrada: ${produto?.produto || 'Insumo'} ← ${prop?.nome || ''}`, tipo: 'despesa', categoria: getTipoInsumo(produto?.tipo)?.categoriaFinanceiro || 'Insumos', tipoDespesa: getTipoInsumo(produto?.tipo)?.tipoFinanceiro || 'Outros', valor: custoTotal, vencimento: formMov.dataMovimento, status: 'pago', propriedadeId: formMov.propriedadeDestinoId, propriedadeNome: propDestino?.nome || '', safraId: '', patrimonioId: '', origemEstoque: true, origemTransferencia: true, produtoId: produtoDestinoId, movimentacaoId: movDestinoRef.id, cancelado: false, uid: usuario.uid, criadoEm: new Date() })
    }

    setModalMov(false); setFormMov(MOV_PADRAO)
    await carregar(); setLoading(false)
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Estoque de Insumos</h1>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-estoque>
            <button type="button" onClick={() => setDropdownFiltroAberto(!dropdownFiltroAberto)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none min-w-[180px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">{filtroPropriedadeIds.length > 0 ? propriedades.filter(p => filtroPropriedadeIds.includes(p.id)).map(p => p.nome).join(', ') : 'Selecione a(s) Propriedade(s)'}</span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownFiltroAberto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] py-1 max-h-48 overflow-y-auto">
                {propriedades.map(p => { const sel = filtroPropriedadeIds.includes(p.id); return (
                  <button key={p.id} type="button" onClick={() => setFiltroPropriedadeIds(f => sel ? f.filter(id => id !== p.id) : [...f, p.id])} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50">
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>{sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}</span>
                    <span className={sel ? 'text-gray-800 font-medium' : 'text-gray-600'}>{p.nome}</span>
                  </button>
                )})}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 min-w-[180px]">
            <Search size={12} className="text-gray-400 flex-shrink-0" />
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar insumo..." className="text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400 w-full" />
            {busca && <button onClick={() => setBusca('')} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>}
          </div>
          {filtroPropriedadeIds.length > 0 && <button onClick={() => setFiltroPropriedadeIds([])} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>}
        </div>
      </div>

      {/* ── Dashboards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* Alertas */}
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 font-medium">Alertas</p>
            <p className="text-xs text-gray-300">toque p/ filtrar</p>
          </div>
          <div className="flex-1 flex items-center gap-2">
            <button type="button"
              onClick={() => setFiltroAlerta(f => f === 'validade' ? null : 'validade')}
              title="Produtos com validade próxima ou vencida"
              className={`flex-1 h-full flex items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-semibold transition-colors border ${
                filtroAlerta === 'validade' ? 'bg-red-100 text-red-700 border-red-300'
                  : dashboards.comValidadeAlerta > 0 ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100'
                  : 'bg-gray-50 text-gray-300 border-gray-100'
              }`}>
              <Clock size={15} /><span>{dashboards.comValidadeAlerta}</span>
            </button>
            <button type="button"
              onClick={() => setFiltroAlerta(f => f === 'minimo' ? null : 'minimo')}
              title="Produtos abaixo do estoque mínimo"
              className={`flex-1 h-full flex items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-semibold transition-colors border ${
                filtroAlerta === 'minimo' ? 'bg-orange-100 text-orange-700 border-orange-300'
                  : dashboards.comMinimoAlerta > 0 ? 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100'
                  : 'bg-gray-50 text-gray-300 border-gray-100'
              }`}>
              <TrendingDown size={15} /><span>{dashboards.comMinimoAlerta}</span>
            </button>
          </div>
        </div>

        {/* Valor em estoque */}
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500">Valor estimado em estoque</p>
          <p className="text-xl font-bold text-green-700 mt-0.5">R$ {formatarMoeda(dashboards.valorTotalEstoque)}</p>
          <p className="text-xs text-gray-400">custo médio × saldo</p>
        </div>

        {/* Pgtos. pendentes — abre modal */}
        <div className={`bg-white rounded-xl p-3 shadow-sm border cursor-pointer transition-colors ${dashboards.pendQtd > 0 ? 'border-yellow-200 hover:border-yellow-300' : 'border-gray-100'}`}
          onClick={() => dashboards.pendQtd > 0 && setModalPagamentos(true)}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Pgtos. pendentes</p>
            {dashboards.pendQtd > 0 && <p className="text-xs text-gray-300">toque p/ detalhes</p>}
          </div>
          <p className={`text-xl font-bold mt-0.5 ${dashboards.pendValor > 0 ? 'text-yellow-600' : 'text-gray-300'}`}>R$ {formatarMoeda(dashboards.pendValor)}</p>
          <p className={`text-xs mt-0.5 ${dashboards.pendQtd > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{dashboards.pendQtd} pagamento{dashboards.pendQtd !== 1 ? 's' : ''}</p>
        </div>

        {/* Último registro */}
        <div className={`bg-white rounded-xl p-3 shadow-sm border border-gray-100 ${dashboards.produtoUltimaMov ? 'cursor-pointer hover:border-green-200 transition-colors' : ''}`}
          onClick={() => dashboards.produtoUltimaMov && setModalDetalhe(dashboards.produtoUltimaMov)}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Último registro</p>
            {dashboards.produtoUltimaMov && <p className="text-xs text-gray-300" title="Toque para ver detalhes">toque p/ detalhes</p>}
          </div>
          {dashboards.ultimaMov ? (
            <p className="text-sm font-bold text-gray-700 mt-2 truncate">
              <span className="truncate">{dashboards.ultimaMov.produtoNome}</span>
              <span className="text-xs font-normal text-gray-400 ml-1.5">· {formatarData(dashboards.ultimaMov.dataMovimento)}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-300 mt-1">—</p>
          )}
        </div>
      </div>

      {/* ── Lista vazia ── */}
      {agrupado.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <PackageOpen size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{busca ? `Nenhum insumo encontrado para "${busca}".` : filtroAlerta ? 'Nenhum insumo encontrado para o filtro selecionado.' : 'Nenhum insumo cadastrado.'}</p>
          {!busca && !filtroAlerta && <p className="text-xs mt-1 text-gray-300">Use o botão + para cadastrar o primeiro insumo.</p>}
        </div>
      )}

      {/* ── Grupos: Propriedade → Tipo → Produtos ── */}
      <div className="space-y-6">
        {agrupado.map(propGrupo => (
          <div key={propGrupo.propId}>
            {/* Cabeçalho de propriedade — colapsável */}
            <button type="button" onClick={() => toggleProp(propGrupo.propId)}
              className="w-full flex items-center gap-2 mb-3 group">
              <div className="h-px flex-1 bg-gray-200 group-hover:bg-gray-300 transition-colors" />
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide px-2 group-hover:text-gray-700 transition-colors">
                {propGrupo.propNome}
                {propExpandida(propGrupo.propId) ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </span>
              <div className="h-px flex-1 bg-gray-200 group-hover:bg-gray-300 transition-colors" />
            </button>

            {propExpandida(propGrupo.propId) && (
              <div className="space-y-3">
                {propGrupo.tipos.map(tipoGrupo => {
                  const chaveExpansao = `${propGrupo.propId}-${tipoGrupo.value}`
                  const expandido = expandidoPorPadrao(chaveExpansao)
                  return (
                    <div key={tipoGrupo.value} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <button type="button" onClick={() => toggleGrupo(chaveExpansao)}
                        className="w-full text-left transition-colors hover:brightness-95"
                        style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--brand-gradient)' }}>
                              <span style={{ fontSize: 13 }}>{tipoGrupo.icone}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-800 text-sm">{tipoGrupo.label}</p>
                              <p className="text-xs text-gray-400">{tipoGrupo.itens.length} produto{tipoGrupo.itens.length !== 1 ? 's' : ''} · R$ {formatarMoeda(tipoGrupo.valorEstoque)} em estoque</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {tipoGrupo.totalAlertas > 0 && (
                              <TooltipChip texto={tipoGrupo.tooltipTipo}>
                                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                                  <AlertTriangle size={11} />{tipoGrupo.totalAlertas}
                                </span>
                              </TooltipChip>
                            )}
                            {expandido ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                          </div>
                        </div>
                      </button>

                      {expandido && (
                        <div className="border-t border-gray-100 divide-y divide-gray-100">
                          {tipoGrupo.itens.map((produto, idx) => {
                            const bgZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'
                            return (
                              <div key={produto.id} className={`${bgZebra} px-4 py-3 hover:bg-blue-50/20 transition-colors`}>
                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="text-sm font-medium text-gray-800">{produto.produto}</p>
                                      {produto.validade?.tipo === 'vencido' && <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full border border-red-100">⚠️ Vencido</span>}
                                      {produto.validade?.tipo === 'alerta' && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full border border-amber-100">⏳ {produto.validade.label}</span>}
                                      {produto.abaixoMinimo && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full border border-orange-100">📉 Abaixo do mínimo</span>}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5">
                                      <p className="text-sm font-bold text-green-700">{formatarNumero(produto.saldo)} {unidadeDisplay(produto.unidade)}</p>
                                      {produto.custoMedio12m !== null
                                        ? <p className="text-xs text-gray-400">R$ {formatarMoeda(produto.custoMedio12m)}/{unidadeDisplay(produto.unidade)} (preço 12m)</p>
                                        : <p className="text-xs text-gray-300 italic">Sem entradas recentes</p>}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <button onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'entrada') }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}>
                                      <ArrowDownCircle size={13} />Entrada
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'saida') }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white shadow-sm hover:opacity-90">
                                      <ArrowUpCircle size={13} />Saída
                                    </button>
                                    <div className="flex items-center gap-0.5 ml-1">
                                      <button onClick={e => { e.stopPropagation(); setModalDetalhe(produto); setHistoricoExpandido(false) }} className="text-gray-300 hover:text-blue-500 p-1" title="Detalhes"><Info size={14} /></button>
                                      <button onClick={e => { e.stopPropagation(); abrirModalProduto(produto) }} className="text-gray-300 hover:text-blue-500 p-1" title="Editar"><Pencil size={14} /></button>
                                      <button onClick={e => { e.stopPropagation(); excluirProduto(produto.id, produto.produto) }} className="text-gray-300 hover:text-red-500 p-1" title="Excluir"><Trash2 size={14} /></button>
                                    </div>
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
            )}
          </div>
        ))}
      </div>

      {/* ── FAB ── */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Cadastrar insumo</span>
              <button onClick={() => abrirModalProduto()} className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}><Plus size={18} /></button>
            </div>
          </div>
        )}
        <button onClick={() => setFabAberto(!fabAberto)}
          className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${fabAberto ? 'rotate-45' : ''}`}
          style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}>
          <Plus size={24} />
        </button>
      </div>

      {/* ── Modal pagamentos pendentes ── */}
      {modalPagamentos && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-800">Pagamentos pendentes</h2>
                <p className="text-xs text-gray-400">{pagamentosPendentes.length} pagamento{pagamentosPendentes.length !== 1 ? 's' : ''} · R$ {formatarMoeda(dashboards.pendValor)}</p>
              </div>
              <button onClick={() => setModalPagamentos(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {pagamentosPendentes.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">Nenhum pagamento pendente.</p>
              )}
              {pagamentosPendentes.map((m, idx) => {
                const propNome = propriedades.find(p => p.id === m.propriedadeId)?.nome || m.propriedadeNome || '—'
                const vencimento = m.dataVencimentoPagamento || m.dataMovimento
                const vencStatus = vencimento && vencimento < HOJE ? 'vencido' : vencimento === HOJE ? 'hoje' : 'futuro'
                return (
                  <div key={idx} className={`rounded-xl border p-3 space-y-2 ${vencStatus === 'vencido' ? 'border-red-100 bg-red-50/30' : vencStatus === 'hoje' ? 'border-yellow-200 bg-yellow-50/30' : 'border-gray-100 bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{m.produtoNome}</p>
                        <p className="text-xs text-gray-500">{propNome}</p>
                        {m.notaRef && <p className="text-xs text-gray-400">Doc: {m.notaRef}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-800">R$ {formatarMoeda(m.valorTotal)}</p>
                        <p className={`text-xs font-medium ${vencStatus === 'vencido' ? 'text-red-600' : vencStatus === 'hoje' ? 'text-yellow-600' : 'text-gray-500'}`}>
                          {vencStatus === 'vencido' ? '⚠️ ' : ''}Venc. {formatarData(vencimento)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmacaoPagamento({ mov: m, dataPagamento: HOJE })}
                      className="w-full py-1.5 rounded-lg text-xs font-medium text-white shadow-sm hover:opacity-90"
                      style={{ background: 'linear-gradient(to right, #ef6464, #e31f1f)' }}>
                      Marcar como pago
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal confirmação de pagamento ── */}
      {confirmacaoPagamento && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar pagamento</h3>
            <p className="text-sm text-gray-600">
              Confirma o pagamento de <span className="font-semibold">R$ {formatarMoeda(confirmacaoPagamento.mov.valorTotal)}</span> referente a <span className="font-semibold">{confirmacaoPagamento.mov.produtoNome}</span>?
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data do pagamento</label>
              <input type="date" value={confirmacaoPagamento.dataPagamento}
                onChange={e => setConfirmacaoPagamento(c => ({ ...c, dataPagamento: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-xs text-gray-400 mt-1">A data será atualizada no lançamento Financeiro.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoPagamento(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarPagamento} disabled={loading} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md" style={{ background: 'var(--brand-gradient)' }}>
                {loading ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal sugerir entrada ── */}
      {modalSugerirEntrada && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><ArrowDownCircle size={20} className="text-green-600" /></div>
              <h3 className="font-bold text-gray-800">Insumo cadastrado!</h3>
            </div>
            <p className="text-sm text-gray-600"><span className="font-semibold">{modalSugerirEntrada.produtoNome}</span> foi cadastrado. Deseja registrar a entrada de estoque agora?</p>
            <div className="flex gap-3">
              <button onClick={() => setModalSugerirEntrada(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Agora não</button>
              <button onClick={() => { const id = modalSugerirEntrada.produtoId; setModalSugerirEntrada(null); abrirModalMov(id, 'entrada') }} className="flex-1 text-white py-2 rounded-xl text-sm font-medium shadow-md" style={{ background: 'var(--brand-gradient)' }}>Registrar entrada</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal cadastro/edição produto ── */}
      {modalProduto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editandoProduto ? 'Editar insumo' : 'Cadastrar insumo'}</h2>
              <button onClick={() => { setModalProduto(false); setEditandoProduto(null) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvarProduto} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Produto <span className="text-red-500">*</span></label>
                <input type="text" value={formProduto.produto} onChange={e => setFormProduto(f => ({ ...f, produto: e.target.value }))} placeholder="Ex: Roundup, Ureia 45%, Milho DKB 390..." className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo <span className="text-red-500">*</span></label>
                <select value={formProduto.tipo} onChange={e => setFormProduto(f => ({ ...f, tipo: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                  <option value="">Selecione o tipo...</option>
                  {TIPOS_INSUMOS.map(t => <option key={t.value} value={t.value}>{t.icone} {t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                  <select value={formProduto.unidade} onChange={e => setFormProduto(f => ({ ...f, unidade: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {UNIDADES_INSUMOS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade <span className="text-red-500">*</span></label>
                  <select value={formProduto.propriedadeId} onChange={e => setFormProduto(f => ({ ...f, propriedadeId: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                    <option value="">Selecione...</option>
                    {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer" onClick={() => setFormProduto(f => ({ ...f, temEstoqueMinimo: !f.temEstoqueMinimo, estoqueMinimo: '' }))}>
                  <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formProduto.temEstoqueMinimo ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formProduto.temEstoqueMinimo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <div><p className="text-sm font-medium text-gray-700">Definir alerta de estoque mínimo</p><p className="text-xs text-gray-400">Receba alertas quando o saldo estiver abaixo</p></div>
                </label>
                {formProduto.temEstoqueMinimo && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade mínima ({unidadeDisplay(formProduto.unidade)})</label>
                    <input type="number" min="0" step="0.01" value={formProduto.estoqueMinimo} onChange={e => setFormProduto(f => ({ ...f, estoqueMinimo: e.target.value }))} placeholder="0" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={formProduto.observacoes} onChange={e => setFormProduto(f => ({ ...f, observacoes: e.target.value }))} placeholder="Marca, fornecedor, dosagem recomendada, etc." rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setModalProduto(false); setEditandoProduto(null) }} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md" style={{ background: 'var(--brand-gradient)' }}>{loading ? 'Salvando...' : editandoProduto ? 'Atualizar' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal movimentação ── */}
      {modalMov && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {formMov.tipoMov === 'entrada' ? <ArrowDownCircle size={18} className="text-green-600" /> : <ArrowUpCircle size={18} className="text-amber-600" />}
                <h2 className="font-bold text-gray-800">{formMov.tipoMov === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}</h2>
              </div>
              <button onClick={() => setModalMov(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvarMov} className="p-5 space-y-4">
              {produtoMov && (
                <div className="bg-green-50 rounded-xl px-3 py-2 border border-green-100">
                  <p className="text-xs text-gray-500">Produto</p>
                  <p className="text-sm font-semibold text-gray-800">{produtoMov.produto}</p>
                  <p className="text-xs text-gray-500">Saldo: <span className="font-medium text-green-700">{formatarNumero(produtoMov.saldo)} {unidadeDisplay(produtoMov.unidade)}</span></p>
                </div>
              )}
              {formMov.tipoMov === 'saida' && tiposSaidaDisponiveis.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de saída</label>
                  <div className="grid grid-cols-2 gap-2">
                    {tiposSaidaDisponiveis.map(ts => (
                      <button key={ts.value} type="button"
                        onClick={() => setFormMov(f => ({ ...f, tipoSaida: ts.value, safraId: '', lavouraIds: [], patrimonioId: '', editandoLotes: false, lotesEditados: [] }))}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border-2 transition-colors ${formMov.tipoSaida === ts.value ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        <span>{ts.icone}</span>{ts.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data <span className="text-red-500">*</span></label>
                <input type="date" value={formMov.dataMovimento} onChange={e => setFormMov(f => ({ ...f, dataMovimento: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
              </div>

              {/* SAÍDA SIMPLES */}
              {formMov.tipoMov === 'saida' && saidaSimples && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade ({unidadeDisplay(produtoMov?.unidade || '')}) <span className="text-red-500">*</span></label>
                    <input type="number" min="0" step="0.01" value={formMov.quantidade} onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))} placeholder="0"
                      className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errQtdExcedeSaldo ? 'border-red-400' : 'border-gray-300'}`} required />
                    {errQtdExcedeSaldo && <p className="text-xs text-red-500 mt-1">{errQtdExcedeSaldo}</p>}
                  </div>
                  {resumoFIFO.length > 0 && (
                    <div className="bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                      <p className="text-xs font-medium text-blue-700 mb-1">Lotes consumidos (mais antigo primeiro):</p>
                      {resumoFIFO.map((l, i) => (
                        <p key={i} className="text-xs text-blue-600">• {l.dataMovimento ? formatarData(l.dataMovimento) : 'Sem data'}{l.notaRef ? ` · ${l.notaRef}` : ''}: {formatarNumero(l.consumido)} {unidadeDisplay(produtoMov?.unidade)}{l.dataValidade ? ` (val. ${formatarData(l.dataValidade)})` : ''}</p>
                      ))}
                    </div>
                  )}
                  {formMov.tipoSaida === 'transferencia' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade de destino <span className="text-red-500">*</span></label>
                      <select value={formMov.propriedadeDestinoId} onChange={e => setFormMov(f => ({ ...f, propriedadeDestinoId: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione...</option>
                        {propriedades.filter(p => p.id !== produtoMov?.propriedadeId).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">Custo proporcional ao volume será calculado automaticamente.</p>
                    </div>
                  )}
                  {formMov.tipoSaida === 'venda' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valor da venda <span className="text-red-500">*</span></label>
                      <input value={formMov.valorMask} onChange={e => setFormMov(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))} placeholder="R$ 0,00" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <p className="text-xs text-gray-400 mt-1">Uma receita será lançada automaticamente no Financeiro.</p>
                    </div>
                  )}
                </>
              )}

              {/* SAÍDA APLICAÇÃO/CONSUMO */}
              {formMov.tipoMov === 'saida' && !saidaSimples && (
                <>
                  {vinculos.safra !== 'oculto' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Safra{' '}{vinculos.safra === 'obrigatorio' ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal text-xs">(opcional)</span>}</label>
                      <select value={formMov.safraId} onChange={e => setFormMov(f => ({ ...f, safraId: e.target.value, lavouraIds: [] }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione a safra...</option>
                        {safras.filter(s => s.status === 'Em andamento').map(s => <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>)}
                      </select>
                    </div>
                  )}
                  {vinculos.lavoura !== 'oculto' && lavourasDaSafra.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Lavoura(s){' '}{vinculos.lavoura === 'obrigatorio' ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal text-xs">(opcional)</span>}</label>
                        {formMov.lavouraIds.length > 0 && <span className="text-xs text-gray-400">Área: <span className="font-medium text-gray-600">{formatarNumero(areaLavourasSelecionadas)} ha</span></span>}
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                        {lavourasDaSafra.map(l => (
                          <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={formMov.lavouraIds.includes(l.id)} onChange={() => toggleLavoura(l.id)} className="accent-green-600 w-4 h-4" />
                            <span className="text-gray-700">{l.nome}</span>
                            <span className="text-gray-400 text-xs">({formatarNumero(l.areaHa)} ha)</span>
                          </label>
                        ))}
                      </div>
                      {formMov.lavouraIds.length > 1 && <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1"><Info size={11} className="flex-shrink-0" />A quantidade será distribuída proporcionalmente à área. Para proporções diferentes, registre separadamente.</p>}
                    </div>
                  )}
                  {vinculos.lavoura !== 'oculto' && formMov.lavouraIds.length > 0 ? (
                    <div className="space-y-3">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <label className="flex items-center gap-3 cursor-pointer" onClick={() => setFormMov(f => ({ ...f, usarDosagem: !f.usarDosagem, quantidade: '', dosagem: '', editandoLotes: false, lotesEditados: [] }))}>
                          <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formMov.usarDosagem ? 'bg-green-600' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formMov.usarDosagem ? 'translate-x-4' : 'translate-x-0.5'}`} /></div>
                          <div><p className="text-sm font-medium text-gray-700">Informar por dosagem ({unidadeDisplay(produtoMov?.unidade)}/ha)</p><p className="text-xs text-gray-400">O sistema calcula o total pela área selecionada</p></div>
                        </label>
                      </div>
                      {formMov.usarDosagem ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Dosagem ({unidadeDisplay(produtoMov?.unidade)}/ha) <span className="text-red-500">*</span></label>
                          <input type="number" min="0" step="0.01" value={formMov.dosagem} onChange={e => setFormMov(f => ({ ...f, dosagem: e.target.value, editandoLotes: false, lotesEditados: [] }))} placeholder="0.00"
                            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errQtdExcedeSaldo ? 'border-red-400' : 'border-gray-300'}`} />
                          {quantidadeCalculada !== null && <p className="text-xs text-green-700 font-medium mt-1">Total a dar baixa: {formatarNumero(quantidadeCalculada)} {unidadeDisplay(produtoMov?.unidade)}</p>}
                          {errQtdExcedeSaldo && <p className="text-xs text-red-500 mt-1">{errQtdExcedeSaldo}</p>}
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade ({unidadeDisplay(produtoMov?.unidade || '')}) <span className="text-red-500">*</span></label>
                          <input type="number" min="0" step="0.01" value={formMov.quantidade} onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value, editandoLotes: false, lotesEditados: [] }))} placeholder="0"
                            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errQtdExcedeSaldo ? 'border-red-400' : 'border-gray-300'}`} />
                          {errQtdExcedeSaldo && <p className="text-xs text-red-500 mt-1">{errQtdExcedeSaldo}</p>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade ({unidadeDisplay(produtoMov?.unidade || '')}) <span className="text-red-500">*</span></label>
                      <input type="number" min="0" step="0.01" value={formMov.quantidade} onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value, editandoLotes: false, lotesEditados: [] }))} placeholder="0"
                        className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errQtdExcedeSaldo ? 'border-red-400' : 'border-gray-300'}`} />
                      {errQtdExcedeSaldo && <p className="text-xs text-red-500 mt-1">{errQtdExcedeSaldo}</p>}
                    </div>
                  )}
                  {vinculos.patrimonio !== 'oculto' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Equipamento{' '}{vinculos.patrimonio === 'obrigatorio' ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal text-xs">(opcional)</span>}</label>
                      <select value={formMov.patrimonioId} onChange={e => setFormMov(f => ({ ...f, patrimonioId: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione o equipamento...</option>
                        {patrimonios.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </div>
                  )}
                  {resumoFIFO.length > 0 && !formMov.editandoLotes && (
                    <div className="bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-blue-700">Lotes consumidos (mais antigo primeiro):</p>
                        <button type="button" onClick={iniciarEdicaoLotes} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"><Edit3 size={10} />editar</button>
                      </div>
                      {resumoFIFO.map((l, i) => (
                        <p key={i} className="text-xs text-blue-600">• {l.dataMovimento ? formatarData(l.dataMovimento) : 'Sem data'}{l.notaRef ? ` · ${l.notaRef}` : ''}: {formatarNumero(l.consumido)} {unidadeDisplay(produtoMov?.unidade)}{l.dataValidade ? ` (val. ${formatarData(l.dataValidade)})` : ''}</p>
                      ))}
                    </div>
                  )}
                  {formMov.editandoLotes && (
                    <div className="bg-blue-50 rounded-xl px-3 py-3 border border-blue-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-blue-700">Editar lotes a consumir:</p>
                        <button type="button" onClick={() => setFormMov(f => ({ ...f, editandoLotes: false, lotesEditados: [] }))} className="text-xs text-blue-500 hover:text-blue-700 underline">seleção automática</button>
                      </div>
                      {lotesRestantes.map((lote, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-blue-700">{lote.dataMovimento ? formatarData(lote.dataMovimento) : 'Sem data'}{lote.notaRef ? ` · ${lote.notaRef}` : ''}</p>
                            <p className="text-xs text-blue-500">disponível: {formatarNumero(lote.saldoLote)} {unidadeDisplay(produtoMov?.unidade)}{lote.dataValidade ? ` · val. ${formatarData(lote.dataValidade)}` : ''}</p>
                          </div>
                          <input type="number" min="0" step="0.01" value={formMov.lotesEditados[i]?.consumido || ''}
                            onChange={e => { const novos = lotesRestantes.map((l, j) => ({ ...l, consumido: j === i ? e.target.value : (formMov.lotesEditados[j]?.consumido || '') })); setFormMov(f => ({ ...f, lotesEditados: novos })) }}
                            placeholder="0" className="w-24 border border-blue-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 text-right" />
                        </div>
                      ))}
                      {qtdFinalLotesEditados !== null && (
                        <p className={`text-xs font-medium ${errQtdExcedeSaldo ? 'text-red-500' : 'text-blue-700'}`}>Total: {formatarNumero(qtdFinalLotesEditados)} {unidadeDisplay(produtoMov?.unidade)}{errQtdExcedeSaldo ? ' — ' + errQtdExcedeSaldo : ''}</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ENTRADA */}
              {formMov.tipoMov === 'entrada' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade ({unidadeDisplay(produtoMov?.unidade || '')}) <span className="text-red-500">*</span></label>
                    <input type="number" min="0" step="0.01" value={formMov.quantidade} onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))} placeholder="0" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valor total da compra <span className="text-red-500">*</span></label>
                    <input value={formMov.valorMask} onChange={e => setFormMov(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))} placeholder="R$ 0,00" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Situação do pagamento</label>
                    <div className="flex gap-2">
                      {[{ val: 'pendente', label: 'Pendente', cor: 'border-yellow-400 bg-yellow-50 text-yellow-700' }, { val: 'pago', label: 'Pago', cor: 'border-green-500 bg-green-50 text-green-700' }].map(op => (
                        <button key={op.val} type="button" onClick={() => setFormMov(f => ({ ...f, statusPagamento: op.val }))}
                          className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${formMov.statusPagamento === op.val ? op.cor : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>{op.label}</button>
                      ))}
                    </div>
                  </div>
                  {formMov.statusPagamento === 'pendente' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento do pagamento</label>
                      <input type="date" value={formMov.dataVencimentoPagamento} onChange={e => setFormMov(f => ({ ...f, dataVencimentoPagamento: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <p className="text-xs text-gray-400 mt-1">Uma despesa pendente será criada automaticamente no Financeiro.</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nº Doc. Referência</label>
                    <input value={formMov.notaRef} onChange={e => setFormMov(f => ({ ...f, notaRef: e.target.value }))} placeholder="Nota Fiscal, Boleto, etc." className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer" onClick={() => setFormMov(f => ({ ...f, temValidade: !f.temValidade, dataValidade: '' }))}>
                      <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formMov.temValidade ? 'bg-green-600' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formMov.temValidade ? 'translate-x-4' : 'translate-x-0.5'}`} /></div>
                      <div><p className="text-sm font-medium text-gray-700">Informar data de validade</p><p className="text-xs text-gray-400">Recomendado para defensivos e inoculantes</p></div>
                    </label>
                    {formMov.temValidade && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Data de validade deste lote</label>
                        <input type="date" value={formMov.dataValidade} onChange={e => setFormMov(f => ({ ...f, dataValidade: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={formMov.observacoes} onChange={e => setFormMov(f => ({ ...f, observacoes: e.target.value }))} placeholder={formMov.tipoMov === 'entrada' ? 'Fornecedor, lote, condições, etc.' : 'Detalhes da operação, etc.'} rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModalMov(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading || !!errQtdExcedeSaldo} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md" style={{ background: 'var(--brand-gradient)' }}>{loading ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal detalhes ── */}
      {modalDetalhe && (() => {
        const prod = modalDetalhe
        const pctMinimo = prod.temEstoqueMinimo && Number(prod.estoqueMinimo) > 0 ? Math.min(100, Math.round((prod.saldo / Number(prod.estoqueMinimo)) * 100)) : null
        const lotesAtivos = calcularLotesRestantes(prod.movs)
        const lotesAtivosIds = new Set(lotesAtivos.map(l => l.id))
        const entradasAtivas = prod.movs.filter(m => m.tipoMov === 'entrada' && !m.cancelado && lotesAtivosIds.has(m.id)).sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
        const entradasPassadas = prod.movs.filter(m => m.tipoMov === 'entrada' && (!lotesAtivosIds.has(m.id) || m.cancelado)).sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
        const saidasAvulsas = prod.movs.filter(m => m.tipoMov === 'saida' && !(m.lotesConsumidos?.length > 0)).sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))
        const saidasPorEntrada = {}
        prod.movs.filter(m => m.tipoMov === 'saida' && m.lotesConsumidos?.length > 0).forEach(saida => {
          saida.lotesConsumidos.forEach(lc => {
            if (!saidasPorEntrada[lc.entradaId]) saidasPorEntrada[lc.entradaId] = []
            saidasPorEntrada[lc.entradaId].push({ ...saida, qtdConsumida: lc.quantidade })
          })
        })

        function CardEntrada({ entrada, ativa }) {
          const saidas = saidasPorEntrada[entrada.id] || []
          const loteAtivo = lotesAtivos.find(l => l.id === entrada.id)
          const saldoLote = loteAtivo?.saldoLote || 0
          const valdItem = statusValidade(entrada.dataValidade)
          // Saídas abertas por padrão — estado controlado pelo pai para não resetar
          const saidasAbertas = !(saidasExpandidas[entrada.id] === false)
          const temSaidas = saidas.length > 0

          // Texto de identificação de transferência
          function tituloEntrada() {
            if (entrada.origemTransferencia) {
              const origemNome = entrada.propriedadeOrigemNome || ''
              return `Entrada (transferência)${origemNome ? ` · ← ${origemNome}` : ''}`
            }
            return 'Entrada'
          }

          return (
            <div className={`rounded-xl border overflow-hidden ${entrada.cancelado ? 'opacity-50' : ''} ${ativa ? 'border-green-100' : 'border-gray-100'}`}>
              {/* Header */}
              <div className={`flex items-start justify-between px-3 py-2 ${ativa ? 'bg-green-50' : 'bg-gray-50'}`}>
                <div className="flex items-start gap-2 min-w-0">
                  {entrada.cancelado ? <Ban size={13} className="text-gray-400 flex-shrink-0 mt-0.5" /> : <ArrowDownCircle size={13} className="text-green-600 flex-shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${entrada.cancelado ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                      {tituloEntrada()}{entrada.notaRef ? ` · ${entrada.notaRef}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{formatarData(entrada.dataMovimento)}</p>
                    {entrada.dataValidade && (
                      <p className={`text-xs ${valdItem?.tipo === 'vencido' ? 'text-red-500' : valdItem?.tipo === 'alerta' ? 'text-amber-500' : 'text-gray-400'}`}>
                        {formatarData(entrada.dataValidade)}
                        {valdItem && valdItem.tipo !== 'ok' ? <span className="ml-1 font-medium">{valdItem.label}</span> : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <div className="text-right">
                    <p className={`text-xs font-bold ${entrada.cancelado ? 'text-gray-400 line-through' : 'text-green-700'}`}>+{formatarNumero(entrada.quantidade)} {unidadeDisplay(prod.unidade)}</p>
                    {entrada.valorTotal > 0 && <p className="text-xs text-gray-400">R$ {formatarMoeda(entrada.valorTotal)}</p>}
                  </div>
                  {!entrada.cancelado && <button onClick={() => solicitarCancelamento(entrada, prod)} className="text-gray-300 hover:text-red-500 p-1 transition-colors" title="Cancelar"><Ban size={12} /></button>}
                </div>
              </div>

              {/* Saídas vinculadas — abertas por padrão, fecham apenas ao clicar */}
              {temSaidas && (
                <>
                  <button type="button" onClick={() => setSaidasExpandidas(s => ({ ...s, [entrada.id]: saidasAbertas ? false : true }))}
                    className="w-full flex items-center justify-between px-3 py-1 bg-white border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <span className="text-xs text-gray-400">{saidas.length} saída{saidas.length !== 1 ? 's' : ''} vinculada{saidas.length !== 1 ? 's' : ''}</span>
                    {saidasAbertas ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
                  </button>
                  {saidasAbertas && (
                    <div className="divide-y divide-gray-50">
                      {saidas.map((saida, si) => {
                        // Identificação de transferência na saída
                        function tituloSaida() {
                          if (saida.tipoSaida === 'transferencia') {
                            const destinoNome = saida.propriedadeDestinoNome || ''
                            return `Saída (transferência)${destinoNome ? ` · → ${destinoNome}` : ''}`
                          }
                          return getTipoSaida(saida.tipoSaida)?.label || 'Saída'
                        }
                        return (
                          <div key={si} className={`pl-7 pr-3 py-1.5 ${saida.cancelado ? 'opacity-50 bg-white' : 'bg-white'}`}>
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-1.5 min-w-0">
                                {saida.cancelado ? <Ban size={11} className="text-gray-300 flex-shrink-0 mt-0.5" /> : <ArrowUpCircle size={11} className="text-amber-500 flex-shrink-0 mt-0.5" />}
                                <div className="min-w-0">
                                  <p className={`text-xs ${saida.cancelado ? 'text-gray-300 line-through' : 'text-gray-600'}`}>
                                    {tituloSaida()}
                                    {saida.tipoSaida !== 'transferencia' && saida.safraNome ? ` · ${saida.safraNome}` : ''}
                                    {saida.tipoSaida !== 'transferencia' && saida.patrimonioNome ? ` · ${saida.patrimonioNome}` : ''}
                                  </p>
                                  <p className="text-xs text-gray-400">{formatarData(saida.dataMovimento)}</p>
                                  {/* Detalhes expansíveis — chave estável para não resetar */}
                                  {saidasExpandidas[`det_${saida.id || si}`] && (
                                    <div className="mt-1 space-y-0.5">
                                      {saida.lavouraNomes?.length > 0 && <p className="text-xs text-gray-400">Lavouras: {saida.lavouraNomes.join(', ')}</p>}
                                      {saida.dosagem && saida.areaHa > 0 && <p className="text-xs text-gray-400">Dosagem: {formatarNumero(saida.dosagem, 2)} {unidadeDisplay(prod.unidade)}/ha</p>}
                                      {saida.observacoes && <p className="text-xs text-gray-400">Obs.: {saida.observacoes}</p>}
                                    </div>
                                  )}
                                  {(saida.lavouraNomes?.length > 0 || saida.dosagem || saida.observacoes) && (
                                    <button type="button"
                                      onClick={() => setSaidasExpandidas(s => ({ ...s, [`det_${saida.id || si}`]: !s[`det_${saida.id || si}`] }))}
                                      className="text-xs text-gray-400 underline hover:text-gray-600 mt-0.5">
                                      {saidasExpandidas[`det_${saida.id || si}`] ? 'ocultar detalhes' : 'ver detalhes'}
                                    </button>
                                  )}
                                                              
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                <p className={`text-xs font-semibold ${saida.cancelado ? 'text-gray-300 line-through' : 'text-amber-600'}`}>-{formatarNumero(saida.qtdConsumida)} {unidadeDisplay(prod.unidade)}</p>
                                {!saida.cancelado && <button onClick={() => solicitarCancelamento(saida, prod)} className="text-gray-200 hover:text-red-500 p-0.5 transition-colors" title="Cancelar"><Ban size={11} /></button>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Rodapé com saldo do lote */}
              {ativa && !entrada.cancelado && (
                <div className={`px-3 py-1.5 border-t ${temSaidas ? 'border-gray-100' : 'border-green-100'} ${ativa ? 'bg-green-50/50' : 'bg-gray-50'} flex justify-end`}>
                  <p className="text-xs font-semibold text-green-700">
                    Saldo: {formatarNumero(saldoLote)} {unidadeDisplay(prod.unidade)}
                  </p>
                </div>
              )}
            </div>
          )
        }

        return (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto">
              <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">{prod.produto}</h2>
                  <p className="text-xs text-gray-400">{getTipoInsumo(prod.tipo)?.icone} {getTipoInsumo(prod.tipo)?.label} · {prod.propriedadeNome}</p>
                </div>
                <button onClick={() => setModalDetalhe(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-5">

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Situação Atual</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                      <p className="text-xs text-gray-500">Saldo em estoque</p>
                      <p className="text-lg font-bold text-green-700 mt-0.5">{formatarNumero(prod.saldo)}<span className="text-sm font-medium ml-1">{unidadeDisplay(prod.unidade)}</span></p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">Preço médio (12m)</p>
                      {prod.custoMedio12m !== null
                        ? <p className="text-lg font-bold text-gray-700 mt-0.5">R$ {formatarMoeda(prod.custoMedio12m)}<span className="text-xs font-normal text-gray-400 ml-1">/{unidadeDisplay(prod.unidade)}</span></p>
                        : <p className="text-sm text-gray-400 italic mt-1">Sem entradas recentes</p>}
                    </div>
                  </div>
                </div>

                {prod.temEstoqueMinimo && pctMinimo !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-600">Mínimo: {formatarNumero(prod.estoqueMinimo)} {unidadeDisplay(prod.unidade)}</p>
                      <p className={`text-xs font-semibold ${prod.abaixoMinimo ? 'text-orange-600' : 'text-green-600'}`}>{pctMinimo}% do mínimo</p>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${pctMinimo < 50 ? 'bg-orange-500' : pctMinimo < 100 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${Math.min(pctMinimo, 100)}%` }} />
                    </div>
                    {prod.abaixoMinimo && <p className="text-xs text-orange-600 mt-1">⚠️ Saldo abaixo do estoque mínimo</p>}
                  </div>
                )}

                {/* Validade do lote mais crítico — data + texto na mesma linha */}
                {prod.validade && (
                  <div className={`rounded-xl p-3 border ${prod.validade.tipo === 'vencido' ? 'bg-red-50 border-red-100' : prod.validade.tipo === 'alerta' ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
                    <p className="text-xs text-gray-500 mb-0.5">Validade do lote mais crítico (em estoque)</p>
                    <p className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${prod.validade.tipo === 'vencido' ? 'text-red-600' : prod.validade.tipo === 'alerta' ? 'text-amber-600' : 'text-gray-700'}`}>
                        {formatarData(prod.validade.dataValidade || '')}
                      </span>
                      <span className={`text-xs ${prod.validade.tipo === 'vencido' ? 'text-red-500' : prod.validade.tipo === 'alerta' ? 'text-amber-500' : 'text-gray-400'}`}>
                        {prod.validade.label}
                      </span>
                    </p>
                  </div>
                )}

                {/* Histórico — card master */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Em Estoque</p>
                  {entradasAtivas.length === 0 && saidasAvulsas.filter(s => !s.cancelado).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Nenhum lote ativo em estoque.</p>
                  ) : (
                    <div className="space-y-2">
                      {entradasAtivas.map(entrada => <CardEntrada key={entrada.id} entrada={entrada} ativa={true} />)}
                      {saidasAvulsas.filter(s => !s.cancelado).map((m, idx) => (
                        <div key={idx} className="flex items-start justify-between px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
                          <div className="flex items-start gap-2 min-w-0">
                            <ArrowUpCircle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700">{getTipoSaida(m.tipoSaida)?.label || 'Saída'}{m.safraNome ? ` · ${m.safraNome}` : ''}</p>
                              <p className="text-xs text-gray-400">{formatarData(m.dataMovimento)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <p className="text-xs font-bold text-amber-700">-{formatarNumero(m.quantidade)} {unidadeDisplay(prod.unidade)}</p>
                            <button onClick={() => solicitarCancelamento(m, prod)} className="text-gray-300 hover:text-red-500 p-1" title="Cancelar"><Ban size={12} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(entradasPassadas.length > 0 || saidasAvulsas.filter(s => s.cancelado).length > 0) && (
                    <div className="mt-3">
                      <button type="button" onClick={() => setHistoricoExpandido(h => !h)}
                        className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-xl transition-colors">
                        <History size={12} />
                        {historicoExpandido ? 'Ocultar histórico completo' : `Ver histórico completo (${entradasPassadas.length + saidasAvulsas.filter(s => s.cancelado).length} registros)`}
                      </button>
                      {historicoExpandido && (
                        <div className="mt-2 space-y-2">
                          {entradasPassadas.map(entrada => <CardEntrada key={entrada.id} entrada={entrada} ativa={false} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

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

      {/* ── Modal cancelamento ── */}
      {confirmacaoCancelamento && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Cancelar lançamento</h3>
            <p className="text-sm text-gray-600">Deseja cancelar este lançamento de <span className="font-semibold">{confirmacaoCancelamento.mov.tipoMov === 'entrada' ? 'entrada' : 'saída'}</span> de <span className="font-semibold">{formatarNumero(confirmacaoCancelamento.mov.quantidade)} {confirmacaoCancelamento.prod.unidade}</span> em <span className="font-semibold">{formatarData(confirmacaoCancelamento.mov.dataMovimento)}</span>?</p>
            <p className="text-xs text-gray-400">O lançamento ficará visível no histórico completo como cancelado. Lançamentos financeiros vinculados também serão cancelados.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacaoCancelamento(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Voltar</button>
              <button onClick={confirmarCancelamento} className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">Cancelar lançamento</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal exclusão produto ── */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600">{confirmacao.mensagem}</p>
            <p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacao(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { confirmacao.onConfirmar(); setConfirmacao(null) }} className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}