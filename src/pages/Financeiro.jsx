import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, TrendingUp, TrendingDown, Pencil, FileSpreadsheet, Sparkles, X, Upload, CheckCircle, Building2, Tractor, ShoppingCart, Sprout } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'

// ─── Categorias ──────────────────────────────────────────────────────────────
const CATEGORIAS_DESPESA = {
  'Administrativo': ['Pessoal', 'Contabilidade', 'Consultoria', 'Arrendamento', 'Financiamento', 'Outros'],
  'Máquinas e Equipamentos': ['Combustível', 'Manutenção', 'Outros'],
  'Insumos': ['Sementes / Mudas', 'Adubos', 'Fertilizantes', 'Defensivos', 'Outros'],
  'Cultivo': ['Preparação do Solo', 'Plantio', 'Manejo e Tratos Agrícolas', 'Colheita', 'Outros'],
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
function formatarDataBR(dataISO) {
  if (!dataISO) return ''
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}
function dataParaISO(dataBR) {
  if (!dataBR || dataBR.length < 10) return ''
  const [d, m, y] = dataBR.split('/')
  if (!d || !m || !y) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
function mascaraData(valor) {
  const nums = valor.replace(/\D/g, '').slice(0, 8)
  if (nums.length <= 2) return nums
  if (nums.length <= 4) return `${nums.slice(0, 2)}/${nums.slice(2)}`
  return `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4)}`
}
function estaVencido(dataISO) {
  if (!dataISO) return false
  return new Date(dataISO + 'T00:00:00') < new Date(new Date().toDateString())
}
function filtrarPorPeriodo(lista, filtro) {
  const { tipo, ano, mes, dataInicio, dataFim, safraId } = filtro
  return lista.filter(l => {
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
function agruparPorMes(lista) {
  const grupos = {}
  lista.forEach(l => {
    const chave = (l.vencimento || '').substring(0, 7)
    if (!grupos[chave]) grupos[chave] = []
    grupos[chave].push(l)
  })
  return Object.entries(grupos).sort((a, b) => b[0].localeCompare(a[0]))
}
function nomeMes(chave) {
  if (!chave) return 'Sem data'
  const [y, m] = chave.split('-')
  try { return format(new Date(Number(y), Number(m) - 1), 'MMMM yyyy', { locale: ptBR }) } catch { return chave }
}
function saldoDoGrupo(itens) {
  const rec = itens.filter(l => l.tipo === 'receita').reduce((a, b) => a + (Number(b.valor) || 0), 0)
  const des = itens.filter(l => l.tipo === 'despesa').reduce((a, b) => a + (Number(b.valor) || 0), 0)
  return rec - des
}

function IconeCategoria({ categoria, tipo, size = 13 }) {
  if (tipo === 'receita') return <TrendingUp size={size} className="text-green-600" />
  switch (categoria) {
    case 'Administrativo':        return <Building2 size={size} className="text-red-500" />
    case 'Máquinas e Equipamentos': return <Tractor size={size} className="text-red-500" />
    case 'Insumos':               return <ShoppingCart size={size} className="text-red-500" />
    case 'Cultivo':               return <Sprout size={size} className="text-red-500" />
    default:                      return <TrendingDown size={size} className="text-red-500" />
  }
}

// ─── Form padrão ──────────────────────────────────────────────────────────────
const FORM_PADRAO = {
  descricao: '', tipo: 'despesa', categoria: '', tipoDespesa: '',
  vencimentoMask: '', valorMask: '', notaRef: '',
  propriedadeId: '', safraId: '', status: '', patrimonioId: ''
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Financeiro() {
  const { usuario } = useAuth()
  const [aba, setAba] = useState('Lançamentos')
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [patrimonios, setPatrimonios] = useState([])
  const [modal, setModal] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [arquivoImport, setArquivoImport] = useState(null)
  const [previewImport, setPreviewImport] = useState([])
  const [importando, setImportando] = useState(false)
  const fileRef = useRef()
  const [filtro, setFiltro] = useState({
    tipo: 'anual', ano: ANO_ATUAL, mes: MES_ATUAL,
    dataInicio: '', dataFim: '', safraId: ''
  })

  async function carregar() {
    const uid = usuario.uid
    const q = (col) => query(collection(db, col), where('uid', '==', uid))
    const [finSnap, propSnap, safSnap, patSnap] = await Promise.all([
      getDocs(q('financeiro')),
      getDocs(q('propriedades')),
      getDocs(q('safras')),
      getDocs(q('patrimonios')),
    ])
    setLista(finSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPatrimonios(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  // ─── Dados filtrados ───────────────────────────────────────────────────────
  const listaFiltrada = useMemo(() => filtrarPorPeriodo(lista, filtro), [lista, filtro])
  const lancamentos = listaFiltrada
  const contasPagar = useMemo(() => listaFiltrada.filter(l => l.tipo === 'despesa' && l.status === 'pendente'), [listaFiltrada])
  const contasReceber = useMemo(() => listaFiltrada.filter(l => l.tipo === 'receita' && l.status === 'pendente'), [listaFiltrada])
  const totalReceitas = useMemo(() => listaFiltrada.filter(l => l.tipo === 'receita').reduce((a, b) => a + (Number(b.valor) || 0), 0), [listaFiltrada])
  const totalDespesas = useMemo(() => listaFiltrada.filter(l => l.tipo === 'despesa').reduce((a, b) => a + (Number(b.valor) || 0), 0), [listaFiltrada])
  const saldo = totalReceitas - totalDespesas

  // ─── Fluxo de caixa ────────────────────────────────────────────────────────
  const dadosFluxo = useMemo(() => {
    const mapa = {}
    listaFiltrada.forEach(l => {
      if (!l.vencimento) return
      const mes = l.vencimento.substring(0, 7)
      if (!mapa[mes]) mapa[mes] = { mes, receitas: 0, despesas: 0 }
      if (l.tipo === 'receita') mapa[mes].receitas += Number(l.valor) || 0
      else mapa[mes].despesas += Number(l.valor) || 0
    })
    const ordenado = Object.values(mapa).sort((a, b) => a.mes.localeCompare(b.mes))
    let acumulado = 0
    return ordenado.map(m => {
      acumulado += m.receitas - m.despesas
      const [y, mo] = m.mes.split('-')
      return {
        ...m,
        label: format(new Date(Number(y), Number(mo) - 1), 'MMM/yy', { locale: ptBR }),
        saldoAcumulado: acumulado,
        despesasNeg: -m.despesas,
      }
    })
  }, [listaFiltrada])

  // ─── Modal manual ──────────────────────────────────────────────────────────
  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
    setFabAberto(false)
    setModal(true)
  }
  function abrirEdicao(item) {
    setEditando(item.id)
    setForm({
      descricao: item.descricao || '',
      tipo: item.tipo || 'despesa',
      categoria: item.categoria || '',
      tipoDespesa: item.tipoDespesa || '',
      vencimentoMask: item.vencimento ? formatarDataBR(item.vencimento) : '',
      valorMask: item.valor ? mascaraMoeda(String(Math.round(Number(item.valor) * 100))) : '',
      notaRef: item.notaRef || '',
      propriedadeId: item.propriedadeId || '',
      safraId: item.safraId || '',
      status: item.status || '',
      patrimonioId: item.patrimonioId || '',
    })
    setModal(true)
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.status) return alert('Selecione a situação do lançamento (Pendente, Pago ou Recebido).')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    const safra = safras.find(s => s.id === form.safraId)
    const patrimonio = patrimonios.find(p => p.id === form.patrimonioId)
    const payload = {
      descricao: form.descricao,
      tipo: form.tipo,
      categoria: form.tipo === 'receita' ? 'Receita Agrícola' : form.categoria,
      tipoDespesa: form.tipoDespesa || '',
      vencimento: dataParaISO(form.vencimentoMask),
      valor: parseFloat(desmascarar(form.valorMask)) || 0,
      notaRef: form.notaRef,
      propriedadeId: form.propriedadeId,
      propriedadeNome: prop?.nome || '',
      safraId: form.safraId,
      safraNome: safra?.nome || '',
      status: form.status,
      patrimonioId: form.patrimonioId || '',
      patrimonioNome: patrimonio?.nome || '',
      uid: usuario.uid,
    }
    if (editando) {
      await updateDoc(doc(db, 'financeiro', editando), payload)
    } else {
      await addDoc(collection(db, 'financeiro'), { ...payload, criadoEm: new Date() })
    }
    setModal(false)
    setEditando(null)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir este lançamento?')) return
    await deleteDoc(doc(db, 'financeiro', id))
    await carregar()
  }
  async function marcarStatus(id, novoStatus) {
    await updateDoc(doc(db, 'financeiro', id), { status: novoStatus })
    await carregar()
  }

  // ─── Importação XLSX/XML ───────────────────────────────────────────────────
  function abrirImport() {
    setArquivoImport(null)
    setPreviewImport([])
    setFabAberto(false)
    setModalImport(true)
  }
  function processarArquivo(file) {
    if (!file) return
    setArquivoImport(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const dados = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const linhas = dados.slice(1).filter(r => r.length > 0).slice(0, 5)
        setPreviewImport(linhas)
      } catch { alert('Erro ao ler o arquivo. Verifique o formato.') }
    }
    reader.readAsBinaryString(file)
  }
  async function confirmarImport() {
    if (!arquivoImport) return
    setImportando(true)
    // Processamento completo — a implementar na próxima iteração
    await new Promise(r => setTimeout(r, 1000))
    alert('Importação em desenvolvimento. Em breve disponível!')
    setImportando(false)
    setModalImport(false)
  }

  // ─── Cards ─────────────────────────────────────────────────────────────────
  function CardLancamento({ l }) {
  const vencido = estaVencido(l.vencimento)
  const isPago = l.status === 'pago' || l.status === 'recebido'
  return (
    <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center ${
          l.tipo === 'receita' ? 'bg-green-100' : 'bg-red-100'
        }`}>
          <IconeCategoria categoria={l.categoria} tipo={l.tipo} size={14} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate leading-tight">{l.descricao}</p>
          {/* Mobile: apenas data */}
          <p className="text-xs font-bold text-gray-600 leading-tight sm:hidden">
            {formatarDataBR(l.vencimento)}
            {vencido && !isPago ? <span className="text-red-400 font-normal ml-1">· Vencido</span> : null}
          </p>
          {/* Desktop: data + detalhes */}
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
        {isPago && (
          <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full hidden sm:inline">
            {l.status === 'recebido' ? 'Recebido' : 'Pago'}
          </span>
        )}
        <button onClick={() => abrirEdicao(l)} className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={12} /></button>
        <button onClick={() => excluir(l.id)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

  function CardConta({ c, tipoAcao }) {
  const vencido = estaVencido(c.vencimento)
  const labelBtn = tipoAcao === 'receber' ? 'Marcar recebido' : 'Marcar pago'
  const novoStatus = tipoAcao === 'receber' ? 'recebido' : 'pago'
  const corBtn = tipoAcao === 'receber'
    ? 'bg-green-700 hover:bg-green-800'
    : 'bg-red-600 hover:bg-red-700'

  return (
    <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 flex items-center gap-2">
      {/* Ícone */}
      <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center ${
        tipoAcao === 'receber' ? 'bg-green-100' : 'bg-red-100'
      }`}>
        <IconeCategoria categoria={c.categoria} tipo={c.tipo} size={14} />
      </div>

      {/* Conteúdo principal */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate leading-tight">{c.descricao}</p>
        {/* Mobile: data + valor + botão abaixo */}
        <div className="sm:hidden">
          <p className={`text-xs font-bold leading-tight ${vencido ? 'text-red-400' : 'text-gray-600'}`}>
            {vencido ? 'Vencido' : 'Vence'} em {formatarDataBR(c.vencimento)}
          </p>
          <div className="flex items-center justify-between mt-1.5 gap-2">
            <p className="text-sm font-bold text-gray-700">R${formatarMoeda(c.valor)}</p>
            <button
              onClick={() => marcarStatus(c.id, novoStatus)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors text-white font-medium ${corBtn}`}>
              <CheckCircle size={12} />
              {labelBtn}
            </button>
          </div>
        </div>
        {/* Desktop: data + safra na mesma linha */}
        <p className={`text-xs leading-tight hidden sm:block ${vencido ? 'text-red-400 font-medium' : 'text-gray-400'}`}>
          <span className="font-bold text-gray-600">{formatarDataBR(c.vencimento)}</span>
          {vencido ? <span className="text-red-400"> · Vencido</span> : null}
          {c.safraNome ? <span className="text-gray-400"> · {c.safraNome}</span> : null}
        </p>
      </div>

      {/* Ações desktop */}
      <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
        <p className="text-sm font-bold text-gray-700 whitespace-nowrap">R${formatarMoeda(c.valor)}</p>
        <button
          onClick={() => marcarStatus(c.id, novoStatus)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap font-medium text-white ${corBtn}`}>
          <CheckCircle size={13} />
          {labelBtn}
        </button>
        <button onClick={() => abrirEdicao(c)} className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={12} /></button>
        <button onClick={() => excluir(c.id)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
      </div>

      {/* Editar/excluir mobile */}
      <div className="flex sm:hidden flex-col gap-1 flex-shrink-0">
        <button onClick={() => abrirEdicao(c)} className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={12} /></button>
        <button onClick={() => excluir(c.id)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

  // ─── Render grupos com subtotal ────────────────────────────────────────────
  function GrupoMes({ chave, itens, renderCard }) {
    const saldo = saldoDoGrupo(itens)
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide capitalize">
            {nomeMes(chave)}
          </p>
          <p className={`text-xs font-semibold ${saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {saldo >= 0 ? '+' : ''}R$ {formatarMoeda(saldo)}
          </p>
        </div>
        <div className="space-y-1.5">
          {itens.map(item => renderCard(item))}
        </div>
      </div>
    )
  }

  // ─── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24">

      {/* Cabeçalho */}
      <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>

      {/* Filtro compacto */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex flex-wrap items-center gap-2">
        <select value={filtro.tipo} onChange={e => setFiltro(f => ({ ...f, tipo: e.target.value }))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
          <option value="anual">Anual</option>
          <option value="mensal">Mensal</option>
          <option value="safra">Por Safra</option>
          <option value="personalizado">Personalizado</option>
        </select>
        {filtro.tipo === 'anual' && (
          <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
            {ANOS.map(a => <option key={a}>{a}</option>)}
          </select>
        )}
        {filtro.tipo === 'mensal' && (
          <>
            <select value={filtro.mes} onChange={e => setFiltro(f => ({ ...f, mes: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
              {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
              {ANOS.map(a => <option key={a}>{a}</option>)}
            </select>
          </>
        )}
        {filtro.tipo === 'safra' && (
          <select value={filtro.safraId} onChange={e => setFiltro(f => ({ ...f, safraId: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50">
            <option value="">Selecione...</option>
            {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        )}
        {filtro.tipo === 'personalizado' && (
          <>
            <input type="date" value={filtro.dataInicio} onChange={e => setFiltro(f => ({ ...f, dataInicio: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
            <span className="text-xs text-gray-400">até</span>
            <input type="date" value={filtro.dataFim} onChange={e => setFiltro(f => ({ ...f, dataFim: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
          </>
        )}
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={13} className="text-green-600" />
            <p className="text-xs text-gray-500">Receitas</p>
          </div>
          <p className="text-sm font-bold text-green-600">R$ {formatarMoeda(totalReceitas)}</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown size={13} className="text-red-500" />
            <p className="text-xs text-gray-500">Despesas</p>
          </div>
          <p className="text-sm font-bold text-red-500">R$ {formatarMoeda(totalDespesas)}</p>
        </div>
        <div className={`rounded-xl p-3 shadow-sm border ${saldo >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs text-gray-500 mb-1">Saldo</p>
          <p className={`text-sm font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {saldo < 0 ? '-' : ''}R$ {formatarMoeda(Math.abs(saldo))}
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {ABAS.map(a => (
          <button key={a} onClick={() => setAba(a)}
            className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{a}</button>
        ))}
      </div>

      {/* ── Lançamentos ── */}
      {aba === 'Lançamentos' && (
        <div className="space-y-4">
          {lancamentos.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhum lançamento no período.</div>}
          {agruparPorMes(lancamentos).map(([chave, itens]) => (
            <GrupoMes key={chave} chave={chave} itens={itens} renderCard={l => <CardLancamento key={l.id} l={l} />} />
          ))}
        </div>
      )}

      {/* ── Contas a Pagar ── */}
      {aba === 'Contas a Pagar' && (
        <div className="space-y-4">
          {contasPagar.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhuma conta a pagar pendente.</div>}
          {agruparPorMes(contasPagar).map(([chave, itens]) => (
            <GrupoMes key={chave} chave={chave} itens={itens} renderCard={c => <CardConta key={c.id} c={c} tipoAcao="pagar" />} />
          ))}
        </div>
      )}

      {/* ── Contas a Receber ── */}
      {aba === 'Contas a Receber' && (
        <div className="space-y-4">
          {contasReceber.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhuma conta a receber pendente.</div>}
          {agruparPorMes(contasReceber).map(([chave, itens]) => (
            <GrupoMes key={chave} chave={chave} itens={itens} renderCard={c => <CardConta key={c.id} c={c} tipoAcao="receber" />} />
          ))}
        </div>
      )}

      {/* ── Fluxo de Caixa ── */}
      {aba === 'Fluxo de Caixa' && (
        <div className="space-y-4">
          {dadosFluxo.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">Nenhum dado disponível para o período.</div>}
          {dadosFluxo.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-semibold text-gray-700 mb-4">Fluxo de caixa</h2>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={dadosFluxo} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value, name) => {
                    const labels = { receitas: 'Receitas', despesasNeg: 'Despesas', saldoAcumulado: 'Saldo acumulado' }
                    return [`R$ ${formatarMoeda(Math.abs(value))}`, labels[name] || name]
                  }} />
                  <Legend formatter={v => ({ receitas: 'Receitas', despesasNeg: 'Despesas', saldoAcumulado: 'Saldo acumulado' }[v] || v)} />
                  <Bar dataKey="receitas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesasNeg" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="saldoAcumulado" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
              {/* Tabela com cabeçalho */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-gray-500 font-medium">Mês</th>
                      <th className="text-right py-2 text-green-600 font-medium">Receitas</th>
                      <th className="text-right py-2 text-red-500 font-medium">Despesas</th>
                      <th className="text-right py-2 text-blue-600 font-medium">Saldo acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosFluxo.map(m => (
                      <tr key={m.mes} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 font-medium text-gray-700 capitalize">{m.label}</td>
                        <td className="py-1.5 text-right text-green-600">+R$ {formatarMoeda(m.receitas)}</td>
                        <td className="py-1.5 text-right text-red-500">-R$ {formatarMoeda(m.despesas)}</td>
                        <td className={`py-1.5 text-right font-bold ${m.saldoAcumulado >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                          R$ {formatarMoeda(m.saldoAcumulado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FAB flutuante ── */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            {/* Em breve: IA */}
            <div className="flex items-center gap-2 opacity-50 cursor-not-allowed">
              <span className="bg-white text-gray-500 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Em breve</span>
              <button disabled className="w-11 h-11 rounded-full bg-purple-100 text-purple-400 flex items-center justify-center shadow">
                <Sparkles size={18} />
              </button>
            </div>
            {/* Importar arquivo */}
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Importar XLSX / XML</span>
              <button onClick={abrirImport}
                className="w-11 h-11 rounded-full bg-blue-600 text-white flex items-center justify-center shadow hover:bg-blue-700 transition-colors">
                <FileSpreadsheet size={18} />
              </button>
            </div>
            {/* Inserção manual */}
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Inserção manual</span>
              <button onClick={abrirModal}
                className="w-11 h-11 rounded-full bg-green-600 text-white flex items-center justify-center shadow hover:bg-green-700 transition-colors">
                <Pencil size={18} />
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

      {/* ── Modal criação/edição ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editando ? 'Editar lançamento' : 'Novo lançamento'}</h2>
              <button onClick={() => { setModal(false); setEditando(null) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">

              {/* Tipo */}
              <div className="flex gap-3">
                {['despesa', 'receita'].map(t => (
                  <button key={t} type="button"
                    onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '', tipoDespesa: '', status: '' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.tipo === t
                        ? t === 'receita' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {t === 'receita' ? 'Receita' : 'Despesa'}
                  </button>
                ))}
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
              </div>

              {/* Categoria (despesa) */}
              {form.tipo === 'despesa' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                  <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, tipoDespesa: '' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                    <option value="">Selecione...</option>
                    {Object.keys(CATEGORIAS_DESPESA).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {/* Tipo de despesa */}
              {form.tipo === 'despesa' && form.categoria && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select value={form.tipoDespesa} onChange={e => setForm(f => ({ ...f, tipoDespesa: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                    <option value="">Selecione...</option>
                    {CATEGORIAS_DESPESA[form.categoria]?.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              )}

              {/* Patrimônio */}
              {form.tipo === 'despesa' && form.categoria === 'Máquinas e Equipamentos' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Patrimônio vinculado (opcional)</label>
                  <select value={form.patrimonioId} onChange={e => setForm(f => ({ ...f, patrimonioId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Nenhum</option>
                    {patrimonios.map(p => <option key={p.id} value={p.id}>{p.nome} — {p.categoria}</option>)}
                  </select>
                </div>
              )}

              {/* Data e Valor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de vencimento</label>
                  <input value={form.vencimentoMask}
                    onChange={e => setForm(f => ({ ...f, vencimentoMask: mascaraData(e.target.value) }))}
                    placeholder="dd/mm/aaaa" maxLength={10}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor</label>
                  <input value={form.valorMask}
                    onChange={e => setForm(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))}
                    placeholder="R$ 0,00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                </div>
              </div>

              {/* Situação — seleção obrigatória */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Situação <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  {[
                    { val: 'pendente', label: 'Pendente', cor: 'border-yellow-400 bg-yellow-50 text-yellow-700' },
                    { val: form.tipo === 'receita' ? 'recebido' : 'pago', label: form.tipo === 'receita' ? 'Recebido' : 'Pago', cor: 'border-green-500 bg-green-50 text-green-700' },
                  ].map(op => (
                    <button key={op.val} type="button"
                      onClick={() => setForm(f => ({ ...f, status: op.val }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                        form.status === op.val ? op.cor : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}>
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nº Doc */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Doc. Referência</label>
                <input value={form.notaRef} onChange={e => setForm(f => ({ ...f, notaRef: e.target.value }))}
                  placeholder="Nota Fiscal, Cheque, Boleto, etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              {/* Propriedade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>

              {/* Safra */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-red-500">*</span></label>
                <select value={form.safraId} onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                  <option value="">Selecione a safra...</option>
                  {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setModal(false); setEditando(null) }}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm hover:bg-green-800 disabled:opacity-50">
                  {loading ? 'Salvando...' : editando ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal importação ── */}
      {modalImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Importar lançamentos</h2>
              <button onClick={() => setModalImport(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">Selecione um arquivo <strong>.xlsx</strong> ou <strong>.xml</strong> com os lançamentos. A primeira linha deve conter os cabeçalhos.</p>
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); processarArquivo(e.dataTransfer.files[0]) }}>
                <Upload size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">{arquivoImport ? arquivoImport.name : 'Clique ou arraste o arquivo aqui'}</p>
                <p className="text-xs text-gray-400 mt-1">.xlsx ou .xml</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xml" className="hidden"
                  onChange={e => processarArquivo(e.target.files[0])} />
              </div>
              {previewImport.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Prévia (primeiras 5 linhas):</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="text-xs w-full">
                      <tbody>
                        {previewImport.map((row, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            {row.map((cell, j) => <td key={j} className="px-2 py-1 text-gray-600">{String(cell)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setModalImport(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                <button onClick={confirmarImport} disabled={!arquivoImport || importando}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {importando ? 'Processando...' : 'Importar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}