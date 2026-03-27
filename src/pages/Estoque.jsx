import { useEffect, useState, useMemo } from 'react'
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
  Info, Search
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

// Status de validade: null | ok | alerta (≤30 dias) | vencido
function statusValidade(dataValidade) {
  if (!dataValidade) return null
  try {
    const dias = differenceInDays(parseISO(dataValidade), parseISO(HOJE))
    if (dias < 0) return { tipo: 'vencido', dias: Math.abs(dias), label: `Vencido há ${Math.abs(dias)}d` }
    if (dias <= 30) return { tipo: 'alerta', dias, label: `Vence em ${dias}d` }
    return { tipo: 'ok', dias, label: formatarData(dataValidade) }
  } catch { return null }
}

// Custo médio ponderado — apenas entradas dos últimos 12 meses
function calcularCustoMedio(movimentacoes) {
  const entradas = movimentacoes.filter(m =>
    m.tipoMov === 'entrada' && m.dataMovimento >= UM_ANO_ATRAS
  )
  const totalQtd = entradas.reduce((a, m) => a + (Number(m.quantidade) || 0), 0)
  const totalValor = entradas.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
  if (totalQtd === 0) return null // sem entradas recentes
  return totalValor / totalQtd
}

// Saldo atual (entradas - saídas)
function calcularSaldo(movimentacoes) {
  return movimentacoes.reduce((a, m) => {
    if (m.tipoMov === 'entrada') return a + (Number(m.quantidade) || 0)
    if (m.tipoMov === 'saida') return a - (Number(m.quantidade) || 0)
    return a
  }, 0)
}

// Validade mais crítica entre os lotes de um produto
function validadeMaisCritica(movimentacoes) {
  const lotes = movimentacoes
    .filter(m => m.tipoMov === 'entrada' && m.dataValidade)
    .map(m => statusValidade(m.dataValidade))
    .filter(Boolean)
  if (lotes.length === 0) return null
  const vencidos = lotes.filter(l => l.tipo === 'vencido')
  if (vencidos.length > 0) return vencidos.sort((a, b) => b.dias - a.dias)[0]
  const alertas = lotes.filter(l => l.tipo === 'alerta')
  if (alertas.length > 0) return alertas.sort((a, b) => a.dias - b.dias)[0]
  return lotes.sort((a, b) => a.dias - b.dias)[0]
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
  observacoes: '',
}

const MOV_PADRAO = {
  tipoMov: 'entrada',
  tipoSaida: 'aplicacao',
  produtoId: '',
  quantidade: '',
  // Entrada
  valorTotal: '',
  valorMask: '',
  statusPagamento: 'pendente',
  dataVencimentoPagamento: '',
  notaRef: '',
  temValidade: false,
  dataValidade: '',
  // Saída — lavouras múltiplas
  safraId: '',
  lavouraIds: [],        // múltiplas lavouras
  dosagem: '',           // unidade/ha — calculamos o total
  usarDosagem: false,    // toggle dosagem vs quantidade direta
  // Saída — patrimônio (combustível/lubrificante)
  patrimonioId: '',
  // Transferência
  propriedadeDestinoId: '',
  // Comum
  dataMovimento: HOJE,
  observacoes: '',
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
  // Modal pós-cadastro: sugerir entrada
  const [modalSugerirEntrada, setModalSugerirEntrada] = useState(null)

  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [busca, setBusca] = useState('')
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)

  // ── Carregar dados ──
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
    // Apenas Equipamentos Móveis não-implemento
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

  // ── Produtos enriquecidos com saldo/custo/validade ──
  const produtosEnriquecidos = useMemo(() => {
    return produtos.map(p => {
      const movs = movimentacoes.filter(m => m.produtoId === p.id)
      const saldo = calcularSaldo(movs)
      const custoMedio = calcularCustoMedio(movs)
      const validade = validadeMaisCritica(movs)
      const abaixoMinimo = p.temEstoqueMinimo && Number(p.estoqueMinimo) > 0 && saldo < Number(p.estoqueMinimo)
      return { ...p, saldo, custoMedio, validade, abaixoMinimo, movs }
    })
  }, [produtos, movimentacoes])

  // ── Agrupado: Propriedade → Tipo → Produtos ──
  const agrupado = useMemo(() => {
    let base = produtosEnriquecidos

    // Filtro de busca
    if (busca.trim()) {
      const t = busca.toLowerCase()
      base = base.filter(p => p.produto?.toLowerCase().includes(t))
    }

    // Agrupa por propriedadeId
    const porProp = {}
    base.forEach(p => {
      const propId = p.propriedadeId || ''
      const propNome = propriedades.find(x => x.id === propId)?.nome || 'Sem propriedade'
      if (!porProp[propId]) porProp[propId] = { propNome, tipos: {} }
      const tipo = p.tipo || 'outros'
      if (!porProp[propId].tipos[tipo]) porProp[propId].tipos[tipo] = []
      porProp[propId].tipos[tipo].push(p)
    })

    // Aplica filtro de propriedade
    let entradas = Object.entries(porProp)
    if (filtroPropriedadeIds.length > 0) {
      entradas = entradas.filter(([id]) => filtroPropriedadeIds.includes(id))
    }

    return entradas
      .sort((a, b) => a[1].propNome.localeCompare(b[1].propNome))
      .map(([propId, grupo]) => ({
        propId,
        propNome: grupo.propNome,
        tipos: TIPOS_INSUMOS
          .filter(t => grupo.tipos[t.value])
          .map(t => {
            const itens = grupo.tipos[t.value]
            const totalAlertas = itens.filter(p =>
              p.abaixoMinimo ||
              p.validade?.tipo === 'vencido' ||
              p.validade?.tipo === 'alerta'
            ).length
            const valorEstoque = itens.reduce((a, p) =>
              a + (p.saldo * (p.custoMedio || 0)), 0
            )
            return { ...t, itens, totalAlertas, valorEstoque }
          }),
      }))
  }, [produtosEnriquecidos, propriedades, filtroPropriedadeIds, busca])

  // ── Dashboards ──
  const dashboards = useMemo(() => {
    const totalAlertas = produtosEnriquecidos.filter(p =>
      p.abaixoMinimo || p.validade?.tipo === 'vencido' || p.validade?.tipo === 'alerta'
    ).length
    const valorTotalEstoque = produtosEnriquecidos.reduce((a, p) =>
      a + (p.saldo * (p.custoMedio || 0)), 0
    )
    const pendFinanceiro = movimentacoes
      .filter(m => m.tipoMov === 'entrada' && m.statusPagamento === 'pendente')
      .reduce((a, m) => a + (Number(m.valorTotal) || 0), 0)
    const ultimaMov = [...movimentacoes]
      .sort((a, b) => (b.dataMovimento || '').localeCompare(a.dataMovimento || ''))[0]
    return { totalAlertas, valorTotalEstoque, pendFinanceiro, ultimaMov }
  }, [produtosEnriquecidos, movimentacoes])

  // ── Lavouras da safra selecionada no form de movimentação ──
  const lavourasDaSafra = useMemo(() => {
    if (!formMov.safraId) return []
    const safra = safras.find(s => s.id === formMov.safraId)
    return lavouras.filter(l => safra?.lavouraIds?.includes(l.id))
  }, [formMov.safraId, safras, lavouras])

  // Área total das lavouras selecionadas na saída
  const areaLavourasSelecionadas = useMemo(() => {
    return lavouras
      .filter(l => formMov.lavouraIds.includes(l.id))
      .reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
  }, [formMov.lavouraIds, lavouras])

  // Quantidade calculada pela dosagem
  const quantidadeCalculada = useMemo(() => {
    if (!formMov.usarDosagem || !formMov.dosagem || areaLavourasSelecionadas === 0) return null
    return Number(formMov.dosagem) * areaLavourasSelecionadas
  }, [formMov.usarDosagem, formMov.dosagem, areaLavourasSelecionadas])

  const produtoMov = useMemo(
    () => produtosEnriquecidos.find(p => p.id === formMov.produtoId) || null,
    [produtosEnriquecidos, formMov.produtoId]
  )

  // ── Vínculos do tipo de produto selecionado ──
  const vinculos = useMemo(() => {
    if (!produtoMov) return { safra: 'opcional', lavoura: 'opcional', patrimonio: 'oculto' }
    return getVinculosInsumo(produtoMov.tipo)
  }, [produtoMov])

  // ── Tipos de saída disponíveis para o produto ──
  const tiposSaidaDisponiveis = useMemo(() => {
    if (!produtoMov) return []
    return getTiposSaidaDisponiveis(produtoMov.tipo)
  }, [produtoMov])

  // ── Expansão ──
  function expandidoPorPadrao(key) {
    if (key in gruposExpandidos) return gruposExpandidos[key]
    return true
  }
  function toggleGrupo(key) {
    setGruposExpandidos(g => ({ ...g, [key]: !expandidoPorPadrao(key) }))
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
        observacoes: produto.observacoes || '',
      })
    } else {
      setEditandoProduto(null)
      setFormProduto(PRODUTO_PADRAO)
    }
    setFabAberto(false)
    setModalProduto(true)
  }

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
      observacoes: formProduto.observacoes || '',
      uid: usuario.uid,
    }

    let novoProdutoId = editandoProduto
    if (editandoProduto) {
      await updateDoc(doc(db, 'insumos', editandoProduto), payload)
    } else {
      const ref = await addDoc(collection(db, 'insumos'), { ...payload, criadoEm: new Date() })
      novoProdutoId = ref.id
    }

    setModalProduto(false)
    setEditandoProduto(null)
    setFormProduto(PRODUTO_PADRAO)
    await carregar()
    setLoading(false)

    // Sugerir entrada imediatamente após novo cadastro
    if (!editandoProduto) {
      setModalSugerirEntrada({ produtoId: novoProdutoId, produtoNome: payload.produto })
    }
  }

  function excluirProduto(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir o produto "${nome}"? Todas as movimentações vinculadas também serão excluídas.`,
      onConfirmar: async () => {
        const movsVinculadas = movimentacoes.filter(m => m.produtoId === id)
        await Promise.all(movsVinculadas.map(m => deleteDoc(doc(db, 'movimentacoesInsumos', m.id))))
        await deleteDoc(doc(db, 'insumos', id))
        await carregar()
      },
    })
  }

  // ── Modal movimentação ──
  function abrirModalMov(produtoId, tipoMov = 'entrada') {
    const produto = produtosEnriquecidos.find(p => p.id === produtoId)
    const tiposSaida = produto ? getTiposSaidaDisponiveis(produto.tipo) : []
    setFormMov({
      ...MOV_PADRAO,
      produtoId,
      tipoMov,
      tipoSaida: tiposSaida[0]?.value || 'aplicacao',
      dataMovimento: HOJE,
    })
    setFabAberto(false)
    setModalMov(true)
  }

  // Toggle lavoura na saída (múltipla seleção)
  function toggleLavoura(id) {
    setFormMov(f => ({
      ...f,
      lavouraIds: f.lavouraIds.includes(id)
        ? f.lavouraIds.filter(x => x !== id)
        : [...f.lavouraIds, id],
    }))
  }

  async function salvarMov(e) {
    e.preventDefault()
    const tipoSaidaConfig = getTipoSaida(formMov.tipoSaida)

    // Validações
    const qtdFinal = formMov.usarDosagem && quantidadeCalculada !== null
      ? quantidadeCalculada
      : Number(formMov.quantidade)

    if (!qtdFinal || isNaN(qtdFinal)) return alert('Informe a quantidade.')
    if (formMov.tipoMov === 'entrada' && !formMov.valorMask) return alert('Informe o valor total da compra.')

    // Validações de vínculo obrigatório
    if (formMov.tipoMov === 'saida') {
      if (vinculos.safra === 'obrigatorio' && !formMov.safraId) return alert('Selecione a safra.')
      if (vinculos.lavoura === 'obrigatorio' && formMov.lavouraIds.length === 0) return alert('Selecione ao menos uma lavoura.')
      if (vinculos.patrimonio === 'obrigatorio' && !formMov.patrimonioId) return alert('Selecione o equipamento.')
      if (formMov.tipoSaida === 'transferencia' && !formMov.propriedadeDestinoId) return alert('Selecione a propriedade de destino.')
    }

    const produto = produtoMov
    const safra = safras.find(s => s.id === formMov.safraId)
    const prop = propriedades.find(p => p.id === produto?.propriedadeId)
    const patrimonio = patrimonios.find(p => p.id === formMov.patrimonioId)
    const valorTotal = formMov.tipoMov === 'entrada' ? Number(desmascarar(formMov.valorMask)) : 0

    setLoading(true)

    // Calcula dosagem para histórico
    const dosagemCalculada = (formMov.tipoMov === 'saida' && areaLavourasSelecionadas > 0)
      ? qtdFinal / areaLavourasSelecionadas
      : null

    const payloadBase = {
      produtoId: formMov.produtoId,
      produtoNome: produto?.produto || '',
      tipoProduto: produto?.tipo || '',
      unidade: produto?.unidade || '',
      tipoMov: formMov.tipoMov,
      tipoSaida: formMov.tipoMov === 'saida' ? formMov.tipoSaida : null,
      quantidade: qtdFinal,
      valorTotal,
      dataMovimento: formMov.dataMovimento,
      propriedadeId: produto?.propriedadeId || '',
      propriedadeNome: prop?.nome || '',
      // Saída
      safraId: formMov.safraId || '',
      safraNome: safra?.nome || '',
      lavouraIds: formMov.lavouraIds,
      lavouraNomes: lavouras.filter(l => formMov.lavouraIds.includes(l.id)).map(l => l.nome),
      areaHa: areaLavourasSelecionadas || null,
      dosagem: dosagemCalculada,
      patrimonioId: formMov.patrimonioId || '',
      patrimonioNome: patrimonio?.nome || '',
      // Entrada
      statusPagamento: formMov.statusPagamento || 'pendente',
      dataVencimentoPagamento: formMov.dataVencimentoPagamento || '',
      notaRef: formMov.notaRef || '',
      dataValidade: (formMov.tipoMov === 'entrada' && formMov.temValidade) ? formMov.dataValidade : '',
      observacoes: formMov.observacoes || '',
      uid: usuario.uid,
    }

    await addDoc(collection(db, 'movimentacoesInsumos'), { ...payloadBase, criadoEm: new Date() })

    // ── Lançamento automático no Financeiro para ENTRADA ──
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
        safraId: '',
        patrimonioId: '',
        origemEstoque: true,
        produtoId: formMov.produtoId,
        uid: usuario.uid,
        criadoEm: new Date(),
      })
    }

    // ── VENDA de excedente → gera receita no Financeiro ──
    if (formMov.tipoMov === 'saida' && formMov.tipoSaida === 'venda') {
      const valorVenda = Number(desmascarar(formMov.valorMask))
      if (valorVenda > 0) {
        await addDoc(collection(db, 'financeiro'), {
          descricao: `Venda de excedente: ${produto?.produto || 'Insumo'}`,
          tipo: 'receita',
          categoria: '',
          tipoDespesa: '',
          valor: valorVenda,
          vencimento: formMov.dataMovimento,
          status: 'recebido',
          notaRef: formMov.notaRef || '',
          propriedadeId: produto?.propriedadeId || '',
          propriedadeNome: prop?.nome || '',
          safraId: '',
          patrimonioId: '',
          origemEstoque: true,
          produtoId: formMov.produtoId,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
      }
    }

    // ── TRANSFERÊNCIA → cria entrada na propriedade destino ──
    if (formMov.tipoMov === 'saida' && formMov.tipoSaida === 'transferencia') {
      const propDestino = propriedades.find(p => p.id === formMov.propriedadeDestinoId)
      // Busca ou verifica se existe produto equivalente na propriedade destino
      const produtoDestino = produtos.find(p =>
        p.produto === produto?.produto &&
        p.tipo === produto?.tipo &&
        p.propriedadeId === formMov.propriedadeDestinoId
      )

      let produtoDestinoId = produtoDestino?.id
      // Se não existe o produto na propriedade destino, cria automaticamente
      if (!produtoDestinoId) {
        const ref = await addDoc(collection(db, 'insumos'), {
          produto: produto?.produto || '',
          tipo: produto?.tipo || '',
          unidade: produto?.unidade || '',
          propriedadeId: formMov.propriedadeDestinoId,
          propriedadeNome: propDestino?.nome || '',
          temEstoqueMinimo: false,
          estoqueMinimo: 0,
          observacoes: `Transferido de ${prop?.nome || 'outra propriedade'}`,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
        produtoDestinoId = ref.id
      }

      // Cria entrada na propriedade destino — custo médio herdado (valorTotal = 0, sem lançamento financeiro)
      await addDoc(collection(db, 'movimentacoesInsumos'), {
        produtoId: produtoDestinoId,
        produtoNome: produto?.produto || '',
        tipoProduto: produto?.tipo || '',
        unidade: produto?.unidade || '',
        tipoMov: 'entrada',
        tipoSaida: null,
        quantidade: qtdFinal,
        valorTotal: 0, // sem custo adicional — já foi contabilizado na origem
        dataMovimento: formMov.dataMovimento,
        propriedadeId: formMov.propriedadeDestinoId,
        propriedadeNome: propDestino?.nome || '',
        safraId: '', safraNome: '',
        lavouraIds: [], lavouraNomes: [],
        areaHa: null, dosagem: null,
        patrimonioId: '', patrimonioNome: '',
        statusPagamento: 'pago',
        dataVencimentoPagamento: '',
        notaRef: '',
        dataValidade: '',
        observacoes: `Transferência de ${prop?.nome || 'outra propriedade'}`,
        origemTransferencia: true,
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

      {/* ── Dashboards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`bg-white rounded-xl p-3 shadow-sm border ${dashboards.totalAlertas > 0 ? 'border-amber-200' : 'border-gray-100'}`}>
          <p className="text-xs text-gray-500">Alertas ativos</p>
          <p className={`text-xl font-bold mt-0.5 ${dashboards.totalAlertas > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
            {dashboards.totalAlertas}
          </p>
          <p className="text-xs text-gray-400">vencimento ou mínimo</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500">Valor em estoque</p>
          <p className="text-xl font-bold text-green-700 mt-0.5">
            R$ {formatarMoeda(dashboards.valorTotalEstoque)}
          </p>
          <p className="text-xs text-gray-400">custo médio 12m</p>
        </div>
        <div className={`bg-white rounded-xl p-3 shadow-sm border ${dashboards.pendFinanceiro > 0 ? 'border-yellow-200' : 'border-gray-100'}`}>
          <p className="text-xs text-gray-500">Pagamentos pendentes</p>
          <p className={`text-xl font-bold mt-0.5 ${dashboards.pendFinanceiro > 0 ? 'text-yellow-600' : 'text-gray-300'}`}>
            R$ {formatarMoeda(dashboards.pendFinanceiro)}
          </p>
          <p className="text-xs text-gray-400">compras a pagar</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500">Última movimentação</p>
          {dashboards.ultimaMov ? (
            <>
              <p className="text-sm font-bold text-gray-700 mt-0.5 truncate">{dashboards.ultimaMov.produtoNome}</p>
              <p className="text-xs text-gray-400">{formatarData(dashboards.ultimaMov.dataMovimento)}</p>
            </>
          ) : (
            <p className="text-sm text-gray-300 mt-0.5">—</p>
          )}
        </div>
      </div>

      {/* ── Filtros + busca ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">

          {/* Dropdown propriedade */}
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

          {/* Busca por produto */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 min-w-[180px]">
            <Search size={12} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar insumo..."
              className="text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400 w-full"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-gray-400 hover:text-gray-600">
                <X size={11} />
              </button>
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
          <p className="text-sm">{busca ? `Nenhum insumo encontrado para "${busca}".` : 'Nenhum insumo cadastrado.'}</p>
          <p className="text-xs mt-1 text-gray-300">Use o botão + para cadastrar o primeiro insumo.</p>
        </div>
      )}

      {/* ── Grupos: Propriedade → Tipo → Produtos ── */}
      <div className="space-y-6">
        {agrupado.map(propGrupo => (
          <div key={propGrupo.propId}>

            {/* Cabeçalho da propriedade */}
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide px-2">
                {propGrupo.propNome}
              </span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="space-y-3">
              {propGrupo.tipos.map(tipoGrupo => {
                const chaveExpansao = `${propGrupo.propId}-${tipoGrupo.value}`
                const expandido = expandidoPorPadrao(chaveExpansao)

                return (
                  <div key={tipoGrupo.value} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

                    {/* Cabeçalho do tipo */}
                    <button type="button"
                      onClick={() => toggleGrupo(chaveExpansao)}
                      className="w-full text-left transition-colors hover:brightness-95"
                      style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>

                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--brand-gradient)' }}>
                            <span style={{ fontSize: 13 }}>{tipoGrupo.icone}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 text-sm">{tipoGrupo.label}</p>
                            <p className="text-xs text-gray-400">
                              {tipoGrupo.itens.length} produto{tipoGrupo.itens.length !== 1 ? 's' : ''} ·{' '}
                              R$ {formatarMoeda(tipoGrupo.valorEstoque)} em estoque
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {tipoGrupo.totalAlertas > 0 && (
                            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                              <AlertTriangle size={11} />
                              {tipoGrupo.totalAlertas}
                            </span>
                          )}
                          {expandido
                            ? <ChevronUp size={15} className="text-gray-400" />
                            : <ChevronDown size={15} className="text-gray-400" />}
                        </div>
                      </div>
                    </button>

                    {/* Lista de produtos — zebra */}
                    {expandido && (
                      <div className="border-t border-gray-100">
                        {tipoGrupo.itens.map((produto, idx) => {
                          const bgZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
                          return (
                            <div key={produto.id}
                              className={`${bgZebra} px-4 py-3 hover:bg-blue-50/20 transition-colors`}>

                              {/* Linha principal */}
                              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">

                                {/* Col 1 — Nome + alertas */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm font-medium text-gray-800">{produto.produto}</p>
                                    {produto.validade?.tipo === 'vencido' && (
                                      <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full border border-red-100">⚠️ Vencido</span>
                                    )}
                                    {produto.validade?.tipo === 'alerta' && (
                                      <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full border border-amber-100">⏳ {produto.validade.label}</span>
                                    )}
                                    {produto.abaixoMinimo && (
                                      <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full border border-orange-100">📉 Abaixo do mínimo</span>
                                    )}
                                  </div>
                                  {/* Saldo + custo médio */}
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <p className="text-sm font-bold text-green-700">
                                      {formatarNumero(produto.saldo)} {produto.unidade}
                                    </p>
                                    {produto.custoMedio !== null ? (
                                      <p className="text-xs text-gray-400">
                                        R$ {formatarMoeda(produto.custoMedio)}/{produto.unidade} (12m)
                                      </p>
                                    ) : (
                                      <p className="text-xs text-gray-300 italic">Sem entradas recentes</p>
                                    )}
                                  </div>
                                </div>

                                {/* Col 2 — Botões de ação */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {/* Entrada */}
                                  <button
                                    onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'entrada') }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm hover:opacity-90 transition-opacity"
                                    style={{ background: 'var(--brand-gradient)' }}>
                                    <ArrowDownCircle size={13} />
                                    Entrada
                                  </button>
                                  {/* Saída */}
                                  <button
                                    onClick={e => { e.stopPropagation(); abrirModalMov(produto.id, 'saida') }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white shadow-sm hover:opacity-90 transition-opacity">
                                    <ArrowUpCircle size={13} />
                                    Saída
                                  </button>
                                  {/* Ações discretas */}
                                  <div className="flex items-center gap-0.5 ml-1">
                                    <button onClick={e => { e.stopPropagation(); setModalDetalhe(produto) }}
                                      className="text-gray-300 hover:text-blue-500 p-1 transition-colors" title="Detalhes">
                                      <Info size={14} />
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); abrirModalProduto(produto) }}
                                      className="text-gray-300 hover:text-blue-500 p-1 transition-colors" title="Editar">
                                      <Pencil size={14} />
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); excluirProduto(produto.id, produto.produto) }}
                                      className="text-gray-300 hover:text-red-500 p-1 transition-colors" title="Excluir">
                                      <Trash2 size={14} />
                                    </button>
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
          </div>
        ))}
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

      {/* ── Modal sugerir entrada após cadastro ── */}
      {modalSugerirEntrada && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <ArrowDownCircle size={20} className="text-green-600" />
              </div>
              <h3 className="font-bold text-gray-800">Insumo cadastrado!</h3>
            </div>
            <p className="text-sm text-gray-600">
              <span className="font-semibold">{modalSugerirEntrada.produtoNome}</span> foi cadastrado com sucesso.
              Deseja registrar a entrada de estoque agora?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModalSugerirEntrada(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Agora não
              </button>
              <button onClick={() => {
                const id = modalSugerirEntrada.produtoId
                setModalSugerirEntrada(null)
                abrirModalMov(id, 'entrada')
              }}
                className="flex-1 text-white py-2 rounded-xl text-sm font-medium shadow-md"
                style={{ background: 'var(--brand-gradient)' }}>
                Registrar entrada
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal cadastro/edição de produto ── */}
      {modalProduto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">

            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                {editandoProduto ? 'Editar insumo' : 'Cadastrar insumo'}
              </h2>
              <button onClick={() => { setModalProduto(false); setEditandoProduto(null) }}
                className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <form onSubmit={salvarProduto} className="p-5 space-y-4">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Produto <span className="text-red-500">*</span>
                </label>
                <input type="text" value={formProduto.produto}
                  onChange={e => setFormProduto(f => ({ ...f, produto: e.target.value }))}
                  placeholder="Ex: Roundup, Ureia 45%, Milho DKB 390..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

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

              {/* Estoque mínimo */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setFormProduto(f => ({ ...f, temEstoqueMinimo: !f.temEstoqueMinimo, estoqueMinimo: '' }))}>
                  <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formProduto.temEstoqueMinimo ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formProduto.temEstoqueMinimo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Definir alerta de estoque mínimo</p>
                    <p className="text-xs text-gray-400">Receba alertas quando o saldo estiver abaixo</p>
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

      {/* ── Modal movimentação ── */}
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

              {/* Produto — info */}
              {produtoMov && (
                <div className="bg-green-50 rounded-xl px-3 py-2 border border-green-100">
                  <p className="text-xs text-gray-500">Produto</p>
                  <p className="text-sm font-semibold text-gray-800">{produtoMov.produto}</p>
                  <p className="text-xs text-gray-500">
                    Saldo: <span className="font-medium text-green-700">
                      {formatarNumero(produtoMov.saldo)} {getLabelUnidadeInsumo(produtoMov.unidade)}
                    </span>
                  </p>
                </div>
              )}

              {/* Tipo de saída */}
              {formMov.tipoMov === 'saida' && tiposSaidaDisponiveis.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de saída</label>
                  <div className="grid grid-cols-2 gap-2">
                    {tiposSaidaDisponiveis.map(ts => (
                      <button key={ts.value} type="button"
                        onClick={() => setFormMov(f => ({ ...f, tipoSaida: ts.value }))}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border-2 transition-colors ${
                          formMov.tipoSaida === ts.value
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        <span>{ts.icone}</span>
                        {ts.label}
                      </button>
                    ))}
                  </div>
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

              {/* ── CAMPOS DE SAÍDA ── */}
              {formMov.tipoMov === 'saida' && (
                <>
                  {/* Vínculo: Safra */}
                  {vinculos.safra !== 'oculto' && formMov.tipoSaida !== 'transferencia' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Safra {vinculos.safra === 'obrigatorio' && <span className="text-red-500">*</span>}
                      </label>
                      <select value={formMov.safraId}
                        onChange={e => setFormMov(f => ({ ...f, safraId: e.target.value, lavouraIds: [] }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione a safra...</option>
                        {safras.filter(s => s.status === 'Em andamento').map(s => (
                          <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Vínculo: Lavouras (múltipla seleção + dosagem) */}
                  {vinculos.lavoura !== 'oculto' && formMov.tipoSaida !== 'transferencia' && lavourasDaSafra.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">
                          Lavoura(s) {vinculos.lavoura === 'obrigatorio' && <span className="text-red-500">*</span>}
                        </label>
                        {formMov.lavouraIds.length > 0 && (
                          <span className="text-xs text-gray-400">
                            Área: <span className="font-medium text-gray-600">{formatarNumero(areaLavourasSelecionadas)} ha</span>
                          </span>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                        {lavourasDaSafra.map(l => (
                          <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox"
                              checked={formMov.lavouraIds.includes(l.id)}
                              onChange={() => toggleLavoura(l.id)}
                              className="accent-green-600 w-4 h-4" />
                            <span className="text-gray-700">{l.nome}</span>
                            <span className="text-gray-400 text-xs">({formatarNumero(l.areaHa)} ha)</span>
                          </label>
                        ))}
                      </div>
                      {/* Rateio proporcional — nota informativa */}
                      {formMov.lavouraIds.length > 1 && (
                        <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                          <Info size={11} className="flex-shrink-0" />
                          A quantidade será distribuída proporcionalmente à área de cada lavoura.
                          Para proporções diferentes, registre separadamente.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Dosagem vs Quantidade direta */}
                  {vinculos.lavoura !== 'oculto' && formMov.lavouraIds.length > 0 && formMov.tipoSaida !== 'transferencia' && (
                    <div className="space-y-3">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <label className="flex items-center gap-3 cursor-pointer"
                          onClick={() => setFormMov(f => ({ ...f, usarDosagem: !f.usarDosagem, quantidade: '', dosagem: '' }))}>
                          <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formMov.usarDosagem ? 'bg-green-600' : 'bg-gray-300'}`}>
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formMov.usarDosagem ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-700">Informar por dosagem ({produtoMov?.unidade}/ha)</p>
                            <p className="text-xs text-gray-400">O sistema calcula o total pela área selecionada</p>
                          </div>
                        </label>
                      </div>

                      {formMov.usarDosagem ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Dosagem ({produtoMov?.unidade}/ha) <span className="text-red-500">*</span>
                          </label>
                          <input type="number" min="0" step="0.001" value={formMov.dosagem}
                            onChange={e => setFormMov(f => ({ ...f, dosagem: e.target.value }))}
                            placeholder="0"
                            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                          {quantidadeCalculada !== null && (
                            <p className="text-xs text-green-700 font-medium mt-1">
                              Total a dar baixa: {formatarNumero(quantidadeCalculada)} {produtoMov?.unidade}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Quantidade ({getLabelUnidadeInsumo(produtoMov?.unidade || '')}) <span className="text-red-500">*</span>
                          </label>
                          <input type="number" min="0" step="0.01" value={formMov.quantidade}
                            onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))}
                            placeholder="0"
                            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quantidade simples (sem lavoura — combustível/lubrificante/outros sem safra) */}
                  {(vinculos.lavoura === 'oculto' || lavourasDaSafra.length === 0 || formMov.tipoSaida === 'transferencia') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Quantidade ({getLabelUnidadeInsumo(produtoMov?.unidade || '')}) <span className="text-red-500">*</span>
                      </label>
                      <input type="number" min="0" step="0.01" value={formMov.quantidade}
                        onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))}
                        placeholder="0"
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  )}

                  {/* Vínculo: Patrimônio (combustível/lubrificante) */}
                  {vinculos.patrimonio !== 'oculto' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Equipamento {vinculos.patrimonio === 'obrigatorio' && <span className="text-red-500">*</span>}
                      </label>
                      <select value={formMov.patrimonioId}
                        onChange={e => setFormMov(f => ({ ...f, patrimonioId: e.target.value }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione o equipamento...</option>
                        {patrimonios.map(p => (
                          <option key={p.id} value={p.id}>{p.nome}</option>
                        ))}
                      </select>
                      {patrimonios.length === 0 && (
                        <p className="text-xs text-amber-600 mt-1">
                          Nenhum equipamento cadastrado em Patrimônio → Equipamentos Móveis (não implemento).
                        </p>
                      )}
                    </div>
                  )}

                  {/* Propriedade destino (transferência) */}
                  {formMov.tipoSaida === 'transferencia' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Propriedade de destino <span className="text-red-500">*</span>
                      </label>
                      <select value={formMov.propriedadeDestinoId}
                        onChange={e => setFormMov(f => ({ ...f, propriedadeDestinoId: e.target.value }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">Selecione...</option>
                        {propriedades
                          .filter(p => p.id !== produtoMov?.propriedadeId)
                          .map(p => (
                            <option key={p.id} value={p.id}>{p.nome}</option>
                          ))}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">
                        O insumo será automaticamente adicionado ao estoque da propriedade de destino sem impacto financeiro.
                      </p>
                    </div>
                  )}

                  {/* Valor de venda */}
                  {formMov.tipoSaida === 'venda' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Valor da venda <span className="text-red-500">*</span>
                      </label>
                      <input value={formMov.valorMask}
                        onChange={e => setFormMov(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))}
                        placeholder="R$ 0,00"
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <p className="text-xs text-gray-400 mt-1">
                        Uma receita será lançada automaticamente no Financeiro.
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* ── CAMPOS DE ENTRADA ── */}
              {formMov.tipoMov === 'entrada' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Quantidade ({getLabelUnidadeInsumo(produtoMov?.unidade || '')}) <span className="text-red-500">*</span>
                    </label>
                    <input type="number" min="0" step="0.01" value={formMov.quantidade}
                      onChange={e => setFormMov(f => ({ ...f, quantidade: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      required />
                  </div>

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

                  {formMov.statusPagamento === 'pendente' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento do pagamento</label>
                      <input type="date" value={formMov.dataVencimentoPagamento}
                        onChange={e => setFormMov(f => ({ ...f, dataVencimentoPagamento: e.target.value }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      <p className="text-xs text-gray-400 mt-1">
                        Uma despesa pendente será criada automaticamente no Financeiro.
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

                  {/* Data de validade — toggle */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer"
                      onClick={() => setFormMov(f => ({ ...f, temValidade: !f.temValidade, dataValidade: '' }))}>
                      <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${formMov.temValidade ? 'bg-green-600' : 'bg-gray-300'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formMov.temValidade ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Informar data de validade</p>
                        <p className="text-xs text-gray-400">Recomendado para defensivos e inoculantes</p>
                      </div>
                    </label>
                    {formMov.temValidade && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Data de validade deste lote</label>
                        <input type="date" value={formMov.dataValidade}
                          onChange={e => setFormMov(f => ({ ...f, dataValidade: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={formMov.observacoes}
                  onChange={e => setFormMov(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder={formMov.tipoMov === 'entrada' ? 'Fornecedor, lote, condições, etc.' : 'Detalhes da aplicação, etc.'}
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
                    <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                      <p className="text-xs text-gray-500">Saldo em estoque</p>
                      <p className="text-lg font-bold text-green-700 mt-0.5">
                        {formatarNumero(prod.saldo)}
                        <span className="text-sm font-medium ml-1">{getLabelUnidadeInsumo(prod.unidade)}</span>
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">Custo médio (12m)</p>
                      {prod.custoMedio !== null ? (
                        <p className="text-lg font-bold text-gray-700 mt-0.5">
                          R$ {formatarMoeda(prod.custoMedio)}
                          <span className="text-xs font-normal text-gray-400 ml-1">/{prod.unidade}</span>
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic mt-1">Sem entradas recentes</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barra estoque mínimo */}
                {prod.temEstoqueMinimo && pctMinimo !== null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-600">
                        Mínimo: {formatarNumero(prod.estoqueMinimo)} {getLabelUnidadeInsumo(prod.unidade)}
                      </p>
                      <p className={`text-xs font-semibold ${prod.abaixoMinimo ? 'text-orange-600' : 'text-green-600'}`}>
                        {pctMinimo}% do mínimo
                      </p>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${pctMinimo < 50 ? 'bg-orange-500' : pctMinimo < 100 ? 'bg-amber-400' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(pctMinimo, 100)}%` }}
                      />
                    </div>
                    {prod.abaixoMinimo && (
                      <p className="text-xs text-orange-600 mt-1">⚠️ Saldo abaixo do estoque mínimo</p>
                    )}
                  </div>
                )}

                {/* Validade do lote mais crítico */}
                {prod.validade && (
                  <div className={`rounded-xl p-3 border ${
                    prod.validade.tipo === 'vencido' ? 'bg-red-50 border-red-100' :
                    prod.validade.tipo === 'alerta' ? 'bg-amber-50 border-amber-100' :
                    'bg-gray-50 border-gray-100'
                  }`}>
                    <p className="text-xs text-gray-500">Validade do lote mais crítico</p>
                    <p className={`text-sm font-semibold mt-0.5 ${
                      prod.validade.tipo === 'vencido' ? 'text-red-600' :
                      prod.validade.tipo === 'alerta' ? 'text-amber-600' : 'text-gray-700'
                    }`}>
                      {prod.validade.label}
                    </p>
                  </div>
                )}

                {/* Histórico */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Histórico</p>
                  {movsOrdenadas.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Nenhuma movimentação registrada.</p>
                  ) : (
                    <div className="space-y-2">
                      {movsOrdenadas.map((m, idx) => (
                        <div key={m.id || idx}
                          className="flex items-start justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                          <div className="flex items-start gap-2 min-w-0">
                            {m.tipoMov === 'entrada'
                              ? <ArrowDownCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                              : <ArrowUpCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700">
                                {m.tipoMov === 'entrada'
                                  ? m.origemTransferencia ? 'Entrada (transferência)' : 'Entrada'
                                  : getTipoSaida(m.tipoSaida)?.label || 'Saída'}
                                {m.safraNome ? ` · ${m.safraNome}` : ''}
                                {m.lavouraNomes?.length > 0 ? ` · ${m.lavouraNomes.join(', ')}` : ''}
                                {m.patrimonioNome ? ` · ${m.patrimonioNome}` : ''}
                              </p>
                              <p className="text-xs text-gray-400">{formatarData(m.dataMovimento)}</p>
                              {/* Dosagem no histórico */}
                              {m.dosagem && m.areaHa > 0 && (
                                <p className="text-xs text-gray-400">
                                  {formatarNumero(m.dosagem, 3)} {getLabelUnidadeInsumo(prod.unidade)}/ha
                                </p>
                              )}
                              {m.dataValidade && (
                                <p className="text-xs text-gray-400">
                                  Validade: {formatarData(m.dataValidade)}
                                </p>
                              )}
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