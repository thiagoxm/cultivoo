import { useEffect, useState, useRef } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Plus, Trash2, MapPin } from 'lucide-react'

// Fix ícone padrão do Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const medidas = ['Hectare', 'Acre', 'Alqueire (2,42 ha)']

function SeletorPin({ onSelect }) {
  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
        )
        const data = await res.json()
        const cidade = data.address.city || data.address.town || data.address.village || ''
        const estado = data.address.state || ''
        onSelect({ lat, lng, cidade, estado })
      } catch {
        onSelect({ lat, lng, cidade: '', estado: '' })
      }
    }
  })
  return null
}

export default function Propriedades() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [modal, setModal] = useState(false)
  const [pin, setPin] = useState(null)
  const [form, setForm] = useState({ nome: '', cidade: '', estado: '', medida: 'Hectare' })
  const [loading, setLoading] = useState(false)

  async function carregar() {
    const q = query(collection(db, 'propriedades'), where('uid', '==', usuario.uid))
    const snap = await getDocs(q)
    setLista(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  function selecionarPin({ lat, lng, cidade, estado }) {
    setPin({ lat, lng })
    setForm(f => ({ ...f, cidade, estado }))
  }

  async function salvar(e) {
    e.preventDefault()
    if (!pin) return alert('Selecione a localização no mapa clicando sobre ela.')
    setLoading(true)
    await addDoc(collection(db, 'propriedades'), {
      ...form, lat: pin.lat, lng: pin.lng, uid: usuario.uid, criadoEm: new Date()
    })
    setModal(false)
    setPin(null)
    setForm({ nome: '', cidade: '', estado: '', medida: 'Hectare' })
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir esta propriedade?')) return
    await deleteDoc(doc(db, 'propriedades', id))
    await carregar()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Propriedades</h1>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800 transition-colors">
          <Plus size={16} /> Nova propriedade
        </button>
      </div>

      {lista.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <MapPin size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma propriedade cadastrada ainda.</p>
        </div>
      )}

      <div className="grid gap-4">
        {lista.map(p => (
          <div key={p.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-800">{p.nome}</p>
              <p className="text-sm text-gray-500">{p.cidade}{p.estado ? `, ${p.estado}` : ''}</p>
              <p className="text-xs text-gray-400 mt-1">Medida: {p.medida}</p>
            </div>
            <button onClick={() => excluir(p.id)} className="text-red-400 hover:text-red-600 p-2">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Nova propriedade</h2>
              <p className="text-sm text-gray-500 mt-1">Clique no mapa para definir a localização</p>
            </div>

            {/* Mapa */}
            <div className="h-56">
              <MapContainer center={[-15.7801, -47.9292]} zoom={5} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <SeletorPin onSelect={selecionarPin} />
                {pin && <Marker position={[pin.lat, pin.lng]} />}
              </MapContainer>
            </div>

            <form onSubmit={salvar} className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da propriedade</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                  <input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unidade de medida</label>
                <select value={form.medida} onChange={e => setForm(f => ({ ...f, medida: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {medidas.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModal(false); setPin(null) }}
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