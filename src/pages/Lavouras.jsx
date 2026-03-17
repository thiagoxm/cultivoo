import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { MapContainer, TileLayer, FeatureGroup } from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { Plus, Trash2, Sprout } from 'lucide-react'

const status = ['Ativa', 'Em preparo', 'Em pousio']

function calcularAreaHa(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0
  const R = 6371000
  let area = 0
  const n = latlngs.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const lat1 = latlngs[i].lat * Math.PI / 180
    const lat2 = latlngs[j].lat * Math.PI / 180
    const dLng = (latlngs[j].lng - latlngs[i].lng) * Math.PI / 180
    area += (dLng) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  area = Math.abs(area * R * R / 2)
  return (area / 10000).toFixed(2)
}

export default function Lavouras() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [modal, setModal] = useState(false)
  const [poligono, setPoligono] = useState(null)
  const [area, setArea] = useState(0)
  const [form, setForm] = useState({ nome: '', propriedadeId: '', status: 'Ativa' })
  const [loading, setLoading] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const [lavSnap, propSnap] = await Promise.all([
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
    ])
    setLista(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  function onDesenho(e) {
    const latlngs = e.layer.getLatLngs()[0]
    setPoligono(latlngs.map(p => ({ lat: p.lat, lng: p.lng })))
    setArea(calcularAreaHa(latlngs))
  }

  async function salvar(e) {
    e.preventDefault()
    if (!poligono) return alert('Desenhe a área da lavoura no mapa.')
    if (!form.propriedadeId) return alert('Selecione uma propriedade.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    await addDoc(collection(db, 'lavouras'), {
      ...form,
      propriedadeNome: prop?.nome || '',
      poligono,
      areaHa: Number(area),
      uid: usuario.uid,
      criadoEm: new Date()
    })
    setModal(false)
    setPoligono(null)
    setArea(0)
    setForm({ nome: '', propriedadeId: '', status: 'Ativa' })
    await carregar()
    setLoading(false)
  }

  async function excluir(id) {
    if (!confirm('Excluir esta lavoura?')) return
    await deleteDoc(doc(db, 'lavouras', id))
    await carregar()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Lavouras</h1>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800">
          <Plus size={16} /> Nova lavoura
        </button>
      </div>

      {lista.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Sprout size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma lavoura cadastrada ainda.</p>
        </div>
      )}

      <div className="grid gap-4">
        {lista.map(l => (
          <div key={l.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-800">{l.nome}</p>
              <p className="text-sm text-gray-500">{l.propriedadeNome}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-400">{l.areaHa} ha</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  l.status === 'Ativa' ? 'bg-green-100 text-green-700' :
                  l.status === 'Em preparo' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-500'
                }`}>{l.status}</span>
              </div>
            </div>
            <button onClick={() => excluir(l.id)} className="text-red-400 hover:text-red-600 p-2">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Nova lavoura</h2>
              <p className="text-sm text-gray-500 mt-1">Use o ícone de polígono no mapa para desenhar a área</p>
            </div>
            <div className="h-64">
              <MapContainer center={[-15.7801, -47.9292]} zoom={5} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FeatureGroup>
                  <EditControl
                    position="topright"
                    onCreated={onDesenho}
                    draw={{ rectangle: false, circle: false, circlemarker: false, marker: false, polyline: false }}
                  />
                </FeatureGroup>
              </MapContainer>
            </div>
            {area > 0 && (
              <div className="px-5 pt-3 text-sm text-green-700 font-medium">
                Área calculada: {area} hectares
              </div>
            )}
            <form onSubmit={salvar} className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome / descrição</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {status.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setModal(false); setPoligono(null); setArea(0) }}
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