import { useEffect, useState, useRef } from 'react'
import {
  collection, query, where, getDocs, addDoc,
  deleteDoc, doc, updateDoc, setDoc, getDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Plus, Trash2, MapPin, Pencil, Users, X,
  Share2, Check, AlertCircle, Map, Type, Maximize
} from 'lucide-react'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const iconeBusca = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const iconePropriedade = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const MEDIDAS = ['Hectare', 'Acre', 'Alqueire (2,42 ha)']
const NIVEIS_COMPARTILHAMENTO = [
  {
    key: 'operacional',
    label: 'Operacional',
    descricao: 'Lavouras, Safras, Estoque e Produção',
    permissoes: ['lavouras', 'safras', 'estoque', 'estoqueProducao', 'producao'],
    cor: 'green',
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    descricao: 'Operacional + Financeiro',
    permissoes: ['lavouras', 'safras', 'estoque', 'estoqueProducao', 'producao', 'financeiro'],
    cor: 'blue',
  },
  {
    key: 'total',
    label: 'Total',
    descricao: 'Tudo, incluindo Dashboard e Indicadores',
    permissoes: ['lavouras', 'safras', 'estoque', 'estoqueProducao', 'producao', 'financeiro', 'dashboard', 'indicadores'],
    cor: 'purple',
  },
]

const FORM_PADRAO = {
  nome: '', cidade: '', estado: '', medida: 'Hectare',
  modoInsercao: 'mapa', // 'mapa' ou 'manual'
  camadaMapa: 'satelite', // 'normal' ou 'satelite'
}

// Componente para mover o mapa ao buscar cidade
function ControladorMapa({ centro }) {
  const map = useMap()
  useEffect(() => {
    if (centro) map.setView([centro.lat, centro.lng], 13)
  }, [centro])
  return null
}

// Componente para capturar clique no mapa
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
  const { usuario, propriedadesCompartilhadas, carregarCompartilhadas } = useAuth()
  const [lista, setLista] = useState([])
  const [compartilhadas, setCompartilhadas] = useState([])
  const [convitesPendentes, setConvitesPendentes] = useState([])
  const [modal, setModal] = useState(false)
  const [modalCompartilhar, setModalCompartilhar] = useState(false)
  const [propriedadeSelecionada, setPropriedadeSelecionada] = useState(null)
  const [editando, setEditando] = useState(null)
  const [pin, setPin] = useState(null)
  const [centroBusca, setCentroBusca] = useState(null)
  const [buscaCidade, setBuscaCidade] = useState('')
  const [buscandoCidade, setBuscandoCidade] = useState(false)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [fabAberto, setFabAberto] = useState(false)
  const [mapaFullscreen, setMapaFullscreen] = useState(false)
  const [pinBusca, setPinBusca] = useState(null)
  const [sugestoesCidade, setSugestoesCidade] = useState([])
  const [buscandoSugestoes, setBuscandoSugestoes] = useState(false)
  const [dropdownCidadeAberto, setDropdownCidadeAberto] = useState(false)
  const timeoutBusca = useRef(null)

  // Estado de compartilhamento
  const [emailConvidado, setEmailConvidado] = useState('')
  const [nivelCompartilhamento, setNivelCompartilhamento] = useState('operacional')
  const [loadingConvite, setLoadingConvite] = useState(false)
  const [erroConvite, setErroConvite] = useState('')
  const [sucessoConvite, setSucessoConvite] = useState(false)

  async function carregar() {
    const uid = usuario.uid
    const email = usuario.email

    // Propriedades próprias
    const propSnap = await getDocs(
      query(collection(db, 'propriedades'), where('uid', '==', uid))
    )
    setLista(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))

    // Todos os convites do email (único where — sem índice composto)
    const todosConvitesSnap = await getDocs(
      query(collection(db, 'convites'), where('emailConvidado', '==', email))
    )
    const todosConvites = todosConvitesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Filtrar por status no JS
    const convAceitos = todosConvites.filter(c => c.status === 'aceito')
    const convPendentes = todosConvites.filter(c => c.status === 'pendente')

    // Carregar propriedades compartilhadas aceitas
    const propCompartilhadas = []
    for (const conv of convAceitos) {
      const propDoc = await getDoc(doc(db, 'propriedades', conv.propriedadeId))
      if (propDoc.exists()) {
        propCompartilhadas.push({
          id: propDoc.id,
          ...propDoc.data(),
          _compartilhada: true,
          _nivel: conv.nivel || 'operacional',
          _permissoes: conv.permissoes || [],
          _proprietarioNome: conv.proprietarioNome || '',
        })
      }
    }
    setCompartilhadas(propCompartilhadas)
    setConvitesPendentes(convPendentes)
  }

  useEffect(() => { carregar() }, [])

  // Busca cidade no mapa
  async function buscarCidade() {
    if (!buscaCidade.trim()) return
    setBuscandoCidade(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(buscaCidade)}&format=json&limit=1`
      )
      const data = await res.json()
      if (data.length > 0) {
        const centro = { lat: Number(data[0].lat), lng: Number(data[0].lon) }
        setCentroBusca(centro)
        setPinBusca(centro) // ← pino no resultado
      } else {
        alert('Cidade não encontrada. Tente um nome diferente.')
      }
    } catch {
      alert('Erro ao buscar cidade.')
    } finally {
      setBuscandoCidade(false)
    }
  }

  // Busca cidade no campo manual
  async function buscarSugestoesCidade(texto) {
    if (texto.length < 2) {
      setSugestoesCidade([])
      setDropdownCidadeAberto(false)
      return
    }
    setBuscandoSugestoes(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(texto)}&format=json&limit=6&countrycodes=br&featuretype=city&addressdetails=1`
      )
      const data = await res.json()
      const sugestoes = data
        .filter(item => item.address)
        .map(item => {
          const cidade = item.address.city
            || item.address.town
            || item.address.village
            || item.address.municipality
            || item.name
            || ''
          const estado = item.address.state || ''
          return {
            cidade,
            estado,
            lat: Number(item.lat),
            lng: Number(item.lon),
          }
        })
        .filter(s => s.cidade) // remove itens sem cidade
      setSugestoesCidade(sugestoes)
      setDropdownCidadeAberto(sugestoes.length > 0)
    } catch {
      setSugestoesCidade([])
    } finally {
      setBuscandoSugestoes(false)
    }
  }

function onChangeCidade(texto) {
  setForm(f => ({ ...f, cidade: texto }))
  clearTimeout(timeoutBusca.current)
  timeoutBusca.current = setTimeout(() => buscarSugestoesCidade(texto), 350)
}

function selecionarSugestaoCidade(sugestao) {
  setForm(f => ({ ...f, cidade: sugestao.cidade, estado: sugestao.estado }))
  setSugestoesCidade([])
  setDropdownCidadeAberto(false)
}

  function selecionarPin({ lat, lng, cidade, estado }) {
    setPin({ lat, lng })
    setCentroBusca({ lat, lng }) // ← centraliza no pino selecionado
    setPinBusca(null) // ← remove pino de busca ao confirmar localização
    setForm(f => ({ ...f, cidade, estado }))
  }

        function abrirModal() {
      setEditando(null)
      setForm(FORM_PADRAO)
      setPin(null)
      setPinBusca(null)      // ← adicionar
      setCentroBusca(null)
      setBuscaCidade('')
      setFabAberto(false)
      setModal(true)
    }

    function abrirEdicao(p) {
    setEditando(p.id)
    setForm({
      nome: p.nome || '',
      cidade: p.cidade || '',
      estado: p.estado || '',
      medida: p.medida || 'Hectare',
      modoInsercao: p.lat ? 'mapa' : 'manual',
      camadaMapa: 'satelite',
    })
    setPin(p.lat ? { lat: p.lat, lng: p.lng } : null)
    setPinBusca(null)      // ← adicionar
    setCentroBusca(p.lat ? { lat: p.lat, lng: p.lng } : null)
    setBuscaCidade('')
    setModal(true)
  }

  async function salvar(e) {
    e.preventDefault()
    if (form.modoInsercao === 'mapa' && !pin) {
      return alert('Clique no mapa para selecionar a localização da propriedade.')
    }
    setLoading(true)
    const payload = {
      nome: form.nome,
      cidade: form.cidade,
      estado: form.estado,
      medida: form.medida,
      lat: pin?.lat || null,
      lng: pin?.lng || null,
      uid: usuario.uid,
    }
    if (editando) {
      await updateDoc(doc(db, 'propriedades', editando), payload)
    } else {
      await addDoc(collection(db, 'propriedades'), { ...payload, criadoEm: new Date() })
    }
    setModal(false)
    setEditando(null)
    setPin(null)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  function excluir(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir a propriedade "${nome}"?`,
      onConfirmar: async () => {
        await deleteDoc(doc(db, 'propriedades', id))
        await carregar()
      }
    })
  }

  // Compartilhamento
  function abrirCompartilhar(p) {
    setPropriedadeSelecionada(p)
    setEmailConvidado('')
    setNivelCompartilhamento('operacional')
    setErroConvite('')
    setSucessoConvite(false)
    setModalCompartilhar(true)
  }

  async function enviarConvite(e) {
    e.preventDefault()
    if (!emailConvidado.trim()) return
    if (emailConvidado === usuario.email) {
      return setErroConvite('Você não pode convidar a si mesmo.')
    }
    setLoadingConvite(true)
    setErroConvite('')
    try {
      // Verificar duplicata: buscar convites desta propriedade e filtrar no JS
      const existentesSnap = await getDocs(
        query(collection(db, 'convites'), where('proprietarioUid', '==', usuario.uid))
      )
      const emailNorm = emailConvidado.trim().toLowerCase()
      const jaExiste = existentesSnap.docs.some(d =>
        d.data().propriedadeId === propriedadeSelecionada.id &&
        d.data().emailConvidado === emailNorm
      )
      if (jaExiste) {
        setErroConvite('Já existe um convite enviado para este e-mail nesta propriedade.')
        setLoadingConvite(false)
        return
      }
      await addDoc(collection(db, 'convites'), {
        propriedadeId: propriedadeSelecionada.id,
        propriedadeNome: propriedadeSelecionada.nome,
        proprietarioUid: usuario.uid,
        proprietarioNome: usuario.displayName || usuario.email,
        emailConvidado: emailConvidado.trim().toLowerCase(),
        nivel: nivelCompartilhamento,
        permissoes: NIVEIS_COMPARTILHAMENTO.find(n => n.key === nivelCompartilhamento)?.permissoes || [],
        status: 'pendente',
        criadoEm: new Date(),
      })
      setSucessoConvite(true)
      setEmailConvidado('')
    } catch (err) {
      console.error('Erro ao enviar convite:', err)
      setErroConvite('Erro ao enviar convite. Tente novamente.')
    } finally {
      setLoadingConvite(false)
    }
  }

  // Aceitar/recusar convite
  async function responderConvite(conviteId, aceitar) {
    try {
      await updateDoc(doc(db, 'convites', conviteId), {
        status: aceitar ? 'aceito' : 'recusado',
        uidConvidado: usuario.uid,
        respondidoEm: new Date(),
      })

      // Atualizar acessos imediatamente para que carregar() funcione
      if (aceitar) {
        const todosConvitesSnap = await getDocs(
          query(collection(db, 'convites'), where('emailConvidado', '==', usuario.email))
        )
        const idsAceitos = todosConvitesSnap.docs
          .filter(d => d.data().status === 'aceito' || d.id === conviteId)
          .map(d => d.data().propriedadeId)
          .filter(Boolean)
        await setDoc(doc(db, 'acessos', usuario.uid), {
          uid: usuario.uid,
          email: usuario.email,
          propriedadeIds: idsAceitos,
          atualizadoEm: new Date(),
        })
        // Atualizar contexto global para todas as páginas recarregarem
        await carregarCompartilhadas(usuario)
      }

      await carregar()
    } catch (err) {
      console.error('Erro ao responder convite:', err.code, err.message)
    }
  }

  const todasPropriedades = [...lista, ...compartilhadas]

  return (
    <div className="space-y-6 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Propriedades</h1>

      {/* Banner convites pendentes */}
      {convitesPendentes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">
              {convitesPendentes.length === 1
                ? 'Você tem 1 convite pendente'
                : `Você tem ${convitesPendentes.length} convites pendentes`}
            </p>
          </div>
          {convitesPendentes.map(c => (
            <div key={c.id}
              className="bg-white rounded-lg px-4 py-3 flex items-center justify-between gap-3 border border-amber-100">
              <div>
                <p className="text-sm font-medium text-gray-800">{c.propriedadeNome}</p>
                <p className="text-xs text-gray-500">
                  Convidado por {c.proprietarioNome} · Nível: {NIVEIS_COMPARTILHAMENTO.find(n => n.key === c.nivel)?.label || c.nivel || 'Operacional'}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => responderConvite(c.id, true)}
                  className="flex items-center gap-1 text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg hover:bg-green-800">
                  <Check size={12} /> Aceitar
                </button>
                <button onClick={() => responderConvite(c.id, false)}
                  className="flex items-center gap-1 text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-300">
                  <X size={12} /> Recusar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lista de propriedades */}
      {todasPropriedades.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <MapPin size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma propriedade cadastrada ainda.</p>
        </div>
      )}

      <div className="grid gap-3">
        {todasPropriedades.map(p => (
          <div key={p.id}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-gray-800">{p.nome}</p>
                {p._compartilhada && (
                  <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full">
                    <Users size={10} />
                    Compartilhada
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                {p.cidade}{p.estado ? `, ${p.estado}` : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Medida: {p.medida}</p>
              {p._compartilhada && p._proprietarioNome && (
                <p className="text-xs text-blue-500 mt-0.5">De: {p._proprietarioNome}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {!p._compartilhada && (
                <>
                  <button onClick={() => abrirCompartilhar(p)}
                    className="text-gray-300 hover:text-blue-500 p-1.5 transition-colors" title="Compartilhar">
                    <Share2 size={15} />
                  </button>
                  <button onClick={() => abrirEdicao(p)}
                    className="text-gray-300 hover:text-blue-500 p-1.5 transition-colors" title="Editar">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => excluir(p.id, p.nome)}
                    className="text-gray-300 hover:text-red-500 p-1.5 transition-colors" title="Excluir">
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

            {/* FAB flutuante */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">
                Nova propriedade
              </span>
              <button onClick={abrirModal}
                className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90 transition-all"
                style={{ background: 'var(--brand-gradient)' }}>
                <Plus size={18} />
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setFabAberto(!fabAberto)}
          className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${
            fabAberto ? 'rotate-45' : ''
          }`}
          style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}>
          <Plus size={24} />
        </button>
      </div>

      {/* Mapa fullscreen */}
      {mapaFullscreen && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
            <p className="text-white text-sm font-medium">
              {pin ? '✓ Localização selecionada — feche para confirmar' : 'Clique no mapa para selecionar a localização'}
            </p>
            <div className="flex items-center gap-2">
              {/* Busca cidade no fullscreen */}
              <div className="flex gap-2">
                <input
                  value={buscaCidade}
                  onChange={e => setBuscaCidade(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarCidade())}
                  placeholder="Buscar cidade..."
                  className="border border-gray-600 bg-gray-800 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 w-48"
                />
                <button type="button" onClick={buscarCidade} disabled={buscandoCidade}
                  className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs hover:bg-green-800 disabled:opacity-50">
                  {buscandoCidade ? '...' : 'Ir'}
                </button>
              </div>
              {/* Toggle camada */}
              {[
                { val: 'normal', label: 'Mapa' },
                { val: 'satelite', label: 'Satélite' },
              ].map(c => (
                <button key={c.val} type="button"
                  onClick={() => setForm(f => ({ ...f, camadaMapa: c.val }))}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    form.camadaMapa === c.val
                      ? 'bg-green-700 text-white border-green-700'
                      : 'border-gray-600 text-gray-300 hover:border-green-500'
                  }`}>
                  {c.label}
                </button>
              ))}
              <button type="button" onClick={() => setMapaFullscreen(false)}
                className="ml-2 text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1">
                <X size={13} /> Fechar
              </button>
            </div>
          </div>
          <div className="flex-1">
            <MapContainer
              center={centroBusca ? [centroBusca.lat, centroBusca.lng] : pin ? [pin.lat, pin.lng] : [-15.7801, -47.9292]}
              zoom={centroBusca ? 13 : pin ? 13 : 5}
              style={{ height: '100%', width: '100%' }}>
              {form.camadaMapa === 'normal' ? (
                <TileLayer
                  key="fs-normal"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="© OpenStreetMap"
                />
              ) : (
                <>
                  <TileLayer
                    key="fs-satelite-base"
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="© Esri"
                    maxZoom={19}
                  />
                  <TileLayer
                    key="fs-satelite-labels"
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    maxZoom={19}
                  />
                </>
              )}
              <SeletorPin onSelect={selecionarPin} />
              {centroBusca && <ControladorMapa centro={centroBusca} />}
              {/* Pino de busca — azul */}
              {pinBusca && !pin && (
                <Marker position={[pinBusca.lat, pinBusca.lng]} icon={iconeBusca} />
              )}
              {/* Pino da propriedade selecionada — verde */}
              {pin && (
                <Marker position={[pin.lat, pin.lng]} icon={iconePropriedade} />
              )}
            </MapContainer>
          </div>
        </div>
      )}

      {/* ── Modal criar/editar ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-800">
                {editando ? 'Editar propriedade' : 'Nova propriedade'}
              </h2>
              <button onClick={() => { setModal(false); setEditando(null) }}
                className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto flex-1">
              <form onSubmit={salvar} className="p-5 space-y-4">

                {/* Nome */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome da propriedade
                  </label>
                  <input value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>

                {/* Toggle modo de inserção */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Localização
                  </label>
                  <div className="flex gap-2">
                    {[
                      { val: 'mapa', icon: Map, label: 'Selecionar no mapa' },
                      { val: 'manual', icon: Type, label: 'Inserir manualmente' },
                    ].map(op => (
                      <button key={op.val} type="button"
                        onClick={() => setForm(f => ({ ...f, modoInsercao: op.val }))}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm border-2 transition-colors ${
                          form.modoInsercao === op.val
                            ? 'border-green-600 bg-green-50 text-green-700 font-medium'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        <op.icon size={14} />
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modo mapa */}
                {form.modoInsercao === 'mapa' && (
                  <div className="space-y-2">
                    {/* Toggle camada */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">Clique no mapa para marcar a localização</p>
                      <div className="flex items-center gap-1">
                        {[
                          { val: 'normal', label: 'Mapa' },
                          { val: 'satelite', label: 'Satélite' },
                        ].map(c => (
                          <button key={c.val} type="button"
                            onClick={() => setForm(f => ({ ...f, camadaMapa: c.val }))}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              form.camadaMapa === c.val
                                ? 'bg-green-700 text-white border-green-700'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}>
                            {c.label}
                          </button>
                        ))}
                        <button type="button" onClick={() => setMapaFullscreen(true)}
                          className="ml-1 flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-green-400 hover:text-green-700 transition-colors">
                          <Maximize size={12} />
                          Tela cheia
                        </button>
                      </div>
                    </div>

                    {/* Campo busca de cidade */}
                    <div className="flex gap-2">
                      <input
                        value={buscaCidade}
                        onChange={e => setBuscaCidade(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarCidade())}
                        placeholder="Buscar cidade no mapa..."
                        className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <button type="button" onClick={buscarCidade} disabled={buscandoCidade}
                        className="px-3 py-2 bg-green-700 text-white rounded-xl text-sm hover:bg-green-800 disabled:opacity-50 whitespace-nowrap">
                        {buscandoCidade ? '...' : 'Ir'}
                      </button>
                    </div>

                    {/* Mapa */}
                    <div className="h-56 rounded-xl overflow-hidden border border-gray-200">
                      <MapContainer
                        center={centroBusca ? [centroBusca.lat, centroBusca.lng] : [-15.7801, -47.9292]}
                        zoom={centroBusca ? 13 : 5}
                        style={{ height: '100%', width: '100%' }}>
                        {form.camadaMapa === 'normal' ? (
                          <TileLayer
                            key="normal"
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution="© OpenStreetMap"
                          />
                        ) : (
                          <>
                            <TileLayer
                              key="satelite-base"
                              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                              attribution="© Esri"
                              maxZoom={19}
                            />
                            <TileLayer
                              key="satelite-labels"
                              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                              maxZoom={19}
                            />
                          </>
                        )}
                        <SeletorPin onSelect={selecionarPin} />
                        {centroBusca && <ControladorMapa centro={centroBusca} />}
                        {/* Pino de busca — azul */}
                        {pinBusca && !pin && (
                          <Marker position={[pinBusca.lat, pinBusca.lng]} icon={iconeBusca} />
                        )}
                        {/* Pino da propriedade selecionada — verde */}
                        {pin && (
                          <Marker position={[pin.lat, pin.lng]} icon={iconePropriedade} />
                        )}
                      </MapContainer>
                    </div>

                    {pin && (
                      <p className="text-xs text-green-700 font-medium">
                        ✓ Localização selecionada
                      </p>
                    )}
                  </div>
                )}

                {/* Modo manual */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                    <input
                      value={form.cidade}
                      onChange={e => form.modoInsercao === 'manual' ? onChangeCidade(e.target.value) : null}
                      onFocus={() => sugestoesCidade.length > 0 && setDropdownCidadeAberto(true)}
                      onBlur={() => setTimeout(() => setDropdownCidadeAberto(false), 200)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder={form.modoInsercao === 'mapa' ? 'Preenchido pelo mapa' : 'Digite para buscar...'}
                      readOnly={form.modoInsercao === 'mapa'}
                      autoComplete="off"
                    />
                    {/* Indicador de carregamento */}
                    {buscandoSugestoes && (
                      <div className="absolute right-3 top-9 text-gray-400">
                        <div className="w-3 h-3 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
                      </div>
                    )}
                    {/* Dropdown de sugestões */}
                    {dropdownCidadeAberto && sugestoesCidade.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
                        {sugestoesCidade.map((s, i) => (
                          <button key={i} type="button"
                            onMouseDown={() => selecionarSugestaoCidade(s)}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-green-50 transition-colors border-b border-gray-50 last:border-0">
                            <span className="font-medium text-gray-800">{s.cidade}</span>
                            {s.estado && <span className="text-gray-400 text-xs ml-1">— {s.estado}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                    <input value={form.estado}
                      onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder={form.modoInsercao === 'mapa' ? 'Preenchido pelo mapa' : 'UF'}
                      readOnly={form.modoInsercao === 'mapa'}
                    />
                  </div>
                </div>

                {/* Unidade de medida */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unidade de medida
                  </label>
                  <select value={form.medida}
                    onChange={e => setForm(f => ({ ...f, medida: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {MEDIDAS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button"
                    onClick={() => { setModal(false); setPin(null) }}
                    className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button type="submit" disabled={loading}
                    className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                    style={{ background: 'var(--brand-gradient)' }}>
                    {loading ? 'Salvando...' : editando ? 'Atualizar' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal compartilhar ── */}
      {modalCompartilhar && propriedadeSelecionada && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-800">Compartilhar propriedade</h2>
                <p className="text-xs text-gray-500 mt-0.5">{propriedadeSelecionada.nome}</p>
              </div>
              <button onClick={() => setModalCompartilhar(false)}
                className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {sucessoConvite ? (
              <div className="p-5 space-y-4">
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
                    <Check size={28} className="text-green-600" />
                  </div>
                  <p className="font-bold text-gray-800 mb-1">Convite enviado!</p>
                  <p className="text-sm text-gray-500">
                    O colaborador receberá o convite ao fazer login no Cultivoo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalCompartilhar(false)}
                  className="w-full text-white py-2.5 rounded-xl text-sm font-medium shadow-md"
                  style={{ background: 'var(--brand-gradient)' }}>
                  Concluir
                </button>
              </div>
            ) : (
            <form onSubmit={enviarConvite} className="p-5 space-y-4">

              {/* E-mail do convidado */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-mail do colaborador
                </label>
                <input
                  type="email"
                  value={emailConvidado}
                  onChange={e => { setEmailConvidado(e.target.value); setErroConvite(''); setSucessoConvite(false) }}
                  placeholder="colaborador@email.com"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>

              {/* Nível de acesso */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nível de acesso
                </label>
                <div className="space-y-2">
                  {NIVEIS_COMPARTILHAMENTO.map(nivel => {
                    const cores = {
                      green: { borda: 'border-green-500 bg-green-50', texto: 'text-green-700', badge: 'bg-green-100 text-green-700' },
                      blue:  { borda: 'border-blue-500 bg-blue-50',   texto: 'text-blue-700',  badge: 'bg-blue-100 text-blue-700' },
                      purple:{ borda: 'border-purple-500 bg-purple-50',texto: 'text-purple-700',badge: 'bg-purple-100 text-purple-700' },
                    }
                    const cor = cores[nivel.cor] || cores.green
                    const selecionado = nivelCompartilhamento === nivel.key
                    return (
                      <label key={nivel.key}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors ${selecionado ? cor.borda : 'border-gray-200 hover:border-gray-300'}`}>
                        <input
                          type="radio"
                          name="nivel"
                          value={nivel.key}
                          checked={selecionado}
                          onChange={() => setNivelCompartilhamento(nivel.key)}
                          className="accent-green-600 w-4 h-4 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${selecionado ? cor.texto : 'text-gray-700'}`}>
                              {nivel.label}
                            </span>
                            {selecionado && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cor.badge}`}>
                                Selecionado
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{nivel.descricao}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {erroConvite && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-red-600 text-sm">{erroConvite}</p>
                </div>
              )}

              {sucessoConvite && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  <p className="text-green-700 text-sm font-medium">
                    Convite registrado! O colaborador verá ao fazer login.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModalCompartilhar(false)}
                  className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                  Fechar
                </button>
                <button type="submit" disabled={loadingConvite}
                  className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
                  style={{ background: 'var(--brand-gradient)' }}>
                  {loadingConvite ? 'Enviando...' : 'Enviar convite'}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Modal confirmação exclusão */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
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