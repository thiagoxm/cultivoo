import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, TrendingUp, TrendingDown, CheckCircle } from 'lucide-react'

const tiposReceita = ['Venda de grãos', 'Venda de gado', 'Arrendamento', 'Subsídio', 'Outro']
const tiposDespesa = ['Insumos', 'Combustível', 'Manutenção', 'Mão de obra', 'Arrendamento', 'Financiamento', 'Outro']
const abas = ['Lançamentos', 'Contas a pagar/receber', 'Fluxo de caixa']

export default function Financeiro() {
  const { usuario } = useAuth()
  const [aba, setAba] = useState('Lançamentos')
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [modal, setModal] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [form, setForm] = useState({
    descricao: '', tipo: 'despesa', categoria: '',
    data: '', valor: '', notaFiscal: '', propriedadeId: '',
    safraId: '', vencimento: '', status: 'pendente', ehConta: false
  })
  const [loading, setLoading] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [finSnap, propSnap, safSnap] = await Promise.all([
      getDocs(query(collection(db, 'financeiro'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
    ])
    setLista(finSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  async function salvar(e) {
    e.preventDefault()
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    const safra = safras.find(s => s.id === form.safraId)
    await addDoc(collection(db, 'financeiro'), {
      ...form,
      valor: Number(form.valor),
      propriedadeNome: prop?.nome || '',
      safraNome: safra?.nome || '',
      uid: usuario.uid,
      criadoEm: new Date()
    })
    setModal(false)
    setForm({ descricao: '', tipo: 'despesa', categoria: '', data: '', valor: '', notaFiscal: '', propriedadeId: '', safraId: '', vencimento: '', status: 'pendente', ehConta: false })
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir este lançamento?')) return
    await deleteDoc(doc(db, 'financeiro', id))
    await carregar()
  }

  async function marcarPago(id) {
    await updateDoc(doc(db, 'financeiro', id), { status: 'pago' })
    await carregar()
  }

  const lancamentos = lista.filter(l => !l.ehConta)
  const contas = lista.filter(l => l.ehConta)
  const totalReceitas = lancamentos.filter(l => l.tipo === 'receita').reduce((a, b) => a + (Number(b.valor) || 0), 0)
  const totalDespesas = lancamentos.filter(l => l.tipo === 'despesa').reduce((a, b) => a + (Number(b.valor) || 0), 0)

  // Fluxo de caixa por mês
  const fluxo = {}
  lancamentos.forEach(l => {
    if (!l.data) return
    const mes = l.data.substring(0, 7)
    if (!fluxo[mes]) fluxo[mes] = { receitas: 0, despesas: 0 }
    if (l.tipo === 'receita') fluxo[mes].receitas += Number(l.valor) || 0
    else fluxo[mes].despesas += Number(l.valor) || 0
  })
  const fluxoOrdenado = Object.entries(fluxo).sort((a, b) => a[0].localeCompare(b[0]))

  const listaFiltrada = filtroTipo === 'todos' ? lancamentos
    : lancamentos.filter(l => l.tipo === filtroTipo)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Financeiro</h1>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
          <Plus size={16} /> Novo lançamento
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-green-600" />
            <p className="text-xs text-gray-500">Total receitas</p>
          </div>
          <p className="text-lg font-bold text-green-600">R$ {totalReceitas.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={16} className="text-red-500" />
            <p className="text-xs text-gray-500">Total despesas</p>
          </div>
          <p className="text-lg font-bold text-red-500">R$ {totalDespesas.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-2 border-b border-gray-200">
        {abas.map(a => (
          <button key={a} onClick={() => setAba(a)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              aba === a ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a}
          </button>
        ))}
      </div>

      {/* Lançamentos */}
      {aba === 'Lançamentos' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {['todos', 'receita', 'despesa'].map(t => (
              <button key={t} onClick={() => setFiltroTipo(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                  filtroTipo === t ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {t === 'todos' ? 'Todos' : t === 'receita' ? 'Receitas' : 'Despesas'}
              </button>
            ))}
          </div>
          {listaFiltrada.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhum lançamento encontrado.
            </div>
          )}
          <div className="grid gap-3">
            {listaFiltrada.map(l => (
              <div key={l.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    l.tipo === 'receita' ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    {l.tipo === 'receita'
                      ? <TrendingUp size={16} className="text-green-600" />
                      : <TrendingDown size={16} className="text-red-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{l.descricao}</p>
                    <p className="text-xs text-gray-400">{l.categoria} · {l.data} · {l.propriedadeNome}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className={`text-sm font-bold ${l.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}`}>
                    {l.tipo === 'receita' ? '+' : '-'} R$ {Number(l.valor).toLocaleString('pt-BR')}
                  </p>
                  <button onClick={() => excluir(l.id)} className="text-red-300 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contas a pagar/receber */}
      {aba === 'Contas a pagar/receber' && (
        <div className="space-y-3">
          <button onClick={() => { setForm(f => ({ ...f, ehConta: true })); setModal(true) }}
            className="flex items-center gap-2 border border-green-600 text-green-700 px-4 py-2 rounded-lg text-sm hover:bg-green-50">
            <Plus size={16} /> Nova conta
          </button>
          {contas.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhuma conta cadastrada.
            </div>
          )}
          {contas.map(c => (
            <div key={c.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{c.descricao}</p>
                <p className="text-xs text-gray-400">Vence: {c.vencimento} · {c.tipo === 'receita' ? 'A receber' : 'A pagar'}</p>
                <p className="text-sm font-bold text-gray-700 mt-1">R$ {Number(c.valor).toLocaleString('pt-BR')}</p>
              </div>
              <div className="flex items-center gap-2">
                {c.status === 'pendente' && (
                  <button onClick={() => marcarPago(c.id)}
                    className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full hover:bg-green-200">
                    Marcar pago
                  </button>
                )}
                {c.status === 'pago' && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle size={14} /> Pago
                  </span>
                )}
                <button onClick={() => excluir(c.id)} className="text-red-300 hover:text-red-500">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fluxo de caixa */}
      {aba === 'Fluxo de caixa' && (
        <div className="space-y-3">
          {fluxoOrdenado.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100 text-sm">
              Nenhum dado disponível ainda.
            </div>
          )}
          {fluxoOrdenado.map(([mes, val]) => {
            const saldo = val.receitas - val.despesas
            const [ano, m] = mes.split('-')
            const nomeMes = new Date(Number(ano), Number(m) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
            return (
              <div key={mes} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <p className="font-semibold text-gray-700 capitalize mb-3">{nomeMes}</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-gray-400">Receitas</p>
                    <p className="text-sm font-bold text-green-600">R$ {val.receitas.toLocaleString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Despesas</p>
                    <p className="text-sm font-bold text-red-500">R$ {val.despesas.toLocaleString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Saldo</p>
                    <p className={`text-sm font-bold ${saldo >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      R$ {saldo.toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal lançamento */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{form.ehConta ? 'Nova conta' : 'Novo lançamento'}</h2>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-3">
              <div className="flex gap-3">
                {['despesa', 'receita'].map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                      form.tipo === t
                        ? t === 'receita' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                        : 'border-gray-300 text-gray-600'
                    }`}>
                    {t === 'receita' ? 'Receita' : 'Despesa'}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {(form.tipo === 'receita' ? tiposReceita : tiposDespesa).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {form.ehConta ? 'Vencimento' : 'Data'}
                  </label>
                  <input type="date"
                    value={form.ehConta ? form.vencimento : form.data}
                    onChange={e => setForm(f => form.ehConta ? { ...f, vencimento: e.target.value } : { ...f, data: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                  <input type="number" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                    placeholder="0,00" min="0" step="0.01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Nota fiscal</label>
                <input value={form.notaFiscal} onChange={e => setForm(f => ({ ...f, notaFiscal: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Safra (opcional)</label>
                <select value={form.safraId} onChange={e => setForm(f => ({ ...f, safraId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Nenhuma</option>
                  {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm hover:bg-green-800 disabled:opacity-50">
                  {loading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}