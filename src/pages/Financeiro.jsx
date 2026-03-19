import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, TrendingUp, TrendingDown, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'

// ─── Estrutura de categorias ────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Form padrão ─────────────────────────────────────────────────────────────
const FORM_PADRAO = {
  descricao: '', tipo: 'despesa', categoria: '', tipoDespesa: '',
  vencimentoMask: '', valorMask: '', notaRef: '',
  propriedadeId: '', safraId: '', status: 'pendente', patrimonioId: ''
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
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
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

  // ─── Dados filtrados ──────────────────────────────────────────────────────
  const listaFiltrada = useMemo(() => filtrarPorPeriodo(lista, filtro), [lista, filtro])

  // Item 1: lançamentos = TODOS os registros filtrados
  const lancamentos = listaFiltrada

  const contasPagar = useMemo(() =>
    listaFiltrada.filter(l => l.tipo === 'despesa' && l.status === 'pendente'),
    [listaFiltrada])

  const contasReceber = useMemo(() =>
    listaFiltrada.filter(l => l.tipo === 'receita' && l.status === 'pendente'),
    [listaFiltrada])

  const totalReceitas = useMemo(() =>
    listaFiltrada.filter(l => l.tipo === 'receita').reduce((a, b) => a + (Number(b.valor) || 0), 0),
    [listaFiltrada])

  const totalDespesas = useMemo(() =>
    listaFiltrada.filter(l => l.tipo === 'despesa').reduce((a, b) => a + (Number(b.valor) || 0), 0),
    [listaFiltrada])

  const saldo = totalReceitas - totalDespesas

  // ─── Fluxo de caixa ───────────────────────────────────────────────────────
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

  // ─── Modal ────────────────────────────────────────────────────────────────
  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
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
      status: item.status || 'pendente',
      patrimonioId: item.patrimonioId || '',
    })
    setModal(true)
  }

  async function salvar(e) {
    e.preventDefault()
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

  // ─── Card compacto de lançamento ─────────────────────────────────────────
  function CardLancamento({ l, mostrarAcoes = true }) {
    const vencido = estaVencido(l.vencimento)
    const isPago = l.status === 'pago' || l.status === 'recebido'
    return (
      <div className="bg-white rounded-lg px-4 py-2.5 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center ${
            l.tipo === 'receita' ? 'bg-green-100' : 'bg-red-100'
          }`}>
            {l.tipo === 'receita'
              ? <TrendingUp size={13} className="text-green-600" />
              : <TrendingDown size={13} className="text-red-500" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate leading-tight">{l.descricao}</p>
            <p className="text-xs text-gray-400 truncate leading-tight">
              {l.categoria}{l.tipoDespesa ? ` · ${l.tipoDespesa}` : ''}
              {l.vencimento ? ` · ${formatarDataBR(l.vencimento)}` : ''}
              {vencido && !isPago ? <span className="text-red-400 ml-1">· Vencido</span> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <p className={`text-sm font-bold ${l.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}`}>
            {l.tipo === 'receita' ? '+' : '-'}R${formatarMoeda(l.valor)}
          </p>
          {isPago && (
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
              {l.status === 'recebido' ? 'Recebido' : 'Pago'}
            </span>
          )}
          {mostrarAcoes && (
            <>
              <button onClick={() => abrirEdicao(l)} className="text-gray-300 hover:text-blue-500 p-0.5">
                <Pencil size={13} />
              </button>
              <button onClick={() => excluir(l.id)} className="text-gray-300 hover:text-red-500 p-0.5">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── Card compacto de conta ──────────────────────────────────────────────
  function CardConta({ c, tipoAcao }) {
    const vencido = estaVencido(c.vencimento)
    const novoStatus = tipoAcao === 'receber' ? 'recebido' : 'pago'
    const labelBtn = tipoAcao === 'receber' ? 'Marcar recebido' : 'Marcar pago'
    return (
      <div className="bg-white rounded-lg px-4 py-2.5 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate leading-tight">{c.descricao}</p>
          <p className={`text-xs leading-tight ${vencido ? 'text-red-400 font-medium' : 'text-gray-400'}`}>
            {vencido ? 'Vencido' : 'Vence'} em {formatarDataBR(c.vencimento)}
            {c.safraNome ? ` · ${c.safraNome}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <p className="text-sm font-bold text-gray-700">R${formatarMoeda(c.valor)}</p>
          <button onClick={() => marcarStatus(c.id, novoStatus)}
            className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full hover:bg-green-200 whitespace-nowrap">
            {labelBtn}
          </button>
          <button onClick={() => abrirEdicao(c)} className="text-gray-300 hover:text-blue-500 p-0.5">
            <Pencil size={13} />
          </button>
          <button onClick={() => excluir(c.id)} className="text-gray-300 hover:text-red-500 p-0.5">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>
        <button onClick={abrirModal}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
          <Plus size={16} /> Novo lançamento
        </button>
      </div>

      {/* Filtro de período */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Período</label>
            <select value={filtro.tipo} onChange={e => setFiltro(f => ({ ...f, tipo: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="anual">Anual</option>
              <option value="mensal">Mensal</option>
              <option value="safra">Por Safra</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </div>
          {filtro.tipo === 'anual' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ano</label>
              <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {ANOS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
          )}
          {filtro.tipo === 'mensal' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mês</label>
                <select value={filtro.mes} onChange={e => setFiltro(f => ({ ...f, mes: Number(e.target.value) }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ano</label>
                <select value={filtro.ano} onChange={e => setFiltro(f => ({ ...f, ano: Number(e.target.value) }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {ANOS.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
            </>
          )}
          {filtro.tipo === 'safra' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Safra</label>
              <select value={filtro.safraId} onChange={e => setFiltro(f => ({ ...f, safraId: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Selecione a safra...</option>
                {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
          )}
          {filtro.tipo === 'personalizado' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">De</label>
                <input type="date" value={filtro.dataInicio}
                  onChange={e => setFiltro(f => ({ ...f, dataInicio: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Até</label>
                <input type="date" value={filtro.dataFim}
                  onChange={e => setFiltro(f => ({ ...f, dataFim: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={15} className="text-green-600" />
            <p className="text-xs text-gray-500">Receitas</p>
          </div>
          <p className="text-base font-bold text-green-600">R$ {formatarMoeda(totalReceitas)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={15} className="text-red-500" />
            <p className="text-xs text-gray-500">Despesas</p>
          </div>
          <p className="text-base font-bold text-red-500">R$ {formatarMoeda(totalDespesas)}</p>
        </div>
        <div className={`rounded-xl p-4 shadow-sm border ${saldo >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs text-gray-500 mb-1">Saldo</p>
          <p className={`text-base font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {saldo < 0 ? '-' : ''}R$ {formatarMoeda(Math.abs(saldo))}
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {ABAS.map(a => (
          <button key={a} onClick={() => setAba(a)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a}
          </button>
        ))}
      </div>

      {/* ── Lançamentos (todos) ── */}
      {aba === 'Lançamentos' && (
        <div className="space-y-4">
          {lancamentos.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhum lançamento no período selecionado.
            </div>
          )}
          {agruparPorMes(lancamentos).map(([chave, itens]) => (
            <div key={chave}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 capitalize">
                {nomeMes(chave)}
              </p>
              <div className="space-y-1.5">
                {itens.map(l => <CardLancamento key={l.id} l={l} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contas a Pagar ── */}
      {aba === 'Contas a Pagar' && (
        <div className="space-y-4">
          {contasPagar.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhuma conta a pagar pendente.
            </div>
          )}
          {agruparPorMes(contasPagar).map(([chave, itens]) => (
            <div key={chave}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 capitalize">
                {nomeMes(chave)}
              </p>
              <div className="space-y-1.5">
                {itens.map(c => <CardConta key={c.id} c={c} tipoAcao="pagar" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contas a Receber ── */}
      {aba === 'Contas a Receber' && (
        <div className="space-y-4">
          {contasReceber.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhuma conta a receber pendente.
            </div>
          )}
          {agruparPorMes(contasReceber).map(([chave, itens]) => (
            <div key={chave}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 capitalize">
                {nomeMes(chave)}
              </p>
              <div className="space-y-1.5">
                {itens.map(c => <CardConta key={c.id} c={c} tipoAcao="receber" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fluxo de Caixa ── */}
      {aba === 'Fluxo de Caixa' && (
        <div className="space-y-4">
          {dadosFluxo.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhum dado disponível para o período.
            </div>
          )}
          {dadosFluxo.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h2 className="font-semibold text-gray-700 mb-4">Fluxo de caixa</h2>
              <ResponsiveContainer width="100%" height={300}>
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
              <div className="mt-3 space-y-1.5">
                {dadosFluxo.map(m => (
                  <div key={m.mes} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <p className="text-sm font-medium text-gray-700 capitalize w-20">{m.label}</p>
                    <p className="text-xs text-green-600 w-28 text-right">+R$ {formatarMoeda(m.receitas)}</p>
                    <p className="text-xs text-red-500 w-28 text-right">-R$ {formatarMoeda(m.despesas)}</p>
                    <p className={`text-xs font-bold w-28 text-right ${m.saldoAcumulado >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      R$ {formatarMoeda(m.saldoAcumulado)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modal criação/edição ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-800">
                {editando ? 'Editar lançamento' : 'Novo lançamento'}
              </h2>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">

              {/* Tipo receita/despesa */}
              <div className="flex gap-3">
                {['despesa', 'receita'].map(t => (
                  <button key={t} type="button"
                    onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '', tipoDespesa: '' }))}
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              {/* Categoria (apenas despesa) */}
              {form.tipo === 'despesa' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                  <select value={form.categoria}
                    onChange={e => setForm(f => ({ ...f, categoria: e.target.value, tipoDespesa: '' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required>
                    <option value="">Selecione...</option>
                    {Object.keys(CATEGORIAS_DESPESA).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {/* Tipo de despesa */}
              {form.tipo === 'despesa' && form.categoria && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select value={form.tipoDespesa}
                    onChange={e => setForm(f => ({ ...f, tipoDespesa: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required>
                    <option value="">Selecione...</option>
                    {CATEGORIAS_DESPESA[form.categoria]?.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              )}

              {/* Patrimônio (Máquinas e Equipamentos) */}
              {form.tipo === 'despesa' && form.categoria === 'Máquinas e Equipamentos' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Patrimônio vinculado (opcional)</label>
                  <select value={form.patrimonioId}
                    onChange={e => setForm(f => ({ ...f, patrimonioId: e.target.value }))}
                    size={patrimonios.length > 5 ? 5 : undefined}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Nenhum</option>
                    {patrimonios.map(p => (
                      <option key={p.id} value={p.id}>{p.nome} — {p.categoria}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Data de vencimento + valor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
                  <input value={form.vencimentoMask}
                    onChange={e => setForm(f => ({ ...f, vencimentoMask: mascaraData(e.target.value) }))}
                    placeholder="dd/mm/aaaa" maxLength={10}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor</label>
                  <input value={form.valorMask}
                    onChange={e => setForm(f => ({ ...f, valorMask: mascaraMoeda(e.target.value) }))}
                    placeholder="R$ 0,00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>
              </div>

              {/* Toggle status */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <span className="text-sm text-gray-500">Pendente</span>
                <button type="button"
                  onClick={() => setForm(f => ({
                    ...f, status: f.status === 'pendente'
                      ? (f.tipo === 'receita' ? 'recebido' : 'pago')
                      : 'pendente'
                  }))}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    form.status !== 'pendente' ? 'bg-green-600' : 'bg-gray-300'
                  }`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    form.status !== 'pendente' ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-sm text-gray-700">
                  {form.tipo === 'receita' ? 'Recebido' : 'Pago'}
                </span>
              </div>

              {/* Nº Doc. Referência */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Doc. Referência</label>
                <input value={form.notaRef} onChange={e => setForm(f => ({ ...f, notaRef: e.target.value }))}
                  placeholder="Nota Fiscal, Cheque, Boleto, etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              {/* Propriedade */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId}
                  onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>

              {/* Safra (obrigatória) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Safra <span className="text-red-500">*</span>
                </label>
                <select value={form.safraId}
                  onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione a safra...</option>
                  {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>

              {/* Botões */}
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