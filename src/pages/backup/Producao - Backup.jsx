import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Wheat, Pencil, X, ChevronDown, ChevronUp } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { getCamposQualidade, UNIDADES, getLabelUnidade } from '../config/culturasConfig'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}

function formatarNumero(valor, decimais = 2) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimais,
    maximumFractionDigits: decimais,
  })
}

function nomeMes(chave) {
  if (!chave) return 'Sem data'
  const [y, m] = chave.split('-')
  try { return format(new Date(Number(y), Number(m) - 1), 'MMMM yyyy', { locale: ptBR }) } catch { return chave }
}

// ─────────────────────────────────────────────
// Formulário padrão
// ─────────────────────────────────────────────
const FORM_PADRAO = {
  safraId: '',
  lavouraId: '',
  dataColheita: '',
  quantidade: '',
  unidade: 'sc',
  qualidade: {}, // campos dinâmicos por grupo
  observacoes: '',
}

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
export default function Producao() {
  const { usuario } = useAuth()

  // Dados
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])

  // UI
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})

  // Filtros
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)

  // ── Carregar dados ──
  async function carregar() {
    const uid = usuario.uid
    const [colSnap, propSnap, safSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])
    setLista(colSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-prod]')) setDropdownFiltroAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  // ── Safra selecionada no form ──
  const safraSelecionada = useMemo(
    () => safras.find(s => s.id === form.safraId) || null,
    [safras, form.safraId]
  )

  // Lavouras vinculadas à safra selecionada no form
  const lavourasDaSafra = useMemo(() => {
    if (!safraSelecionada) return []
    return lavouras.filter(l => safraSelecionada.lavouraIds?.includes(l.id))
  }, [safraSelecionada, lavouras])

  // Campos de qualidade dinâmicos da safra selecionada
  const camposQualidade = useMemo(() => {
    if (!safraSelecionada?.cultura) return []
    return getCamposQualidade(safraSelecionada.cultura)
  }, [safraSelecionada])

  // ── Lista filtrada e agrupada por safra → mês ──
  const listaFiltrada = useMemo(() => {
    let resultado = lista

    if (filtroPropriedadeIds.length > 0) {
      resultado = resultado.filter(c => filtroPropriedadeIds.includes(c.propriedadeId))
    }
    if (filtroSafraId) {
      resultado = resultado.filter(c => c.safraId === filtroSafraId)
    }

    return [...resultado].sort((a, b) =>
      (b.dataColheita || '').localeCompare(a.dataColheita || '')
    )
  }, [lista, filtroPropriedadeIds, filtroSafraId])

  // Agrupa por safra → mês
  const agrupado = useMemo(() => {
    const grupos = {}
    listaFiltrada.forEach(c => {
      const safraId = c.safraId || ''
  const safraNome = c.safraNome || 'Sem safra'
      const cultura = c.cultura || ''
      const chaveMes = (c.dataColheita || '').substring(0, 7)

      if (!grupos[safraId]) grupos[safraId] = { safraNome, cultura, meses: {} }
      if (!grupos[safraId].meses[chaveMes]) grupos[safraId].meses[chaveMes] = []
      grupos[safraId].meses[chaveMes].push(c)
    })

    return Object.entries(grupos)
      .sort((a, b) => a[1].safraNome.localeCompare(b[1].safraNome))
      .map(([safraId, grupo]) => ({
        safraId,
        safraNome: grupo.safraNome,
        cultura: grupo.cultura,
        totalGeral: listaFiltrada
          .filter(c => c.safraId === safraId)
          .reduce((a, c) => a + (Number(c.quantidade) || 0), 0),
        unidade: listaFiltrada.find(c => c.safraId === safraId)?.unidade || 'sc',
        meses: Object.entries(grupo.meses)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([chave, itens]) => ({
            chave,
            itens,
            totalMes: itens.reduce((a, c) => a + (Number(c.quantidade) || 0), 0),
          })),
      }))
  }, [listaFiltrada])

  // Safras disponíveis no filtro (respeitando filtro de propriedade)
  const safrasFiltro = useMemo(() => {
    if (filtroPropriedadeIds.length === 0) return safras
    return safras.filter(s => filtroPropriedadeIds.includes(s.propriedadeId))
  }, [safras, filtroPropriedadeIds])

  // ── Modal ──
  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
    setFabAberto(false)
    setModal(true)
  }

  function abrirEdicao(c) {
    setEditando(c.id)
    setForm({
      safraId: c.safraId || '',
      lavouraId: c.lavouraId || '',
      dataColheita: c.dataColheita || '',
      quantidade: c.quantidade ? String(c.quantidade) : '',
      unidade: c.unidade || 'sc',
      qualidade: c.qualidade || {},
      observacoes: c.observacoes || '',
    })
    setModal(true)
  }

  // Ao selecionar safra no form — herda unidade da safra
  function selecionarSafra(safraId) {
    const safra = safras.find(s => s.id === safraId)
    setForm(f => ({
      ...f,
      safraId,
      lavouraId: '',
      unidade: safra?.unidade || 'sc',
      qualidade: {},
    }))
  }

  // Atualiza campo de qualidade dinâmico
  function setQualidade(key, value) {
    setForm(f => ({ ...f, qualidade: { ...f.qualidade, [key]: value } }))
  }

  // ── Salvar ──
  async function salvar(e) {
    e.preventDefault()
    if (!form.safraId) return alert('Selecione uma safra.')
    if (!form.quantidade || isNaN(Number(form.quantidade))) return alert('Informe a quantidade colhida.')
    setLoading(true)

    const safra = safras.find(s => s.id === form.safraId)
    const lavoura = lavouras.find(l => l.id === form.lavouraId)
    const prop = propriedades.find(p => p.id === safra?.propriedadeId)

    const payload = {
      safraId: form.safraId,
      safraNome: safra?.nome || '',
      cultura: safra?.cultura || '',
      lavouraId: form.lavouraId || '',
      lavouraNome: lavoura?.nome || '',
      propriedadeId: safra?.propriedadeId || '',
      propriedadeNome: prop?.nome || '',
      dataColheita: form.dataColheita,
      quantidade: Number(form.quantidade),
      unidade: form.unidade,
      qualidade: form.qualidade || {},
      observacoes: form.observacoes || '',
      uid: usuario.uid,
    }

    if (editando) {
      await updateDoc(doc(db, 'colheitas', editando), payload)
    } else {
      await addDoc(collection(db, 'colheitas'), { ...payload, criadoEm: new Date() })
    }

    setModal(false)
    setEditando(null)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  // ── Excluir ──
  function excluir(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir o registro de colheita "${nome}"?`,
      onConfirmar: async () => {
        await deleteDoc(doc(db, 'colheitas', id))
        await carregar()
      },
    })
  }

  // ── Toggle grupo expandido ──
  function toggleGrupo(safraId) {
    setGruposExpandidos(g => ({ ...g, [safraId]: !g[safraId] }))
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-24">

      <h1 className="text-2xl font-bold text-gray-800">Produção</h1>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">

          {/* Filtro propriedade */}
          <div className="relative" data-dropdown-prod>
            <button type="button"
              onClick={() => setDropdownFiltroAberto(!dropdownFiltroAberto)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none min-w-[180px] flex items-center justify-between gap-2">
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
                {propriedades.length === 0 && (
                  <p className="text-xs text-gray-400 px-3 py-2">Nenhuma propriedade cadastrada.</p>
                )}
                {propriedades.map(p => {
                  const sel = filtroPropriedadeIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => {
                        setFiltroPropriedadeIds(f => sel ? f.filter(id => id !== p.id) : [...f, p.id])
                        setFiltroSafraId('')
                      }}
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

          {/* Filtro safra */}
          <select value={filtroSafraId}
            onChange={e => setFiltroSafraId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none min-w-[160px]">
            <option value="">Todas as safras</option>
            {safrasFiltro.map(s => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>

          {(filtroPropriedadeIds.length > 0 || filtroSafraId) && (
            <button onClick={() => { setFiltroPropriedadeIds([]); setFiltroSafraId('') }}
              className="text-xs text-gray-400 hover:text-red-400 underline">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* ── Lista vazia ── */}
      {agrupado.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma colheita registrada.</p>
          <p className="text-xs mt-1 text-gray-300">Use o botão + para registrar a primeira colheita.</p>
        </div>
      )}

      {/* ── Grupos por safra ── */}
      <div className="space-y-4">
        {agrupado.map(grupo => {
          const expandido = gruposExpandidos[grupo.safraId] !== false // expandido por padrão

          return (
            <div key={grupo.safraId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

              {/* Cabeçalho da safra */}
              <button type="button"
                onClick={() => toggleGrupo(grupo.safraId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--brand-gradient)' }}>
                    <Wheat size={14} className="text-white" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{grupo.safraNome}</p>
                    <p className="text-xs text-gray-400">{grupo.cultura}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-700">
                      {formatarNumero(grupo.totalGeral)} {grupo.unidade}
                    </p>
                    <p className="text-xs text-gray-400">total colhido</p>
                  </div>
                  {expandido
                    ? <ChevronUp size={16} className="text-gray-400" />
                    : <ChevronDown size={16} className="text-gray-400" />
                  }
                </div>
              </button>

              {/* Itens expandidos agrupados por mês */}
              {expandido && (
                <div className="border-t border-gray-100">
                  {grupo.meses.map(mes => (
                    <div key={mes.chave}>

                      {/* Cabeçalho do mês */}
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 capitalize">
                          {nomeMes(mes.chave)}
                        </p>
                        <p className="text-xs font-semibold text-gray-600">
                          {formatarNumero(mes.totalMes)} {grupo.unidade}
                        </p>
                      </div>

                      {/* Registros */}
                      {mes.itens.map(c => {
                        const camposQ = getCamposQualidade(c.cultura || '')
                        const temQualidade = camposQ.length > 0 &&
                          Object.keys(c.qualidade || {}).some(k => c.qualidade[k] !== '' && c.qualidade[k] !== undefined)

                        return (
                          <div key={c.id}
                            className="flex items-start justify-between px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-gray-800">
                                  {c.lavouraNome || 'Sem lavoura'}
                                </p>
                                <span className="text-xs text-gray-400">
                                  {formatarData(c.dataColheita)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {c.propriedadeNome}
                              </p>

                              {/* Quantidade */}
                              <p className="text-sm font-semibold text-green-700 mt-1">
                                {formatarNumero(c.quantidade)} {c.unidade}
                              </p>

                              {/* Qualidade — exibe se preenchida */}
                              {temQualidade && (
                                <div className="flex flex-wrap gap-2 mt-1.5">
                                  {camposQ.map(campo => {
                                    const val = c.qualidade?.[campo.key]
                                    if (!val && val !== 0) return null
                                    return (
                                      <span key={campo.key}
                                        className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100">
                                        {campo.label}: {val}{campo.unidade ? ` ${campo.unidade}` : ''}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}

                              {/* Observações */}
                              {c.observacoes && (
                                <p className="text-xs text-gray-400 mt-1 italic">
                                  {c.observacoes}
                                </p>
                              )}
                            </div>

                            {/* Ações */}
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              <button onClick={() => abrirEdicao(c)}
                                className="text-gray-300 hover:text-blue-500 p-1 transition-colors">
                                <Pencil size={15} />
                              </button>
                              <button onClick={() => excluir(c.id, c.lavouraNome || 'colheita')}
                                className="text-gray-300 hover:text-red-500 p-1 transition-colors">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── FAB ── */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">
                Registrar colheita
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
          className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${fabAberto ? 'rotate-45' : ''}`}
          style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}>
          <Plus size={24} />
        </button>
      </div>

      {/* ── Modal criar/editar ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">

            {/* Header */}
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                {editando ? 'Editar colheita' : 'Registrar colheita'}
              </h2>
              <button onClick={() => { setModal(false); setEditando(null) }}
                className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={salvar} className="p-5 space-y-4">

              {/* Safra */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-red-500">*</span></label>
                <select value={form.safraId}
                  onChange={e => selecionarSafra(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione a safra...</option>
                  {safras.map(s => (
                    <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>
                  ))}
                </select>
              </div>

              {/* Lavoura — só aparece se a safra tiver lavouras vinculadas */}
              {lavourasDaSafra.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lavoura</label>
                  <select value={form.lavouraId}
                    onChange={e => setForm(f => ({ ...f, lavouraId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">Selecione a lavoura...</option>
                    {lavourasDaSafra.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.nome} ({formatarNumero(l.areaHa)} ha)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Data da colheita */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data da colheita <span className="text-red-500">*</span></label>
                <input type="date" value={form.dataColheita}
                  onChange={e => setForm(f => ({ ...f, dataColheita: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              {/* Quantidade + Unidade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={form.quantidade}
                    onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                  <select value={form.unidade}
                    onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {UNIDADES.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  {safraSelecionada?.unidade && (
                    <p className="text-xs text-gray-400 mt-1">
                      Padrão da safra: {getLabelUnidade(safraSelecionada.unidade)}
                    </p>
                  )}
                </div>
              </div>

              {/* Campos de qualidade dinâmicos */}
              {camposQualidade.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">
                    Qualidade <span className="text-xs text-gray-400 font-normal">(opcional)</span>
                  </p>
                  <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                    {camposQualidade.map(campo => (
                      <div key={campo.key}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {campo.label}
                          {campo.unidade && <span className="text-gray-400 font-normal"> ({campo.unidade})</span>}
                        </label>
                        {campo.tipo === 'select' ? (
                          <select
                            value={form.qualidade[campo.key] || ''}
                            onChange={e => setQualidade(campo.key, e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                            <option value="">Não informado</option>
                            {campo.opcoes.map(op => (
                              <option key={op} value={op}>{op}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="number" min={campo.min} max={campo.max} step="0.01"
                            value={form.qualidade[campo.key] || ''}
                            onChange={e => setQualidade(campo.key, e.target.value)}
                            placeholder={`${campo.min ?? 0} – ${campo.max ?? ''}${campo.unidade ? ' ' + campo.unidade : ''}`}
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder="Condições climáticas, ocorrências, etc."
                  rows={2}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-1">
                <button type="button"
                  onClick={() => { setModal(false); setEditando(null) }}
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
      )}

      {/* ── Modal confirmação exclusão ── */}
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