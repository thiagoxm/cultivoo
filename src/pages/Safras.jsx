import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Layers } from 'lucide-react'

const culturas = ['Soja', 'Milho', 'Cana-de-açúcar', 'Café', 'Algodão', 'Arroz', 'Feijão', 'Trigo', 'Sorgo', 'Outro']
const statusOpts = ['Planejada', 'Em andamento', 'Colhida']

export default function Safras() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    nome: '', cultura: '', propriedadeId: '', lavouraIds: [],
    dataPlantio: '', dataColheitaPrev: '', status: 'Planejada'
  })
  const [loading, setLoading] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [safSnap, propSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])
    setLista(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  const lavourasDaPropriedade = lavouras.filter(l => l.propriedadeId === form.propriedadeId)

  function toggleLavoura(id) {
    setForm(f => ({
      ...f,
      lavouraIds: f.lavouraIds.includes(id)
        ? f.lavouraIds.filter(x => x !== id)
        : [...f.lavouraIds, id]
    }))
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.propriedadeId) return alert('Selecione uma propriedade.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    const lavsSelecionadas = lavouras.filter(l => form.lavouraIds.includes(l.id)).map(l => l.nome)
    await addDoc(collection(db, 'safras'), {
      ...form,
      propriedadeNome: prop?.nome || '',
      lavouraNomes: lavsSelecionadas,
      uid: usuario.uid,
      criadoEm: new Date()
    })
    setModal(false)
    setForm({ nome: '', cultura: '', propriedadeId: '', lavouraIds: [], dataPlantio: '', dataColheitaPrev: '', status: 'Planejada' })
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir esta safra?')) return
    await deleteDoc(doc(db, 'safras', id))
    await carregar()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Safras</h1>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
          <Plus size={16} /> Nova safra
        </button>
      </div>

      {lista.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Layers size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma safra cadastrada ainda.</p>
        </div>
      )}

      <div className="grid gap-4">
        {lista.map(s => (
          <div key={s.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-800">{s.nome}</p>
              <p className="text-sm text-gray-500">{s.cultura} · {s.propriedadeNome}</p>
              {s.lavouraNomes?.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">Lavouras: {s.lavouraNomes.join(', ')}</p>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                s.status === 'Em andamento' ? 'bg-green-100 text-green-700' :
                s.status === 'Planejada' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-500'
              }`}>{s.status}</span>
            </div>
            <button onClick={() => excluir(s.id)} className="text-red-400 hover:text-red-600 p-2">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Nova safra</h2>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da safra</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Soja 2024/25"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cultura</label>
                <select value={form.cultura} onChange={e => setForm(f => ({ ...f, cultura: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {culturas.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId}
                  onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value, lavouraIds: [] }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              {lavourasDaPropriedade.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Lavouras</label>
                  <div className="space-y-2">
                    {lavourasDaPropriedade.map(l => (
                      <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox"
                          checked={form.lavouraIds.includes(l.id)}
                          onChange={() => toggleLavoura(l.id)}
                          className="accent-green-600" />
                        {l.nome} ({l.areaHa} ha)
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de plantio</label>
                  <input type="date" value={form.dataPlantio} onChange={e => setForm(f => ({ ...f, dataPlantio: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Previsão de colheita</label>
                  <input type="date" value={form.dataColheitaPrev} onChange={e => setForm(f => ({ ...f, dataColheitaPrev: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {statusOpts.map(s => <option key={s}>{s}</option>)}
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