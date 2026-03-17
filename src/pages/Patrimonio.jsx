import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Tractor } from 'lucide-react'

const categorias = ['Equipamentos móveis', 'Equipamentos fixos', 'Veículos', 'Benfeitorias', 'Animais', 'Outros']

export default function Patrimonio() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    nome: '', categoria: '', propriedadeId: '',
    valor: '', dataAquisicao: '', numeroSerie: '', descricao: ''
  })
  const [loading, setLoading] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [patSnap, propSnap] = await Promise.all([
      getDocs(query(collection(db, 'patrimonios'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
    ])
    setLista(patSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  async function salvar(e) {
    e.preventDefault()
    if (!form.propriedadeId) return alert('Selecione uma propriedade.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    await addDoc(collection(db, 'patrimonios'), {
      ...form,
      valor: Number(form.valor),
      propriedadeNome: prop?.nome || '',
      uid: usuario.uid,
      criadoEm: new Date()
    })
    setModal(false)
    setForm({ nome: '', categoria: '', propriedadeId: '', valor: '', dataAquisicao: '', numeroSerie: '', descricao: '' })
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir este patrimônio?')) return
    await deleteDoc(doc(db, 'patrimonios', id))
    await carregar()
  }

  const totalGeral = lista.reduce((acc, p) => acc + (Number(p.valor) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Patrimônio</h1>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
          <Plus size={16} /> Novo item
        </button>
      </div>

      {totalGeral > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4">
          <p className="text-sm text-green-700">Patrimônio total estimado</p>
          <p className="text-2xl font-bold text-green-800">R$ {totalGeral.toLocaleString('pt-BR')}</p>
        </div>
      )}

      {lista.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Tractor size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum item de patrimônio cadastrado.</p>
        </div>
      )}

      <div className="grid gap-4">
        {lista.map(p => (
          <div key={p.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-800">{p.nome}</p>
              <p className="text-sm text-gray-500">{p.categoria} · {p.propriedadeNome}</p>
              {p.valor > 0 && (
                <p className="text-sm font-medium text-green-700 mt-1">R$ {Number(p.valor).toLocaleString('pt-BR')}</p>
              )}
              {p.descricao && <p className="text-xs text-gray-400 mt-1">{p.descricao}</p>}
            </div>
            <button onClick={() => excluir(p.id)} className="text-red-400 hover:text-red-600 p-2">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Novo item de patrimônio</h2>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Trator John Deere 5075E"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {categorias.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId} onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                  <input type="number" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                    placeholder="0,00" min="0" step="0.01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de aquisição</label>
                  <input type="date" value={form.dataAquisicao} onChange={e => setForm(f => ({ ...f, dataAquisicao: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de série</label>
                <input value={form.numeroSerie} onChange={e => setForm(f => ({ ...f, numeroSerie: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
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