import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  Plus, Trash2, TrendingUp, TrendingDown, Pencil, FileSpreadsheet,
  Sparkles, X, Upload, CheckCircle, Building2, Tractor, ShoppingCart,
  Sprout, Lock, ChevronDown, ChevronUp, Search, Info
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'

export const CONFIG_CATEGORIAS = {
  'Insumos': {
    tipos: ['Sementes / Mudas', 'Adubos', 'Fertilizantes', 'Defensivos', 'Fertilizantes', 'Outros'],
    bloqueada: true,
    mensagem: 'Lançamentos de insumos são gerados automaticamente ao registrar entradas na página Estoque de Insumos.',
    pagina: 'Estoque de Insumos',
  },
  'Receita Agrícola': {
    tipos: [],
    bloqueada: true,
    ehReceita: true,
    mensagem: 'Receitas agrícolas são geradas automaticamente ao registrar vendas na página Estoque de Produção.',
    pagina: 'Estoque de Produção',
  },
  'Depreciação': {
    tipos: [],
    bloqueada: true,
    mensagem: 'A depreciação é calculada automaticamente com base no cadastro de patrimônios e não é lançada manualmente.',
    pagina: 'Patrimônio',
  },
  'Máquinas e Equipamentos': {
    tipos: ['Combustível e Lubrificantes', 'Manutenção', 'Outros'],
    tiposBloqueados: {
      'Combustível e Lubrificantes': {
        mensagem: 'Registre a saída de combustível ou lubrificante na página Estoque de Insumos para gerar este lançamento automaticamente.',
        pagina: 'Estoque de Insumos',
      },
    },
    campos: { patrimonio: 'obrigatorio', propriedade: 'travada', safra: 'oculta' },
  },
  'Administrativo': {
    tipos: ['Pessoal', 'Contabilidade', 'Consultoria', 'Arrendamento', 'Financiamento', 'Outros'],
    campos: { propriedade: 'multipla', safra: 'oculta', patrimonio: 'oculto' },
  },
  'Cultivo': {
    tipos: ['Preparação do Solo', 'Plantio', 'Manejo e Tratos Agrícolas', 'Colheita', 'Pós-Colheita', 'Outros'],
    tiposBloqueados: {
      'Pós-Colheita': {
        mensagem: 'Custos de transferência e armazenagem são gerados automaticamente pela página Estoque de Produção.',
        pagina: 'Estoque de Produção',
      },
    },
    campos: { propriedade: 'obrigatoria', safra: 'opcional', patrimonio: 'oculto' },
  },
  'Investimentos': {
    tipos: ['Equipamentos Móveis', 'Equipamentos Fixos', 'Benfeitorias', 'Outros'],
    campos: { propriedade: 'obrigatoria', safra: 'oculta', patrimonio: 'opcional' },
  },
  'Receitas Diversas': {
    tipos: [],
    ehReceita: true,
    campos: { propriedade: 'obrigatoria', safra: 'opcional', patrimonio: 'oculto' },
  },
}

export const CATEGORIAS_DESPESA = Object.fromEntries(
  Object.entries(CONFIG_CATEGORIAS)
    .filter(([, v]) => !v.ehReceita)
    .map(([k, v]) => [k, v.tipos])
)

const ABAS = ['Lançamentos', 'Contas a Pagar', 'Contas a Receber', 'Fluxo de Caixa']
const ANO_ATUAL = new Date().getFullYear()
const MES_ATUAL = new Date().getMonth() + 1
const ANOS = Array.from({ length: 6 }, (_, i) => ANO_ATUAL - 2 + i)
const MESES = [
  { v: 1, l: 'Janeiro' }, { v: 2, l: 'Fevereiro' }, { v: 3, l: 'Março' },
  { v: 4, l: 'Abril' }, { v: 5, l: 'Maio' }, { v: 6, l: 'Junho' },
  { v: 7, l: 'Julho' }, { v: 8, l: 'Agosto' }, { v: 9, l: 'Setembro' },
  { v: 10, l: 'Outubro' }, { v: 11, l: 'Novembro' }, { v: 12, l: 'Dezembro' },
]

function formatarDataBR(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}
function nomeMes(chave) {
  if (!chave) return ''
  const [y, m] = chave.split('-')
  try { return format(new Date(Number(y), Number(m) - 1), 'MMMM yyyy', { locale: ptBR }) } catch { return chave }
}
function mascaraData(valor) {
  const nums = valor.replace(/\D/g, '').slice(0, 8)
  if (nums.length <= 2) return nums
  if (nums.length <= 4) return `${nums.slice(0, 2)}/${nums.slice(2)}`
  return `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4)}`
}
function dataParaISO(br) {
  if (!br || br.length < 10) return ''
  const [d, m, y] = br.split('/')
  if (!d || !m || !y) return ''
  return `${y}-${m}-${d}`
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
function saldoDoGrupo(itens) {
  return itens.reduce((acc, l) => acc + (l.tipo === 'receita' ? 1 : -1) * (Number(l.valor) || 0), 0)
}
function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function estaVencido(dataISO) {
  if (!dataISO) return false
  return new Date(dataISO + 'T00:00:00') < new Date(new Date().toDateString())
}
function adicionarMeses(dataISO, n) {
  if (!dataISO) return ''
  const d = new Date(dataISO + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().split('T')[0]
}

function filtrarPorPeriodo(lista, filtro) {
  const { tipo, ano, mes, dataInicio, dataFim, safraId, propriedadeIds } = filtro
  return lista.filter(l => {
    if (l.tipoDespesa === 'Depreciação') return false
    if (propriedadeIds?.length > 0 && !propriedadeIds.includes(l.propriedadeId)) return false
    const dataRef = l.vencimento
    if (tipo === 'safra') return safraId ? l.safraId === safraId : true
    if (!dataRef) return false
    const [y, m] = dataRef.split('-')
    if (tipo === 'anual') return y === String(ano)
    if (tipo === 'mensal') return y === String(ano) && m === String(mes).padStart(2, '0')
    if (tipo === 'personalizado') {
      if (dataInicio && dataRef < dataInicio) return false
      if (dataFim && dataRef > dataFim) return false
      return true
    }
    return true
  })
}

function agruparPorPropMes(lista) {
  const listaOrdenada = [...lista].sort((a, b) =>
    (b.vencimento || '').localeCompare(a.vencimento || '')
  )
  const grupos = {}
  listaOrdenada.forEach(l => {
    const propId = l.propriedadeId || ''
    const propNome = l.propriedadeNome || 'Sem propriedade'
    const chave = (l.vencimento || '').substring(0, 7)
    if (!grupos[propId]) grupos[propId] = { propNome, meses: {} }
    if (!grupos[propId].meses[chave]) grupos[propId].meses[chave] = []
    grupos[propId].meses[chave].push(l)
  })
  return Object.entries(grupos)
    .sort((a, b) => a[1].propNome.localeCompare(b[1].propNome))
    .map(([propId, grupo]) => ({
      propId,
      propNome: grupo.propNome,
      meses: Object.entries(grupo.meses)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([chave, itens]) => ({ chave, itens })),
    }))
}

function IconeCategoria({ categoria, tipo, size = 13 }) {
  if (tipo === 'receita') return <TrendingUp size={size} className="text-green-500" />
  switch (categoria) {
    case 'Administrativo':          return <Building2 size={size} className="text-blue-500" />
    case 'Máquinas e Equipamentos': return <Tractor size={size} className="text-red-500" />
    case 'Insumos':                 return <ShoppingCart size={size} className="text-red-500" />
    case 'Cultivo':                 return <Sprout size={size} className="text-green-600" />
    case 'Investimentos':           return <Sparkles size={size} className="text-purple-500" />
    default:                        return <TrendingDown size={size} className="text-red-500" />
  }
}

function PatrimonioSearchable({ value, onChange, patrimonios, obrigatorio = false }) {
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const selecionado = patrimonios.find(p => p.id === value)
  const filtrados = patrimonios.filter(p =>
    !busca || p.nome.toLowerCase().includes(busca.toLowerCase()) || p.categoria.toLowerCase().includes(busca.toLowerCase())
  )
  return (
    <div className="relative">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-green-500">
        <span className={selecionado ? 'text-gray-800' : 'text-gray-400'}>
          {selecionado ? `${selecionado.nome} — ${selecionado.categoria}` : `Selecione o patrimônio${obrigatorio ? ' *' : ''}...`}
        </span>
        <Search size={13} className="text-gray-400 flex-shrink-0" />
      </button>
      {aberto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl">
          <div className="p-2 border-b border-gray-100">
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar equipamento..." autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {!obrigatorio && (
              <button type="button" onMouseDown={() => { onChange(''); setBusca(''); setAberto(false) }}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50">Nenhum</button>
            )}
            {filtrados.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Nenhum resultado.</p>}
            {filtrados.map(p => (
              <button key={p.id} type="button"
                onMouseDown={() => { onChange(p.id); setBusca(''); setAberto(false) }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-green-50 ${p.id === value ? 'bg-green-50 font-medium text-green-700' : 'text-gray-700'}`}>
                {p.nome} <span className="text-xs text-gray-400">— {p.categoria}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewParcelas({ dataInicial, numParcelas, valorTotal }) {
  const valor = parseFloat(desmascarar(valorTotal)) || 0
  if (!dataInicial || numParcelas < 2 || !valor) return null
  const parcelas = Array.from({ length: Math.min(numParcelas, 60) }, (_, i) => ({
    num: i + 1, data: adicionarMeses(dataInicial, i), valor: valor / numParcelas,
  }))
  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
      <p className="text-xs font-semibold text-gray-500 mb-2">{numParcelas}x de R$ {formatarMoeda(valor / numParcelas)}</p>
      {parcelas.map(p => (
        <div key={p.num} className="flex justify-between text-xs text-gray-600">
          <span>Parcela {p.num}/{numParcelas}</span>
          <span>{formatarDataBR(p.data)}</span>
        </div>
      ))}
    </div>
  )
}

const FORM_PADRAO = {
  descricao: '', tipo: 'despesa', categoria: '', tipoDespesa: '',
  vencimentoMask: '', valorMask: '', notaRef: '',
  propriedadeId: '', propriedadeIds: [], tipoRateio: 'igualitario', percentuaisRateio: {},
  safraId: '', status: '', patrimonioId: '',
  parcelar: false, numParcelas: 2,
}

export default function Financeiro() {
  const { usuario } = useAuth()
  const [aba, setAba] = useState('Lançamentos')
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [patrimonios, setPatrimonios] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [modal, setModal] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [arquivoImport, setArquivoImport] = useState(null)
  const [previewImport, setPreviewImport] = useState([])
  const [modalDetalhe, setModalDetalhe] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [fabAberto, setFabAberto] = useState(false)
  const [dropdownAberto, setDropdownAberto] = useState(false)
  const fileRef = useRef(null)

  const [filtro, setFiltro] = useState({
    tipo: 'anual', ano: ANO_ATUAL, mes: MES_ATUAL,
    dataInicio: '', dataFim: '', safraId: '', propriedadeIds: [],
  })

  // ── Scroll lock: captura scrollY ANTES do setState (elimina race condition) ──
  const scrollLockRef = useRef(0)
  const lockAtivo = useRef(false)

  function abrirComScrollLock(abrirFn) {
    scrollLockRef.current = window.scrollY
    lockAtivo.current = true
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollLockRef.current}px`
    document.body.style.width = '100%'
    abrirFn()
  }

  function fecharComScrollUnlock(fecharFn) {
    lockAtivo.current = false
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    window.scrollTo(0, scrollLockRef.current)
    fecharFn()
  }

  // Guardião: só desfaz o lock se nenhum modal estiver aberto E o lock não foi recém ativado
  useEffect(() => {
    const algumAberto = modal || modalImport || !!modalDetalhe || !!confirmacao
    if (!algumAberto && !lockAtivo.current && document.body.style.position === 'fixed') {
      const savedY = Math.abs(parseInt(document.body.style.top || '0', 10))
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      if (savedY) window.scrollTo(0, savedY)
    }
  }, [modal, modalImport, modalDetalhe, confirmacao])

  async function carregar() {
    const uid = usuario.uid
    const q = (col) => query(collection(db, col), where('uid', '==', uid))
    const [finSnap, propSnap, safSnap, patSnap, lavSnap] = await Promise.all([
      getDocs(q('financeiro')), getDocs(q('propriedades')), getDocs(q('safras')),
      getDocs(q('patrimonios')), getDocs(q('lavouras')),
    ])
    // Filtrar cancelados localmente — compatível com docs sem o campo 'cancelado'
    setLista(finSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.cancelado))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPatrimonios(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-prop]') && !e.target.closest('[data-modal]')) setDropdownAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const areasPorPropriedade = useMemo(() => {
    const m = {}
    lavouras.forEach(l => { if (l.propriedadeId) m[l.propriedadeId] = (m[l.propriedadeId] || 0) + (Number(l.areaHa) || 0) })
    return m
  }, [lavouras])

  const safrasDoForm = useMemo(() => {
    if (!form.propriedadeId) return safras
    return safras.filter(s => s.propriedadeId === form.propriedadeId)
  }, [safras, form.propriedadeId])

  const configCategoria = useMemo(() => form.categoria ? CONFIG_CATEGORIAS[form.categoria] || null : null, [form.categoria])
  const tipoBloqueado = useMemo(() => {
    if (!form.categoria || !form.tipoDespesa) return null
    return CONFIG_CATEGORIAS[form.categoria]?.tiposBloqueados?.[form.tipoDespesa] || null
  }, [form.categoria, form.tipoDespesa])
  const categoriaBloqueada = useMemo(() => {
    if (!form.categoria) return null
    const cat = CONFIG_CATEGORIAS[form.categoria]
    return cat?.bloqueada ? cat : null
  }, [form.categoria])
  const propriedadesDoPatrimonio = useMemo(() => {
    if (!form.patrimonioId) return []
    const pat = patrimonios.find(p => p.id === form.patrimonioId)
    return (pat?.propriedadeIds || []).map(id => propriedades.find(p => p.id === id)).filter(Boolean)
  }, [form.patrimonioId, patrimonios, propriedades])

  function calcularPercentualRateioAdm(propId) {
    const ids = form.propriedadeIds
    if (ids.length === 0) return 0
    if (form.tipoRateio === 'igualitario') return 100 / ids.length
    if (form.tipoRateio === 'area') {
      const totalArea = ids.reduce((s, id) => s + (areasPorPropriedade[id] || 0), 0)
      return totalArea > 0 ? ((areasPorPropriedade[propId] || 0) / totalArea) * 100 : 0
    }
    return Number(form.percentuaisRateio[propId]) || 0
  }
  function totalPercentuaisAdm() {
    if (form.tipoRateio !== 'personalizado') return 100
    return form.propriedadeIds.reduce((s, id) => s + (Number(form.percentuaisRateio[id]) || 0), 0)
  }

  function abrirModal() {
    abrirComScrollLock(() => { setEditando(null); setForm(FORM_PADRAO); setFabAberto(false); setModal(true) })
  }

  function abrirEdicao(item) {
    abrirComScrollLock(() => {
      setEditando(item.id)
      setForm({
        descricao: item.descricao || '', tipo: item.tipo || 'despesa',
        categoria: item.categoria || '', tipoDespesa: item.tipoDespesa || '',
        vencimentoMask: item.vencimento ? formatarDataBR(item.vencimento) : '',
        valorMask: item.valor ? mascaraMoeda(String(Math.round(Number(item.valor) * 100))) : '',
        notaRef: item.notaRef || '', propriedadeId: item.propriedadeId || '',
        propriedadeIds: item.propriedadeIds || (item.propriedadeId ? [item.propriedadeId] : []),
        tipoRateio: item.tipoRateio || 'igualitario', percentuaisRateio: item.percentuaisRateio || {},
        safraId: item.safraId || '', status: item.status || '',
        patrimonioId: item.patrimonioId || '', parcelar: false, numParcelas: 2,
      })
      setModal(true)
    })
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.status) return alert('Selecione a situação do lançamento.')
    if (form.tipo === 'despesa') {
      if (form.categoria === 'Administrativo' && form.propriedadeIds.length === 0) return alert('Selecione ao menos uma propriedade.')
      if (form.categoria === 'Administrativo' && form.tipoRateio === 'personalizado' && Math.abs(totalPercentuaisAdm() - 100) > 0.01) return alert('Os percentuais de rateio devem somar 100%.')
      if (form.categoria === 'Máquinas e Equipamentos' && !form.patrimonioId) return alert('Selecione o patrimônio vinculado.')
    }
    if (categoriaBloqueada || tipoBloqueado || (form.tipo === 'receita' && form.categoria === 'Receita Agrícola')) { setLoading(false); return }

    setLoading(true)
    const valorTotal = parseFloat(desmascarar(form.valorMask)) || 0
    const dataVenc = dataParaISO(form.vencimentoMask)
    const payloadBase = {
      descricao: form.descricao, tipo: form.tipo,
      categoria: form.tipo === 'receita' ? (form.categoria || 'Receitas Diversas') : form.categoria,
      tipoDespesa: form.tipoDespesa || '', vencimento: dataVenc,
      notaRef: form.notaRef, status: form.status, uid: usuario.uid,
    }

    if (form.tipo === 'despesa' && form.categoria === 'Administrativo') {
      const ids = form.propriedadeIds
      const parcelas = form.parcelar ? form.numParcelas : 1
      const documentos = []
      for (const propId of ids) {
        const prop = propriedades.find(p => p.id === propId)
        const pct = calcularPercentualRateioAdm(propId) / 100
        const valorProp = valorTotal * pct
        for (let i = 0; i < parcelas; i++) {
          documentos.push({ ...payloadBase, valor: parcelas > 1 ? valorProp / parcelas : valorProp,
            vencimento: adicionarMeses(dataVenc, i), propriedadeId: propId, propriedadeNome: prop?.nome || '',
            safraId: '', safraNome: '', patrimonioId: '', patrimonioNome: '',
            propriedadeIds: ids, tipoRateio: form.tipoRateio,
            percentuaisRateio: form.tipoRateio === 'personalizado' ? form.percentuaisRateio : {},
            ...(parcelas > 1 ? { parcelaNum: i + 1, parcelaTot: parcelas, parcelaGrupoId: `grp_${Date.now()}_${propId}` } : {}),
          })
        }
      }
      if (editando) await updateDoc(doc(db, 'financeiro', editando), documentos[0])
      else for (const d of documentos) await addDoc(collection(db, 'financeiro'), { ...d, criadoEm: new Date() })

    } else if (form.tipo === 'despesa' && form.categoria === 'Máquinas e Equipamentos') {
      const pat = patrimonios.find(p => p.id === form.patrimonioId)
      const propId = propriedadesDoPatrimonio[0]?.id || ''
      const propNome = propriedadesDoPatrimonio[0]?.nome || ''
      const parcelas = form.parcelar ? form.numParcelas : 1
      const parcelaGrupoId = `grp_${Date.now()}`
      for (let i = 0; i < parcelas; i++) {
        const payload = { ...payloadBase, valor: parcelas > 1 ? valorTotal / parcelas : valorTotal,
          vencimento: adicionarMeses(dataVenc, i), propriedadeId: propId, propriedadeNome: propNome,
          safraId: '', safraNome: '', patrimonioId: form.patrimonioId, patrimonioNome: pat?.nome || '',
          ...(parcelas > 1 ? { parcelaNum: i + 1, parcelaTot: parcelas, parcelaGrupoId } : {}),
        }
        if (editando && i === 0) await updateDoc(doc(db, 'financeiro', editando), payload)
        else await addDoc(collection(db, 'financeiro'), { ...payload, criadoEm: new Date() })
      }

    } else {
      const prop = propriedades.find(p => p.id === form.propriedadeId)
      const safra = safras.find(s => s.id === form.safraId)
      const parcelas = form.parcelar ? form.numParcelas : 1
      const parcelaGrupoId = `grp_${Date.now()}`
      for (let i = 0; i < parcelas; i++) {
        const payload = { ...payloadBase, valor: parcelas > 1 ? valorTotal / parcelas : valorTotal,
          vencimento: adicionarMeses(dataVenc, i), propriedadeId: form.propriedadeId,
          propriedadeNome: prop?.nome || '', safraId: form.safraId, safraNome: safra?.nome || '',
          patrimonioId: form.patrimonioId || '', patrimonioNome: '',
          ...(parcelas > 1 ? { parcelaNum: i + 1, parcelaTot: parcelas, parcelaGrupoId } : {}),
        }
        if (editando && i === 0) await updateDoc(doc(db, 'financeiro', editando), payload)
        else await addDoc(collection(db, 'financeiro'), { ...payload, criadoEm: new Date() })
      }
    }

    fecharComScrollUnlock(() => { setModal(false); setEditando(null) })
    setLoading(false)
    await carregar()
  }

  function excluir(id, descricao) {
    abrirComScrollLock(() => setConfirmacao({
      mensagem: `Deseja excluir o lançamento "${descricao}"?`,
      onConfirmar: async () => { await deleteDoc(doc(db, 'financeiro', id)); await carregar() }
    }))
  }

  async function marcarStatus(id, novoStatus) {
    await updateDoc(doc(db, 'financeiro', id), { status: novoStatus })
    await carregar()
  }

  function abrirImport() {
    abrirComScrollLock(() => { setArquivoImport(null); setPreviewImport([]); setFabAberto(false); setModalImport(true) })
  }

  function processarArquivo(file) {
    if (!file) return
    setArquivoImport(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        setPreviewImport(XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1).filter(r => r.length > 0).slice(0, 5))
      } catch { alert('Erro ao ler o arquivo. Verifique o formato.') }
    }
    reader.readAsBinaryString(file)
  }

  async function confirmarImport() {
    if (!arquivoImport) return
    setImportando(true)
    await new Promise(r => setTimeout(r, 1000))
    alert('Importação em desenvolvimento. Em breve disponível!')
    setImportando(false)
    fecharComScrollUnlock(() => setModalImport(false))
  }

  const [busca, setBusca] = useState('')
  const listaFiltrada = useMemo(() => {
    const base = filtrarPorPeriodo(lista, filtro)
    if (!busca.trim()) return base
    const q = busca.toLowerCase()
    return base.filter(l =>
      l.descricao?.toLowerCase().includes(q) || l.categoria?.toLowerCase().includes(q) ||
      l.tipoDespesa?.toLowerCase().includes(q) || l.propriedadeNome?.toLowerCase().includes(q) ||
      l.safraNome?.toLowerCase().includes(q) || l.notaRef?.toLowerCase().includes(q)
    )
  }, [lista, filtro, busca])

  const lancamentos = listaFiltrada
  const contasPagar = useMemo(() => listaFiltrada.filter(l => l.tipo === 'despesa' && l.status === 'pendente'), [listaFiltrada])
  const contasReceber = useMemo(() => listaFiltrada.filter(l => l.tipo === 'receita' && l.status === 'pendente'), [listaFiltrada])
  const totalReceitas = useMemo(() => listaFiltrada.filter(l => l.tipo === 'receita').reduce((a, b) => a + (Number(b.valor) || 0), 0), [listaFiltrada])
  const totalDespesas = useMemo(() => listaFiltrada.filter(l => l.tipo === 'despesa').reduce((a, b) => a + (Number(b.valor) || 0), 0), [listaFiltrada])
  const saldo = totalReceitas - totalDespesas

  const dadosFluxo = useMemo(() => {
    const mapa = {}
    listaFiltrada.forEach(l => {
      if (!l.vencimento) return
      const mes = l.vencimento.substring(0, 7)
      if (!mapa[mes]) mapa[mes] = { mes, receitas: 0, despesas: 0 }
      if (l.tipo === 'receita') mapa[mes].receitas += Number(l.valor) || 0
      else mapa[mes].despesas += Number(l.valor) || 0
    })
    let acumulado = 0
    return Object.values(mapa).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => {
      acumulado += m.receitas - m.despesas
      const [y, mo] = m.mes.split('-')
      return { ...m, label: format(new Date(Number(y), Number(mo) - 1), 'MMM/yy', { locale: ptBR }), saldoAcumulado: acumulado, despesasNeg: -m.despesas }
    })
  }, [listaFiltrada])

  function GrupoMes({ chave, itens, renderCard }) {
    const saldoGrupo = saldoDoGrupo(itens)
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide capitalize">{nomeMes(chave)}</p>
          <p className={`text-xs font-semibold ${saldoGrupo >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {saldoGrupo >= 0 ? '+' : '-'}R$ {formatarMoeda(Math.abs(saldoGrupo))}
          </p>
        </div>
        <div className="space-y-1.5">{itens.map(item => renderCard(item))}</div>
      </div>
    )
  }

  // ── CardLancamento: todos os botões passam por abrirComScrollLock ──
  function CardLancamento({ l }) {
    const vencido = estaVencido(l.vencimento)
    const isPago  = l.status === 'pago' || l.status === 'recebido'
    const isAuto  = !!(l.origemEstoque || l.origemEstoqueProducao || l.origemTransferencia || l.origemPatrimonio)
    return (
      <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center ${l.tipo === 'receita' ? 'bg-green-100' : 'bg-red-100'}`}>
            <IconeCategoria categoria={l.categoria} tipo={l.tipo} size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-gray-800 truncate leading-tight">{l.descricao}</p>
              {l.parcelaTot > 1 && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full border border-blue-100 flex-shrink-0">{l.parcelaNum}/{l.parcelaTot}</span>}
              {isAuto && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full flex-shrink-0 hidden sm:inline">auto</span>}
            </div>
            <p className="text-xs font-bold text-gray-600 leading-tight sm:hidden">
              {formatarDataBR(l.vencimento)}{vencido && !isPago ? <span className="text-red-400 font-normal ml-1">· Vencido</span> : null}
            </p>
            <p className="text-xs leading-tight hidden sm:block">
              <span className="font-bold text-gray-600">{formatarDataBR(l.vencimento)}</span>
              {l.categoria ? <span className="text-gray-400"> · {l.categoria}</span> : null}
              {l.tipoDespesa ? <span className="text-gray-400"> · {l.tipoDespesa}</span> : null}
              {vencido && !isPago ? <span className="text-red-400 ml-1">· Vencido</span> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <p className={`text-sm font-bold whitespace-nowrap ${l.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}`}>
            {l.tipo === 'receita' ? '+' : '-'}R${formatarMoeda(l.valor)}
          </p>
          {isPago && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full hidden sm:inline">{l.status === 'recebido' ? 'Recebido' : 'Pago'}</span>}
          {isAuto
            ? <button onClick={() => abrirComScrollLock(() => setModalDetalhe(l))} className="text-gray-300 hover:text-blue-500 p-0.5" title="Detalhes"><Info size={12} /></button>
            : <button onClick={() => abrirEdicao(l)} className="text-gray-300 hover:text-blue-500 p-0.5" title="Editar"><Pencil size={12} /></button>
          }
          {!isAuto && <button onClick={() => excluir(l.id, l.descricao)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>}
        </div>
      </div>
    )
  }

  // ── CardConta: todos os botões passam por abrirComScrollLock ──
  function CardConta({ c, tipoAcao, onMarcarStatus }) {
    const vencido   = estaVencido(c.vencimento)
    const isAuto    = !!(c.origemEstoque || c.origemEstoqueProducao || c.origemTransferencia || c.origemPatrimonio)
    const labelBtn  = tipoAcao === 'receber' ? 'Recebido' : 'Pago'
    const novoStatus = tipoAcao === 'receber' ? 'recebido' : 'pago'
    const corBtn    = tipoAcao === 'receber' ? 'bg-green-700 hover:bg-green-800' : 'bg-red-600 hover:bg-red-700'
    return (
      <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center ${tipoAcao === 'receber' ? 'bg-green-100' : 'bg-red-100'}`}>
          <IconeCategoria categoria={c.categoria} tipo={c.tipo} size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-gray-800 truncate leading-tight">{c.descricao}</p>
            {c.parcelaTot > 1 && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full border border-blue-100 flex-shrink-0">{c.parcelaNum}/{c.parcelaTot}</span>}
          </div>
          <div className="sm:hidden">
            <p className={`text-xs font-bold leading-tight ${vencido ? 'text-red-400' : 'text-gray-600'}`}>{vencido ? 'Vencido' : 'Vence'} em {formatarDataBR(c.vencimento)}</p>
            <div className="flex items-center justify-between mt-1.5 gap-2">
              <p className="text-sm font-bold text-gray-700">R${formatarMoeda(c.valor)}</p>
              <button onClick={() => onMarcarStatus(c.id, novoStatus)} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors text-white font-medium ${corBtn}`}><CheckCircle size={12} />{labelBtn}</button>
            </div>
          </div>
          <p className="text-xs leading-tight hidden sm:block">
            <span className={`font-bold ${vencido ? 'text-red-400' : 'text-gray-600'}`}>{formatarDataBR(c.vencimento)}</span>
            {vencido ? <span className="text-red-400"> · Vencido</span> : null}
            {c.safraNome ? <span className="text-gray-400"> · {c.safraNome}</span> : null}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <p className="text-sm font-bold text-gray-700">R${formatarMoeda(c.valor)}</p>
          <button onClick={() => onMarcarStatus(c.id, novoStatus)} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors text-white font-medium ${corBtn}`}><CheckCircle size={12} />{labelBtn}</button>
        </div>
        <div className="flex flex-col gap-0.5">
          {isAuto
            ? <button onClick={() => abrirComScrollLock(() => setModalDetalhe(c))} className="text-gray-300 hover:text-blue-500 p-0.5"><Info size={12} /></button>
            : <button onClick={() => abrirEdicao(c)} className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={12} /></button>
          }
          {!isAuto && <button onClick={() => excluir(c.id, c.descricao)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>

      {/* Filtros */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <div className="hidden sm:flex flex-wrap items-center gap-2">
          <select value={filtro.tipo} onChange={e => setFiltro(f => ({ ...f, tipo: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
            <option value="anual">Anual</option><option value="mensal">Mensal</option><option value="safra">Por Safra</option><option value="personalizado">Personalizado</option>
          </select>
          {filtro.tipo === 'anual' && <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{ANOS.map(a => <option key={a}>{a}</option>)}</select>}
          {filtro.tipo === 'mensal' && (<><select value={filtro.mes} onChange={e => setFiltro(f => ({ ...f, mes: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select><select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{ANOS.map(a => <option key={a}>{a}</option>)}</select></>)}
          {filtro.tipo === 'safra' && <select value={filtro.safraId} onChange={e => setFiltro(f => ({ ...f, safraId: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"><option value="">Selecione...</option>{safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>}
          {filtro.tipo === 'personalizado' && (<><input type="date" value={filtro.dataInicio} onChange={e => setFiltro(f => ({ ...f, dataInicio: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" /><span className="text-xs text-gray-400">até</span><input type="date" value={filtro.dataFim} onChange={e => setFiltro(f => ({ ...f, dataFim: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" /></>)}
          <div className="relative" data-dropdown-prop>
            <button type="button" onClick={() => setDropdownAberto(a => !a)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">{filtro.propriedadeIds?.length > 0 ? propriedades.filter(p => filtro.propriedadeIds.includes(p.id)).map(p => p.nome).join(', ') : 'Todas as propriedades'}</span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownAberto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[160px] py-1 max-h-48 overflow-y-auto">
                {propriedades.map(p => { const sel = filtro.propriedadeIds?.includes(p.id); return (
                  <button key={p.id} type="button" onClick={() => setFiltro(f => ({ ...f, propriedadeIds: sel ? f.propriedadeIds.filter(id => id !== p.id) : [...(f.propriedadeIds||[]), p.id] }))} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50">
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>{sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}</span>
                    {p.nome}
                  </button>
                )})}
              </div>
            )}
          </div>
          {filtro.propriedadeIds?.length > 0 && <button onClick={() => setFiltro(f => ({ ...f, propriedadeIds: [] }))} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar descrição, categoria..." className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
            {busca && <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={11} /></button>}
          </div>
        </div>
        <div className="flex sm:hidden flex-wrap items-center gap-2">
          <select value={filtro.tipo} onChange={e => setFiltro(f => ({ ...f, tipo: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
            <option value="anual">Anual</option><option value="mensal">Mensal</option><option value="safra">Por Safra</option><option value="personalizado">Personalizado</option>
          </select>
          {filtro.tipo === 'anual' && <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{ANOS.map(a => <option key={a}>{a}</option>)}</select>}
          {filtro.tipo === 'mensal' && (<><select value={filtro.mes} onChange={e => setFiltro(f => ({ ...f, mes: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select><select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">{ANOS.map(a => <option key={a}>{a}</option>)}</select></>)}
          {filtro.tipo === 'safra' && <select value={filtro.safraId} onChange={e => setFiltro(f => ({ ...f, safraId: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"><option value="">Selecione...</option>{safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>}
          {filtro.tipo === 'personalizado' && (<><input type="date" value={filtro.dataInicio} onChange={e => setFiltro(f => ({ ...f, dataInicio: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" /><span className="text-xs text-gray-400">até</span><input type="date" value={filtro.dataFim} onChange={e => setFiltro(f => ({ ...f, dataFim: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" /></>)}
          <select value={filtro.propriedadeIds?.[0] || ''} onChange={e => setFiltro(f => ({ ...f, propriedadeIds: e.target.value ? [e.target.value] : [] }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
            <option value="">Todas as propriedades</option>{propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <div className="relative w-full">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar descrição, categoria..." className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
            {busca && <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={11} /></button>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100"><div className="flex items-center gap-1.5 mb-1"><TrendingUp size={13} className="text-green-600" /><p className="text-xs text-gray-500">Receitas</p></div><p className="text-sm font-bold text-green-600">R$ {formatarMoeda(totalReceitas)}</p></div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100"><div className="flex items-center gap-1.5 mb-1"><TrendingDown size={13} className="text-red-500" /><p className="text-xs text-gray-500">Despesas</p></div><p className="text-sm font-bold text-red-500">R$ {formatarMoeda(totalDespesas)}</p></div>
        <div className={`rounded-xl p-3 shadow-sm border ${saldo >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}><p className="text-xs text-gray-500 mb-1">Saldo</p><p className={`text-sm font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>{saldo < 0 ? '-' : ''}R$ {formatarMoeda(Math.abs(saldo))}</p></div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {ABAS.map(a => (<button key={a} onClick={() => setAba(a)} className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${aba === a ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{a}</button>))}
      </div>

      {aba === 'Lançamentos' && (
        <div className="space-y-5">
          {lancamentos.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhum lançamento no período.</div>}
          {agruparPorPropMes(lancamentos).map(({ propId, propNome, meses }) => (
            <div key={propId} className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700 border-b border-gray-200 pb-1">{propNome}</h2>
              {meses.map(({ chave, itens }) => (<GrupoMes key={chave} chave={chave} itens={itens} renderCard={l => <CardLancamento key={l.id} l={l} />} />))}
            </div>
          ))}
        </div>
      )}

      {aba === 'Contas a Pagar' && (
        <div className="space-y-5">
          {contasPagar.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhuma conta a pagar pendente.</div>}
          {agruparPorPropMes(contasPagar).map(({ propId, propNome, meses }) => (
            <div key={propId} className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700 border-b border-gray-200 pb-1">{propNome}</h2>
              {meses.map(({ chave, itens }) => (<GrupoMes key={chave} chave={chave} itens={itens} renderCard={c => <CardConta key={c.id} c={c} tipoAcao="pagar" onMarcarStatus={marcarStatus} />} />))}
            </div>
          ))}
        </div>
      )}

      {aba === 'Contas a Receber' && (
        <div className="space-y-5">
          {contasReceber.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhuma conta a receber pendente.</div>}
          {agruparPorPropMes(contasReceber).map(({ propId, propNome, meses }) => (
            <div key={propId} className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700 border-b border-gray-200 pb-1">{propNome}</h2>
              {meses.map(({ chave, itens }) => (<GrupoMes key={chave} chave={chave} itens={itens} renderCard={c => <CardConta key={c.id} c={c} tipoAcao="receber" onMarcarStatus={marcarStatus} />} />))}
            </div>
          ))}
        </div>
      )}

      {aba === 'Fluxo de Caixa' && (
        <div className="space-y-4">
          {dadosFluxo.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Sem dados no período.</div>
          ) : (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-gray-700">Fluxo de caixa</h2>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={dadosFluxo} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, name) => { const labels = { receitas: 'Receitas', despesasNeg: 'Despesas', saldoAcumulado: 'Saldo acumulado' }; return [`R$ ${formatarMoeda(Math.abs(v))}`, labels[name] || name] }} />
                  <Legend formatter={v => ({ receitas: 'Receitas', despesasNeg: 'Despesas', saldoAcumulado: 'Saldo acumulado' }[v] || v)} />
                  <Bar dataKey="receitas" name="receitas" fill="#16a34a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="despesasNeg" name="despesasNeg" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Line dataKey="saldoAcumulado" name="saldoAcumulado" stroke="#2563eb" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-200"><th className="text-left py-2 text-gray-500 font-medium">Mês</th><th className="text-right py-2 text-green-600 font-medium">Receitas</th><th className="text-right py-2 text-red-500 font-medium">Despesas</th><th className="text-right py-2 text-gray-600 font-medium">Saldo mês</th><th className="text-right py-2 text-blue-600 font-medium">Acumulado</th></tr></thead>
                  <tbody>
                    {dadosFluxo.map(m => { const sm = m.receitas - m.despesas; return (
                      <tr key={m.mes} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="py-1.5 font-medium text-gray-700 capitalize">{m.label}</td>
                        <td className="py-1.5 text-right text-green-600">+R$ {formatarMoeda(m.receitas)}</td>
                        <td className="py-1.5 text-right text-red-500">−R$ {formatarMoeda(m.despesas)}</td>
                        <td className={`py-1.5 text-right font-medium ${sm >= 0 ? 'text-green-600' : 'text-red-500'}`}>{sm >= 0 ? '+' : '−'}R$ {formatarMoeda(Math.abs(sm))}</td>
                        <td className={`py-1.5 text-right font-bold ${m.saldoAcumulado >= 0 ? 'text-blue-600' : 'text-red-600'}`}>R$ {formatarMoeda(m.saldoAcumulado)}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Importar planilha</span>
              <button onClick={abrirImport} className="w-11 h-11 rounded-full bg-gray-500 text-white flex items-center justify-center shadow hover:bg-gray-600"><FileSpreadsheet size={18} /></button>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Novo lançamento</span>
              <button onClick={abrirModal} className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}><Plus size={18} /></button>
            </div>
          </div>
        )}
        <button onClick={() => setFabAberto(!fabAberto)} className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${fabAberto ? 'rotate-45' : ''}`} style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}><Plus size={24} /></button>
      </div>

      {/* Modal novo/editar */}
      {modal && (
        <div data-modal className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editando ? 'Editar lançamento' : 'Novo lançamento'}</h2>
              <button onClick={() => fecharComScrollUnlock(() => { setModal(false); setEditando(null) })} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">
              <div className="flex gap-3">
                {['despesa', 'receita'].map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '', tipoDespesa: '', status: '', safraId: '', propriedadeId: '', propriedadeIds: [], patrimonioId: '' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.tipo === t ? (t === 'receita' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500') : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {t === 'receita' ? 'Receita' : 'Despesa'}
                  </button>
                ))}
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label><input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required /></div>
              {form.tipo === 'despesa' && <div><label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label><select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, tipoDespesa: '', safraId: '', propriedadeId: '', propriedadeIds: [], patrimonioId: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione...</option>{Object.keys(CONFIG_CATEGORIAS).filter(k => !CONFIG_CATEGORIAS[k].ehReceita).map(c => <option key={c}>{c}</option>)}</select></div>}
              {form.tipo === 'receita' && <div><label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label><select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, tipoDespesa: '', safraId: '', propriedadeId: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione...</option><option value="Receita Agrícola">Receita Agrícola</option><option value="Receitas Diversas">Receitas Diversas</option></select></div>}
              {categoriaBloqueada && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3"><Lock size={16} className="text-amber-500 flex-shrink-0 mt-0.5" /><div><p className="text-sm font-medium text-amber-800">Lançamento automático</p><p className="text-xs text-amber-700 mt-0.5">{categoriaBloqueada.mensagem}</p><p className="text-xs text-amber-600 mt-1">📍 Página: <strong>{categoriaBloqueada.pagina}</strong></p></div></div>}
              {form.tipo === 'despesa' && form.categoria && !categoriaBloqueada && <div><label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label><select value={form.tipoDespesa} onChange={e => setForm(f => ({ ...f, tipoDespesa: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione...</option>{(CONFIG_CATEGORIAS[form.categoria]?.tipos || []).map(t => <option key={t}>{t}</option>)}</select></div>}
              {tipoBloqueado && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3"><Lock size={16} className="text-amber-500 flex-shrink-0 mt-0.5" /><div><p className="text-sm font-medium text-amber-800">Lançamento automático</p><p className="text-xs text-amber-700 mt-0.5">{tipoBloqueado.mensagem}</p><p className="text-xs text-amber-600 mt-1">📍 Página: <strong>{tipoBloqueado.pagina}</strong></p></div></div>}
              {!categoriaBloqueada && !tipoBloqueado && !(form.tipo === 'receita' && form.categoria === 'Receita Agrícola') && (
                <>
                  {form.tipo === 'despesa' && form.categoria === 'Máquinas e Equipamentos' && (<><div><label className="block text-sm font-medium text-gray-700 mb-1">Patrimônio vinculado <span className="text-red-500">*</span></label><PatrimonioSearchable value={form.patrimonioId} onChange={id => setForm(f => ({ ...f, patrimonioId: id }))} patrimonios={patrimonios} obrigatorio /></div>{propriedadesDoPatrimonio.length > 0 && <div><label className="block text-sm font-medium text-gray-700 mb-1">Propriedade(s)</label><div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">{propriedadesDoPatrimonio.map(p => <p key={p.id} className="text-sm text-gray-600">🏡 {p.nome}</p>)}<p className="text-xs text-gray-400 mt-1">Vinculadas ao patrimônio selecionado (não editável)</p></div></div>}</>)}
                  {form.tipo === 'despesa' && form.categoria === 'Administrativo' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade(s) <span className="text-red-500">*</span></label>
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">{propriedades.map(p => { const sel = form.propriedadeIds.includes(p.id); return (<label key={p.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"><span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`} onClick={() => setForm(f => ({ ...f, propriedadeIds: sel ? f.propriedadeIds.filter(id => id !== p.id) : [...f.propriedadeIds, p.id], percentuaisRateio: {} }))}>{sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}</span><span className="text-sm text-gray-700">{p.nome}</span></label>) })}</div>
                      {form.propriedadeIds.length > 1 && (<div><label className="block text-sm font-medium text-gray-700 mb-1">Tipo de rateio</label><div className="flex gap-2 mb-2">{[{ val: 'igualitario', label: 'Igualitário' }, { val: 'area', label: 'Por área' }, { val: 'personalizado', label: 'Personalizado' }].map(op => <button key={op.val} type="button" onClick={() => setForm(f => ({ ...f, tipoRateio: op.val, percentuaisRateio: {} }))} className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${form.tipoRateio === op.val ? 'border-green-600 bg-green-50 text-green-700 font-medium' : 'border-gray-200 text-gray-500'}`}>{op.label}</button>)}</div><div className="space-y-1">{form.propriedadeIds.map(id => { const prop = propriedades.find(p => p.id === id); const pct = calcularPercentualRateioAdm(id); return (<div key={id} className="flex items-center justify-between gap-2 text-xs"><span className="text-gray-600">{prop?.nome}</span>{form.tipoRateio === 'personalizado' ? <input type="number" min="0" max="100" step="0.1" value={form.percentuaisRateio[id] || ''} onChange={e => setForm(f => ({ ...f, percentuaisRateio: { ...f.percentuaisRateio, [id]: e.target.value } }))} className="w-20 border border-gray-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-green-500" placeholder="%" /> : <span className="font-medium text-gray-700">{pct.toFixed(1)}%</span>}</div>) })}</div></div>)}
                    </div>
                  )}
                  {form.tipo === 'despesa' && (form.categoria === 'Cultivo' || form.categoria === 'Investimentos') && (<><div><label className="block text-sm font-medium text-gray-700 mb-1">Propriedade <span className="text-red-500">*</span></label><select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value, safraId: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione...</option>{propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>{form.categoria === 'Cultivo' && form.propriedadeId && <div><label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-gray-400 text-xs font-normal">(opcional)</span></label><select value={form.safraId} onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"><option value="">Sem vínculo com safra</option>{safrasDoForm.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>}{form.categoria === 'Investimentos' && <div><label className="block text-sm font-medium text-gray-700 mb-1">Patrimônio vinculado <span className="text-gray-400 text-xs font-normal">(opcional)</span></label><PatrimonioSearchable value={form.patrimonioId} onChange={id => setForm(f => ({ ...f, patrimonioId: id }))} patrimonios={patrimonios} /></div>}</>)}
                  {form.tipo === 'receita' && form.categoria === 'Receitas Diversas' && (<><div><label className="block text-sm font-medium text-gray-700 mb-1">Propriedade <span className="text-red-500">*</span></label><select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value, safraId: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione...</option>{propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>{form.propriedadeId && <div><label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-gray-400 text-xs font-normal">(opcional)</span></label><select value={form.safraId} onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"><option value="">Sem vínculo com safra</option>{safrasDoForm.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>}</>)}
                  {form.tipo === 'receita' && !form.categoria && (<><div><label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label><select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value, safraId: '' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"><option value="">Selecione...</option>{propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>{form.propriedadeId && <div><label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-gray-400 text-xs font-normal">(opcional)</span></label><select value={form.safraId} onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"><option value="">Sem vínculo com safra</option>{safrasDoForm.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>}</>)}
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Data de vencimento</label><input value={form.vencimentoMask} onChange={e => setForm(f => ({ ...f, vencimentoMask: mascaraData(e.target.value) }))} placeholder="dd/mm/aaaa" maxLength={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Valor</label><input value={form.valorMask} onChange={e => setForm(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))} placeholder="R$ 0,00" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required /></div>
                  </div>
                  {!editando && (<div><label className="flex items-center gap-3 cursor-pointer select-none"><div className="relative flex-shrink-0" onClick={() => setForm(f => ({ ...f, parcelar: !f.parcelar }))}><div className={`w-10 h-6 rounded-full transition-colors ${form.parcelar ? 'bg-green-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.parcelar ? 'translate-x-5' : 'translate-x-1'}`} /></div></div><span className="text-sm font-medium text-gray-700">Parcelar</span></label>{form.parcelar && (<div className="mt-3 space-y-2"><div className="flex items-center gap-3"><label className="text-sm text-gray-600 whitespace-nowrap">Número de parcelas:</label><input type="number" min={2} max={60} value={form.numParcelas} onChange={e => setForm(f => ({ ...f, numParcelas: Math.min(60, Math.max(2, Number(e.target.value))) }))} className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div><PreviewParcelas dataInicial={dataParaISO(form.vencimentoMask)} numParcelas={form.numParcelas} valorTotal={form.valorMask} /></div>)}</div>)}
                  <div><label className="block text-sm font-medium text-gray-700 mb-2">Situação <span className="text-red-500">*</span></label><div className="flex gap-2">{[{ val: 'pendente', label: 'Pendente', cor: 'border-yellow-400 bg-yellow-50 text-yellow-700' }, { val: form.tipo === 'receita' ? 'recebido' : 'pago', label: form.tipo === 'receita' ? 'Recebido' : 'Pago', cor: 'border-green-500 bg-green-50 text-green-700' }].map(op => <button key={op.val} type="button" onClick={() => setForm(f => ({ ...f, status: op.val }))} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${form.status === op.val ? op.cor : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>{op.label}</button>)}</div></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Nº Doc. Referência</label><input value={form.notaRef} onChange={e => setForm(f => ({ ...f, notaRef: e.target.value }))} placeholder="Nota Fiscal, Cheque, Boleto, etc." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => fecharComScrollUnlock(() => { setModal(false); setEditando(null) })} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                    <button type="submit" disabled={loading} className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm hover:bg-green-800 disabled:opacity-50">{loading ? 'Salvando...' : editando ? 'Atualizar' : form.parcelar ? `Gerar ${form.numParcelas} parcelas` : 'Salvar'}</button>
                  </div>
                </>
              )}
              {(categoriaBloqueada || tipoBloqueado || (form.tipo === 'receita' && form.categoria === 'Receita Agrícola')) && (
                <button type="button" onClick={() => fecharComScrollUnlock(() => { setModal(false); setEditando(null) })} className="w-full border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Fechar</button>
              )}
            </form>
          </div>
        </div>
      )}

      {modalDetalhe && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between"><h3 className="font-bold text-gray-800">Detalhes do lançamento</h3><button onClick={() => fecharComScrollUnlock(() => setModalDetalhe(null))} className="text-gray-400 hover:text-gray-600"><X size={18} /></button></div>
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              {[{ label: 'Descrição', valor: modalDetalhe.descricao }, { label: 'Tipo', valor: modalDetalhe.tipo === 'receita' ? 'Receita' : 'Despesa' }, { label: 'Categoria', valor: modalDetalhe.categoria }, { label: 'Tipo detalhe', valor: modalDetalhe.tipoDespesa || '—' }, { label: 'Valor', valor: `R$ ${formatarMoeda(modalDetalhe.valor)}` }, { label: 'Data', valor: formatarDataBR(modalDetalhe.vencimento) }, { label: 'Situação', valor: modalDetalhe.status || '—' }, { label: 'Propriedade', valor: modalDetalhe.propriedadeNome || '—' }, { label: 'Safra', valor: modalDetalhe.safraNome || '—' }, { label: 'Patrimônio', valor: modalDetalhe.patrimonioNome || '—' }, { label: 'Nº Doc.', valor: modalDetalhe.notaRef || '—' }].filter(r => r.valor && r.valor !== '—').map(row => (
                <div key={row.label} className="flex justify-between gap-2"><span className="text-xs text-gray-500">{row.label}</span><span className="text-xs font-medium text-gray-800 text-right">{row.valor}</span></div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><p className="text-xs text-amber-700">🔒 Este lançamento foi gerado automaticamente e não pode ser editado. Para correções, acesse a página de origem.</p></div>
            <button onClick={() => fecharComScrollUnlock(() => setModalDetalhe(null))} className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Fechar</button>
          </div>
        </div>
      )}

      {modalImport && (
        <div data-modal className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between"><h2 className="font-bold text-gray-800">Importar lançamentos</h2><button onClick={() => fecharComScrollUnlock(() => setModalImport(false))} className="text-gray-400 hover:text-gray-600"><X size={18} /></button></div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">Selecione um arquivo <strong>.xlsx</strong> ou <strong>.xml</strong>.</p>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 transition-colors" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); processarArquivo(e.dataTransfer.files[0]) }}>
                <Upload size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">{arquivoImport ? arquivoImport.name : 'Clique ou arraste o arquivo aqui'}</p>
                <p className="text-xs text-gray-400 mt-1">.xlsx ou .xml</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xml" className="hidden" onChange={e => processarArquivo(e.target.files[0])} />
              </div>
              {previewImport.length > 0 && <div className="space-y-1"><p className="text-xs font-semibold text-gray-500">Prévia (5 primeiras linhas):</p>{previewImport.map((r, i) => <div key={i} className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 truncate">{r.join(' | ')}</div>)}</div>}
              <div className="flex gap-3">
                <button onClick={() => fecharComScrollUnlock(() => setModalImport(false))} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                <button onClick={confirmarImport} disabled={!arquivoImport || importando} className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm hover:bg-green-800 disabled:opacity-50">{importando ? 'Importando...' : 'Confirmar importação'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600">{confirmacao.mensagem}</p>
            <p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => fecharComScrollUnlock(() => setConfirmacao(null))} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { confirmacao.onConfirmar(); fecharComScrollUnlock(() => setConfirmacao(null)) }} className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
