import {
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  MapContainer, TileLayer, FeatureGroup,
  Marker, Polygon, Tooltip, useMap
} from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import {
  Plus, Trash2, Pencil, Sprout, X,
  ChevronDown, ChevronUp, Maximize2
} from 'lucide-react'
import { useEffect, useState, useMemo, useRef } from 'react'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const iconeProp = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
  popupAnchor: [1, -34], shadowSize: [41, 41],
})

if (typeof L !== 'undefined' && L.drawLocal) {
  L.drawLocal.draw.toolbar.actions.text = 'Cancelar'
  L.drawLocal.draw.toolbar.finish.text = 'Finalizar'
  L.drawLocal.draw.toolbar.undo.text = 'Apagar último ponto'
  L.drawLocal.draw.toolbar.buttons.polygon = 'Desenhar área'
  L.drawLocal.edit.toolbar.actions.save.text = 'Salvar'
  L.drawLocal.edit.toolbar.actions.cancel.text = 'Cancelar'
  L.drawLocal.edit.toolbar.actions.clearAll.text = 'Apagar tudo'
  L.drawLocal.edit.toolbar.buttons.edit = 'Editar área'
  L.drawLocal.edit.toolbar.buttons.editDisabled = 'Nenhuma área para editar'
  L.drawLocal.edit.toolbar.buttons.remove = 'Apagar área'
  L.drawLocal.edit.toolbar.buttons.removeDisabled = 'Nenhuma área para apagar'
  L.drawLocal.draw.handlers.polygon.tooltip.start = 'Clique para iniciar o desenho'
  L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Clique para continuar'
  L.drawLocal.draw.handlers.polygon.tooltip.end = 'Clique no primeiro ponto para fechar'
}

const STATUS_OPTS = ['Ativa', 'Em preparo', 'Ociosa']

const CORES_LAVOURA = [
  '#e63946', '#2a9d8f', '#e9c46a', '#f4a261',
  '#457b9d', '#8ecae6', '#6a4c93', '#f72585',
  '#80b918', '#fb8500', '#023e8a', '#7b2d8b',
]

function corLavoura(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return CORES_LAVOURA[Math.abs(hash) % CORES_LAVOURA.length]
}

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
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs(area * R * R / 2 / 10000)
}

function converterArea(ha, medida) {
  if (medida === 'Acre') return (ha * 2.47105).toFixed(2)
  if (medida === 'Alqueire (2,42 ha)') return (ha / 2.42).toFixed(2)
  return Number(ha || 0).toFixed(2)
}

function labelMedida(medida) {
  if (medida === 'Acre') return 'ac'
  if (medida === 'Alqueire (2,42 ha)') return 'alq'
  return 'ha'
}

function corStatus(status) {
  if (status === 'Ativa') return 'bg-green-100 text-green-700'
  if (status === 'Em preparo') return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-500'
}

function CentralizarMapa({ centro, zoom = 14 }) {
  const map = useMap()
  useEffect(() => {
    if (centro) map.setView([centro.lat, centro.lng], zoom)
  }, [centro])
  return null
}

function TileLayers({ camada }) {
  return camada === 'normal' ? (
    <TileLayer key="normal"
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution="© OpenStreetMap" />
  ) : (
    <>
      <TileLayer key="sat-base"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="© Esri" maxZoom={19} />
      <TileLayer key="sat-labels"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19} />
    </>
  )
}

// ─── Desenho nativo sem react-leaflet-draw ────────────────────────────────────
function DesenhoPoligono({ onCreated, poligonoInicial, centroProp }) {
  const map = useMap()
  const camadaRef = useRef(null)
  const drawRef = useRef(null)
  const poligonoBackupRef = useRef(null) // salva polígono antes de editar/redesenhar
  const [temPoligono, setTemPoligono] = useState(!!poligonoInicial?.length)
  const [estado, setEstado] = useState('normal') // 'normal' | 'desenhando' | 'editando'
  const [confirmarApagar, setConfirmarApagar] = useState(false)

  // Zoom + centraliza + carrega polígono existente ao montar
  useEffect(() => {
    if (centroProp) map.setView([centroProp.lat, centroProp.lng], 16)
    if (poligonoInicial?.length > 2) {
      if (camadaRef.current) map.removeLayer(camadaRef.current)
      const latlngs = poligonoInicial.map(p => [p.lat, p.lng])
      camadaRef.current = L.polygon(latlngs, {
        color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.3
      }).addTo(map)
      setTemPoligono(true)
    }
    return () => {
      if (drawRef.current) { try { drawRef.current.disable() } catch {} }
    }
  }, [])

  function centralizar() {
    if (centroProp) map.setView([centroProp.lat, centroProp.lng], 16)
  }

  // Inicia desenho (novo ou redesenhar)
  function iniciarDesenho() {
    // Salva backup do polígono atual antes de apagar
    if (camadaRef.current) {
      poligonoBackupRef.current = camadaRef.current.getLatLngs()
      map.removeLayer(camadaRef.current)
      camadaRef.current = null
    } else {
      poligonoBackupRef.current = null
    }
    if (drawRef.current) { try { drawRef.current.disable() } catch {} }
    setEstado('desenhando')

    const draw = new L.Draw.Polygon(map, {
      shapeOptions: { color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.3 },
      showArea: true,
    })
    drawRef.current = draw
    draw.enable()

    map.once('draw:created', (e) => {
      camadaRef.current = e.layer
      map.addLayer(e.layer)
      setTemPoligono(true)
      setEstado('normal')
      poligonoBackupRef.current = null
      onCreated(e)
    })
  }

  // Cancela desenho em andamento — restaura polígono anterior se existia
  function cancelarDesenho() {
    if (drawRef.current) { try { drawRef.current.disable() } catch {} }
    drawRef.current = null

    // Remove camada parcial que possa ter sido adicionada
    if (camadaRef.current) {
      map.removeLayer(camadaRef.current)
      camadaRef.current = null
    }

    // Restaura polígono anterior se havia backup
    if (poligonoBackupRef.current) {
      camadaRef.current = L.polygon(poligonoBackupRef.current, {
        color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.3
      }).addTo(map)
      setTemPoligono(true)
    } else {
      setTemPoligono(false)
      onCreated({ layer: null })
    }
    poligonoBackupRef.current = null
    setEstado('normal')
  }

  // Inicia edição dos pontos do polígono existente
  function iniciarEdicao() {
    if (!camadaRef.current) return
    // Serializa os pontos como coordenadas simples ANTES de habilitar edição
    // Isso garante que o backup não seja afetado pelas mudanças do modo editing
    const latlngs = camadaRef.current.getLatLngs()[0]
    poligonoBackupRef.current = latlngs.map(p => ({ lat: p.lat, lng: p.lng }))
    if (camadaRef.current.editing) {
      camadaRef.current.editing.enable()
      setEstado('editando')
    }
  }

  // Salva edição — confirma os novos pontos
  function salvarEdicao() {
    if (!camadaRef.current) return
    if (camadaRef.current.editing) camadaRef.current.editing.disable()
    poligonoBackupRef.current = null
    setEstado('normal')
    onCreated({ layer: camadaRef.current })
  }

  // Cancela edição — restaura pontos originais
  function cancelarEdicao() {
      if (!camadaRef.current) return
      // Desativa modo edição sem salvar
      if (camadaRef.current.editing) camadaRef.current.editing.disable()
      // Remove camada modificada
      map.removeLayer(camadaRef.current)
      camadaRef.current = null
      // Recria com coordenadas serializadas do backup
      if (poligonoBackupRef.current?.length > 0) {
        const latlngs = poligonoBackupRef.current.map(p => [p.lat, p.lng])
        camadaRef.current = L.polygon(latlngs, {
          color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.3
        }).addTo(map)
        setTemPoligono(true)
      } else {
        setTemPoligono(false)
      }
      poligonoBackupRef.current = null
      setEstado('normal')
    }

  // Confirma apagar polígono
  function confirmarApagarPoligono() {
    if (camadaRef.current) {
      map.removeLayer(camadaRef.current)
      camadaRef.current = null
    }
    setTemPoligono(false)
    setConfirmarApagar(false)
    onCreated({ layer: null })
  }

  // Estilo base dos botões
  const btnBase = "flex items-center gap-1.5 text-xs bg-white border border-gray-300 shadow-md px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"

  return (
    <>
      {/* Botões de controle — canto superior direito */}
      <div className="leaflet-top leaflet-right" style={{ marginTop: '10px', marginRight: '10px' }}>
        <div className="leaflet-control flex flex-col gap-1.5">

          {/* ── Estado normal ── */}
          {estado === 'normal' && (
            <>
              {centroProp && (
                <button onClick={centralizar}
                  className={`${btnBase} hover:bg-blue-50 hover:border-blue-400 text-gray-700`}
                  style={{ zIndex: 1000 }}>
                  🎯 Centralizar
                </button>
              )}
              <button onClick={iniciarDesenho}
                className={`${btnBase} hover:bg-green-50 hover:border-green-400 text-gray-700`}
                style={{ zIndex: 1000 }}>
                ✏️ {temPoligono ? 'Redesenhar área' : 'Desenhar área'}
              </button>
              {temPoligono && (
                <button onClick={iniciarEdicao}
                  className={`${btnBase} hover:bg-yellow-50 hover:border-yellow-400 text-gray-700`}
                  style={{ zIndex: 1000 }}>
                  🔧 Editar área
                </button>
              )}
              {temPoligono && (
                <button onClick={() => setConfirmarApagar(true)}
                  className={`${btnBase} hover:bg-red-50 hover:border-red-400 text-gray-500`}
                  style={{ zIndex: 1000 }}>
                  🗑️ Apagar área
                </button>
              )}
            </>
          )}

          {/* ── Estado desenhando ── */}
          {estado === 'desenhando' && (
            <>
              <div className="flex items-center gap-1.5 text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg shadow-md whitespace-nowrap">
                ⬡ Clique para desenhar...
              </div>
              <button onClick={cancelarDesenho}
                className={`${btnBase} hover:bg-red-50 hover:border-red-400 text-red-500`}
                style={{ zIndex: 1000 }}>
                ✕ {poligonoBackupRef.current ? 'Descartar e restaurar' : 'Cancelar desenho'}
              </button>
            </>
          )}

          {/* ── Estado editando ── */}
          {estado === 'editando' && (
            <>
              <div className="flex items-center gap-1.5 text-xs bg-yellow-500 text-white px-3 py-1.5 rounded-lg shadow-md whitespace-nowrap">
                🔧 Arraste os pontos...
              </div>
              <button onClick={salvarEdicao}
                className={`${btnBase} hover:bg-green-50 hover:border-green-400 text-green-700`}
                style={{ zIndex: 1000 }}>
                ✓ Salvar edição
              </button>
              <button onClick={cancelarEdicao}
                className={`${btnBase} hover:bg-red-50 hover:border-red-400 text-red-500`}
                style={{ zIndex: 1000 }}>
                ✕ Descartar edição
              </button>
            </>
          )}

        </div>
      </div>

      {/* ── Popup confirmação apagar ── */}
      {confirmarApagar && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px'
          }}>
          <div style={{
            background: '#fff', borderRadius: '16px',
            padding: '24px', maxWidth: '320px', width: '100%',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ fontWeight: 700, color: '#1f2937', marginBottom: '8px', fontSize: '15px' }}>
              Apagar área?
            </h3>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
              O polígono desta lavoura será removido.
            </p>
            <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '20px' }}>
              Esta ação não poderá ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setConfirmarApagar(false)}
                style={{
                  flex: 1, padding: '8px', borderRadius: '10px',
                  border: '1px solid #d1d5db', background: '#fff',
                  color: '#6b7280', fontSize: '13px', cursor: 'pointer'
                }}>
                Cancelar
              </button>
              <button
                onClick={confirmarApagarPoligono}
                style={{
                  flex: 1, padding: '8px', borderRadius: '10px',
                  border: 'none', background: '#dc2626',
                  color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                }}>
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const FORM_PADRAO = {
  nome: '', status: 'Ativa', propriedadeId: '',
  modoArea: 'mapa', areaManual: '',
  camadaMapa: 'satelite',
}

export default function Lavouras() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [modal, setModal] = useState(false)
  const [mapaFullscreen, setMapaFullscreen] = useState(false)
  const [miniMapaFullscreen, setMiniMapaFullscreen] = useState(null)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [poligono, setPoligono] = useState(null)
  const [areaHa, setAreaHa] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)
  const [mapaExpandido, setMapaExpandido] = useState({})
  // ← CORRIGIDO: mapaKey DENTRO do componente
  const [mapaKey, setMapaKey] = useState(0)

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

  useEffect(() => {
    document.body.style.overflow = modal || mapaFullscreen || miniMapaFullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [modal, mapaFullscreen, miniMapaFullscreen])

  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-lav]')) setDropdownFiltroAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const propSelecionada = useMemo(() =>
    propriedades.find(p => p.id === form.propriedadeId),
    [propriedades, form.propriedadeId]
  )
  const medidaProp = propSelecionada?.medida || 'Hectare'
  const centroProp = useMemo(() => {
    if (propSelecionada?.lat && propSelecionada?.lng)
      return { lat: propSelecionada.lat, lng: propSelecionada.lng }
    return null
  }, [propSelecionada])

  const listaFiltrada = useMemo(() => {
    if (filtroPropriedadeIds.length === 0) return lista
    return lista.filter(l => filtroPropriedadeIds.includes(l.propriedadeId))
  }, [lista, filtroPropriedadeIds])

  const agrupado = useMemo(() => {
    const grupos = {}
    listaFiltrada.forEach(l => {
      const propId = l.propriedadeId || ''
      const prop = propriedades.find(p => p.id === propId)
      const propNome = prop?.nome || 'Sem propriedade'
      const medida = prop?.medida || 'Hectare'
      if (!grupos[propId]) grupos[propId] = { propNome, medida, lavouras: [] }
      grupos[propId].lavouras.push(l)
    })
    return Object.entries(grupos).sort((a, b) =>
      a[1].propNome.localeCompare(b[1].propNome)
    )
  }, [listaFiltrada, propriedades])

  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
    setPoligono(null)
    setAreaHa(0)
    setFabAberto(false)
    setModal(true)
  }

  function abrirEdicao(l) {
    setEditando(l.id)
    const prop = propriedades.find(p => p.id === l.propriedadeId)
    const haOriginal = Number(l.areaHa) || 0
    const areaConvertida = converterArea(haOriginal, prop?.medida || 'Hectare')
    setForm({
      nome: l.nome || '',
      status: l.status || 'Ativa',
      propriedadeId: l.propriedadeId || '',
      modoArea: l.poligono?.length > 0 ? 'mapa' : 'manual',
      areaManual: l.poligono?.length > 0 ? '' : areaConvertida,
      camadaMapa: 'satelite',
    })
    setPoligono(l.poligono || null)
    setAreaHa(haOriginal)
    setModal(true)
  }

  function onDesenho(e) {
    if (!e.layer) {
      setPoligono(null)
      setAreaHa(0)
      return
    }
    const latlngs = e.layer.getLatLngs()[0]
    const coords = latlngs.map(p => ({ lat: p.lat, lng: p.lng }))
    setPoligono(coords)
    setAreaHa(calcularAreaHa(latlngs))
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.propriedadeId) return alert('Selecione uma propriedade.')
    if (form.modoArea === 'mapa' && !poligono)
      return alert('Desenhe a área da lavoura no mapa.')
    if (form.modoArea === 'manual' && !form.areaManual)
      return alert('Informe a área da lavoura.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    let areaFinalHa = areaHa
    if (form.modoArea === 'manual') {
      const val = parseFloat(form.areaManual) || 0
      const medida = prop?.medida || 'Hectare'
      if (medida === 'Acre') areaFinalHa = val / 2.47105
      else if (medida === 'Alqueire (2,42 ha)') areaFinalHa = val * 2.42
      else areaFinalHa = val
    }
    const payload = {
      nome: form.nome,
      status: form.status,
      propriedadeId: form.propriedadeId,
      propriedadeNome: prop?.nome || '',
      poligono: form.modoArea === 'mapa' ? poligono : [],
      areaHa: Number(areaFinalHa.toFixed(4)),
      uid: usuario.uid,
    }
    if (editando) {
      await updateDoc(doc(db, 'lavouras', editando), payload)
    } else {
      await addDoc(collection(db, 'lavouras'), { ...payload, criadoEm: new Date() })
    }
    setModal(false)
    setEditando(null)
    setPoligono(null)
    setAreaHa(0)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  function excluir(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir a lavoura "${nome}"?`,
      onConfirmar: async () => {
        await deleteDoc(doc(db, 'lavouras', id))
        await carregar()
      }
    })
  }

  // ─── Mini-mapa com layout horizontal ────────────────────────────────────────
  function MiniMapaGrupo({ propId, grupo }) {
    const prop = propriedades.find(p => p.id === propId)
    const ativas = grupo.lavouras.filter(l => l.status === 'Ativa')
    const emPreparo = grupo.lavouras.filter(l => l.status === 'Em preparo')
    const ociosas = grupo.lavouras.filter(l =>
      l.status === 'Ociosa' || l.status === 'Em pousio' || l.status === 'Ociosa / Em pousio'
    )
    const temPoligonos = grupo.lavouras.some(l => l.poligono?.length > 2)
    const expandido = mapaExpandido[propId]
    const [situacaoExpandida, setSituacaoExpandida] = useState(false)

    const totalArea = grupo.lavouras.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)

    // Card de situação — usado em desktop e mobile
    function CardSituacao({ label, lavouras, corBadge }) {
      if (lavouras.length === 0) return null
      const area = lavouras.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
      return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col flex-1 min-w-0"
          style={{ minWidth: '120px' }}>
          <div className="flex items-center justify-center px-2 pt-2.5 pb-1.5">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${corBadge}`}>
              {label}
            </span>
          </div>
          <div className="h-px bg-gray-100 mx-2" />
          <div className="flex flex-col flex-1 items-center justify-evenly px-2 py-1.5">
            <div className="text-center">
              <p className="text-xs text-gray-400 leading-tight">Qtde. de Lavoura(s)</p>
              <p className="text-lg font-bold text-gray-800 leading-tight">{lavouras.length}</p>
            </div>
            <div className="w-8 h-px bg-gray-200" />
            <div className="text-center">
              <p className="text-xs text-gray-400 leading-tight">Área</p>
              <p className="text-lg font-bold text-gray-800 leading-tight">
                {converterArea(area, grupo.medida)}
                <span className="text-xs font-normal text-gray-400 ml-0.5">{labelMedida(grupo.medida)}</span>
              </p>
            </div>
          </div>
        </div>
      )
    }

    // Card total geral — compartilhado desktop e mobile
    function CardTotal() {
      return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2.5 flex items-center justify-center gap-6 w-full">
          <div className="text-center">
            <p className="text-xs text-gray-400 leading-tight">Total de Lavouras</p>
            <p className="text-xl font-bold text-gray-800 leading-tight">
              {grupo.lavouras.length}
            </p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-400 leading-tight">Área Total</p>
            <p className="text-xl font-bold text-gray-800 leading-tight">
              {converterArea(totalArea, grupo.medida)}
              <span className="text-sm font-normal text-gray-400 ml-1">
                {labelMedida(grupo.medida)}
              </span>
            </p>
          </div>
        </div>
      )
    }

    const centro = prop?.lat && prop?.lng
      ? [prop.lat, prop.lng]
      : [-15.7801, -47.9292]

    function MapaConteudo({ altura = '100%' }) {
      return (
        <MapContainer center={centro} zoom={14}
          style={{ height: altura, width: '100%' }}
          zoomControl={true} dragging={true}>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="© Esri" maxZoom={19} />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19} />
          {prop?.lat && prop?.lng && (
            <Marker position={[prop.lat, prop.lng]} icon={iconeProp} />
          )}
          {grupo.lavouras.map(l =>
            l.poligono?.length > 2 && (
              <Polygon key={l.id}
                positions={l.poligono.map(p => [p.lat, p.lng])}
                pathOptions={{
                  color: corLavoura(l.id),
                  fillColor: corLavoura(l.id),
                  fillOpacity: 0.35,
                  weight: 2
                }}>
                <Tooltip direction="center" sticky className="lavoura-label">
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>{l.nome}</span>
                </Tooltip>
              </Polygon>
            )
          )}
        </MapContainer>
      )
    }

    return (
      <>
        {/* ── Desktop ── */}
        <div className="hidden md:flex gap-3 items-stretch" style={{ height: '200px' }}>

          {/* Coluna esquerda: total geral + cards situação */}
          <div className="flex flex-col gap-2 flex-shrink-0 h-full">
            <CardTotal />
            <div className="flex gap-2 flex-1 min-h-0">
              <CardSituacao label="Ativas" lavouras={ativas} corBadge="bg-green-100 text-green-700" />
              <CardSituacao label="Em preparo" lavouras={emPreparo} corBadge="bg-yellow-100 text-yellow-700" />
              <CardSituacao label="Ociosas" lavouras={ociosas} corBadge="bg-gray-100 text-gray-500" />
            </div>
          </div>

          {/* Mapa */}
          <div className="flex-1 relative rounded-xl overflow-hidden border border-gray-100 shadow-sm">
            {temPoligonos ? (
              <>
                <MapaConteudo altura="200px" />
                <button
                  onClick={() => setMiniMapaFullscreen(propId)}
                  className="absolute top-2 right-2 flex items-center gap-1 text-xs bg-white border border-gray-300 shadow-md px-2 py-1 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  style={{ zIndex: 10 }}>
                  <Maximize2 size={11} /> Tela cheia
                </button>
              </>
            ) : (
              <div className="h-full flex items-center justify-center bg-gray-50 rounded-xl text-gray-300 text-sm">
                Sem polígonos cadastrados
              </div>
            )}
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="md:hidden space-y-2">

          {/* Card total — sempre visível */}
          <CardTotal />

          {/* Cards situação — colapsáveis */}
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 bg-white rounded-xl border border-gray-100 shadow-sm text-xs text-gray-600"
            onClick={() => setSituacaoExpandida(s => !s)}>
            <span>Ver situação das lavouras</span>
            {situacaoExpandida ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {situacaoExpandida && (
            <div className="flex gap-2">
              {ativas.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col flex-1 min-w-0 py-2.5 px-2">
                  <div className="flex justify-center mb-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Ativas</span>
                  </div>
                  <div className="h-px bg-gray-100 mx-1 mb-1.5" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Qtde. de Lavoura(s)</p>
                    <p className="text-lg font-bold text-gray-800">{ativas.length}</p>
                  </div>
                  <div className="w-8 h-px bg-gray-200 mx-auto my-1" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Área</p>
                    <p className="text-lg font-bold text-gray-800">
                      {converterArea(ativas.reduce((a, l) => a + (Number(l.areaHa) || 0), 0), grupo.medida)}
                      <span className="text-xs font-normal text-gray-400 ml-0.5">{labelMedida(grupo.medida)}</span>
                    </p>
                  </div>
                </div>
              )}
              {emPreparo.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col flex-1 min-w-0 py-2.5 px-2">
                  <div className="flex justify-center mb-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">Em preparo</span>
                  </div>
                  <div className="h-px bg-gray-100 mx-1 mb-1.5" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Qtde. de Lavoura(s)</p>
                    <p className="text-lg font-bold text-gray-800">{emPreparo.length}</p>
                  </div>
                  <div className="w-8 h-px bg-gray-200 mx-auto my-1" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Área</p>
                    <p className="text-lg font-bold text-gray-800">
                      {converterArea(emPreparo.reduce((a, l) => a + (Number(l.areaHa) || 0), 0), grupo.medida)}
                      <span className="text-xs font-normal text-gray-400 ml-0.5">{labelMedida(grupo.medida)}</span>
                    </p>
                  </div>
                </div>
              )}
              {ociosas.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col flex-1 min-w-0 py-2.5 px-2">
                  <div className="flex justify-center mb-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Ociosas</span>
                  </div>
                  <div className="h-px bg-gray-100 mx-1 mb-1.5" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Qtde. de Lavoura(s)</p>
                    <p className="text-lg font-bold text-gray-800">{ociosas.length}</p>
                  </div>
                  <div className="w-8 h-px bg-gray-200 mx-auto my-1" />
                  <div className="text-center">
                    <p className="text-xs text-gray-400 leading-tight">Área</p>
                    <p className="text-lg font-bold text-gray-800">
                      {converterArea(ociosas.reduce((a, l) => a + (Number(l.areaHa) || 0), 0), grupo.medida)}
                      <span className="text-xs font-normal text-gray-400 ml-0.5">{labelMedida(grupo.medida)}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mapa colapsável */}
          {temPoligonos && (
            <>
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 bg-white rounded-xl border border-gray-100 shadow-sm text-xs text-gray-600"
                onClick={() => setMapaExpandido(m => ({ ...m, [propId]: !m[propId] }))}>
                <span>Ver mapa das lavouras</span>
                {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {expandido && (
                <div className="relative rounded-xl overflow-hidden border border-gray-200" style={{ height: '200px' }}>
                  <MapaConteudo altura="200px" />
                  <button
                    onClick={() => setMiniMapaFullscreen(propId)}
                    className="absolute top-2 right-2 flex items-center gap-1 text-xs bg-white border border-gray-300 shadow-md px-2 py-1 rounded-lg hover:bg-gray-50 text-gray-600"
                    style={{ zIndex: 10 }}>
                    <Maximize2 size={11} /> Tela cheia
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </>
    )
  }

  const grupoFullscreen = miniMapaFullscreen
    ? agrupado.find(([id]) => id === miniMapaFullscreen)
    : null

  return (
    <div className="space-y-5 pb-24">

      <h1 className="text-2xl font-bold text-gray-800">Lavouras</h1>

      {/* Filtro */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-lav>
            <button type="button"
              onClick={() => setDropdownFiltroAberto(!dropdownFiltroAberto)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-normal bg-gray-50 hover:border-green-400 focus:outline-none min-w-[180px] flex items-center justify-between gap-2">
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
                      onClick={() => setFiltroPropriedadeIds(f =>
                        sel ? f.filter(id => id !== p.id) : [...f, p.id]
                      )}
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
          {filtroPropriedadeIds.length > 0 && (
            <button onClick={() => setFiltroPropriedadeIds([])}
              className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>
          )}
        </div>
      </div>

      {agrupado.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Sprout size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma lavoura cadastrada ainda.</p>
        </div>
      )}

      {agrupado.map(([propId, grupo]) => (
        <div key={propId} className="space-y-2">
          <h2 className="text-sm font-bold text-gray-700 border-b border-gray-200 pb-1">
            {grupo.propNome}
          </h2>
          <MiniMapaGrupo propId={propId} grupo={grupo} />
          <div className="space-y-1.5">
            {grupo.lavouras.map(l => {
              const areaDisp = converterArea(Number(l.areaHa) || 0, grupo.medida)
              const cor = corLavoura(l.id)
              return (
                <div key={l.id}
                  className="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{l.nome}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${corStatus(l.status)}`}>
                          {l.status}
                        </span>
                        <span className="text-xs text-gray-400">
                          {areaDisp} {labelMedida(grupo.medida)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => abrirEdicao(l)} className="text-gray-300 hover:text-blue-500 p-1"><Pencil size={14} /></button>
                    <button onClick={() => excluir(l.id, l.nome)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Nova lavoura</span>
              <button onClick={abrirModal}
                className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90 transition-all"
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

      {/* Modal criar/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-800">{editando ? 'Editar lavoura' : 'Nova lavoura'}</h2>
              <button onClick={() => { setModal(false); setEditando(null) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <form onSubmit={salvar} className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                  <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Ex: Talhão A"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Situação</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade <span className="text-red-500">*</span></label>
                  <select value={form.propriedadeId}
                    onChange={e => { setForm(f => ({ ...f, propriedadeId: e.target.value })); setPoligono(null); setAreaHa(0) }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required>
                    <option value="">Selecione...</option>
                    {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Área</label>
                  <div className="flex gap-2 mb-3">
                    {[
                      { val: 'mapa', label: 'Selecionar no mapa' },
                      { val: 'manual', label: 'Inserir manualmente' },
                    ].map(op => (
                      <button key={op.val} type="button"
                        onClick={() => { setForm(f => ({ ...f, modoArea: op.val })); if (op.val === 'mapa') { setPoligono(null); setAreaHa(0) } }}
                        className={`flex-1 py-2 rounded-xl text-sm border-2 transition-colors ${
                          form.modoArea === op.val
                            ? 'border-green-600 bg-green-50 text-green-700 font-medium'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        {op.label}
                      </button>
                    ))}
                  </div>
                  {form.modoArea === 'manual' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Área em {medidaProp}</label>
                      <input type="number" value={form.areaManual} min="0" step="0.01"
                        onChange={e => setForm(f => ({ ...f, areaManual: e.target.value }))}
                        placeholder={`Digite a área em ${labelMedida(medidaProp)}`}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                    </div>
                  )}
                  {form.modoArea === 'mapa' && (
                    <div className="space-y-2">
                      {!form.propriedadeId ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                          <p className="text-amber-700 text-sm">Selecione uma propriedade primeiro para carregar o mapa na localização correta.</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">
                              {poligono ? '✓ Área desenhada — use tela cheia para editar' : 'Abra tela cheia para desenhar a área'}
                            </p>
                            <div className="flex items-center gap-1">
                              {[{ val: 'normal', label: 'Mapa' }, { val: 'satelite', label: 'Satélite' }].map(c => (
                                <button key={c.val} type="button"
                                  onClick={() => setForm(f => ({ ...f, camadaMapa: c.val }))}
                                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                    form.camadaMapa === c.val ? 'bg-green-700 text-white border-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                  }`}>{c.label}</button>
                              ))}
                              {/* ← CORRIGIDO: incrementa mapaKey ao abrir fullscreen */}
                              <button type="button" onClick={() => { setMapaKey(k => k + 1); setMapaFullscreen(true) }}
                                className="ml-1 flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-green-400 hover:text-green-700 transition-colors">
                                <Maximize2 size={11} /> Tela cheia
                              </button>
                            </div>
                          </div>

                          {/* Prévia sem EditControl */}
                          <div className="h-56 rounded-xl overflow-hidden border border-gray-200">
                            <MapContainer
                              key={`preview-${form.propriedadeId}`}
                              center={centroProp ? [centroProp.lat, centroProp.lng] : [-15.7801, -47.9292]}
                              zoom={centroProp ? 14 : 5}
                              style={{ height: '100%', width: '100%' }}
                              zoomControl={false}>
                              <TileLayers camada={form.camadaMapa} />
                              {centroProp && <CentralizarMapa centro={centroProp} zoom={14} />}
                              {centroProp && <Marker position={[centroProp.lat, centroProp.lng]} icon={iconeProp} />}
                              {poligono?.length > 2 && (
                                <Polygon positions={poligono.map(p => [p.lat, p.lng])}
                                  pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.3 }} />
                              )}
                            </MapContainer>
                          </div>

                          {!poligono ? (
                            <button type="button" onClick={() => { setMapaKey(k => k + 1); setMapaFullscreen(true) }}
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-green-400 text-green-700 text-sm hover:bg-green-50 transition-colors">
                              <Maximize2 size={15} />
                              Abrir tela cheia para desenhar a área
                            </button>
                          ) : (
                            <button type="button" onClick={() => { setMapaKey(k => k + 1); setMapaFullscreen(true) }}
                              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-200 text-gray-500 text-xs hover:bg-gray-50 transition-colors">
                              <Maximize2 size={13} />
                              Editar área no mapa
                            </button>
                          )}
                          {areaHa > 0 && (
                            <p className="text-sm text-green-700 font-medium">
                              ✓ Área: {converterArea(areaHa, medidaProp)} {labelMedida(medidaProp)}
                              <span className="text-gray-400 text-xs ml-1">({areaHa.toFixed(4)} ha)</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => { setModal(false); setEditando(null) }}
                    className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
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

      {/* Mapa fullscreen desenho — ← CORRIGIDO: usa mapaKey na key */}
      {mapaFullscreen && form.propriedadeId && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
            <p className="text-white text-sm font-medium">
              {poligono ? `✓ Área: ${converterArea(areaHa, medidaProp)} ${labelMedida(medidaProp)}` : 'Use o polígono para desenhar a área da lavoura'}
            </p>
            <div className="flex items-center gap-2">
              {[{ val: 'normal', label: 'Mapa' }, { val: 'satelite', label: 'Satélite' }].map(c => (
                <button key={c.val} type="button" onClick={() => setForm(f => ({ ...f, camadaMapa: c.val }))}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    form.camadaMapa === c.val ? 'bg-green-700 text-white border-green-700' : 'border-gray-600 text-gray-300 hover:border-green-500'
                  }`}>{c.label}</button>
              ))}
              <button type="button" onClick={() => setMapaFullscreen(false)}
                className="ml-2 text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
                <X size={13} /> Fechar
              </button>
            </div>
          </div>
          <div className="flex-1">
            <MapContainer
              key={`fullscreen-${form.propriedadeId}-${mapaKey}`}
              center={centroProp ? [centroProp.lat, centroProp.lng] : [-15.7801, -47.9292]}
              zoom={centroProp ? 14 : 5}
              style={{ height: '100%', width: '100%' }}>
              <TileLayers camada={form.camadaMapa} />
              {centroProp && <CentralizarMapa centro={centroProp} zoom={14} />}
              {centroProp && <Marker position={[centroProp.lat, centroProp.lng]} icon={iconeProp} />}
              <DesenhoPoligono onCreated={onDesenho} poligonoInicial={poligono} centroProp={centroProp} />
            </MapContainer>
          </div>
        </div>
      )}

      {/* Mini-mapa fullscreen */}
      {miniMapaFullscreen && grupoFullscreen && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
            <p className="text-white text-sm font-medium">{grupoFullscreen[1].propNome} — Lavouras</p>
            <button type="button" onClick={() => setMiniMapaFullscreen(null)}
              className="text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
              <X size={13} /> Fechar
            </button>
          </div>
          <div className="flex-1">
            {(() => {
              const [propId, grupo] = grupoFullscreen
              const prop = propriedades.find(p => p.id === propId)
              const centro = prop?.lat && prop?.lng ? [prop.lat, prop.lng] : [-15.7801, -47.9292]
              return (
                <MapContainer center={centro} zoom={14} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxZoom={19} />
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
                  {prop?.lat && prop?.lng && <Marker position={[prop.lat, prop.lng]} icon={iconeProp} />}
                  {grupo.lavouras.map(l =>
                    l.poligono?.length > 2 && (
                      <Polygon key={l.id} positions={l.poligono.map(p => [p.lat, p.lng])}
                        pathOptions={{ color: corLavoura(l.id), fillColor: corLavoura(l.id), fillOpacity: 0.35, weight: 2.5 }}>
                        <Tooltip direction="center" sticky>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{l.nome}</span>
                        </Tooltip>
                      </Polygon>
                    )
                  )}
                </MapContainer>
              )
            })()}
          </div>
        </div>
      )}

      {/* Confirmação */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600">{confirmacao.mensagem}</p>
            <p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacao(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { confirmacao.onConfirmar(); setConfirmacao(null) }}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}