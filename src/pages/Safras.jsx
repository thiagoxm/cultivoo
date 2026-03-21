import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Layers, Pencil, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'


const STATUS_OPTS = ['Planejada', 'Em andamento', 'Colhida']

function corStatus(status) {
  if (status === 'Em andamento') return 'bg-green-100 text-green-700'
  if (status === 'Planejada') return 'bg-blue-100 text-blue-700'
  return 'bg-gray-100 text-gray-500'
}

function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}

const FORM_PADRAO = {
  nome: '', cultura: '', propriedadeId: '', lavouraIds: [],
  dataInicio: '', dataTermino: '', status: 'Planejada'
}

export default function Safras() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)
  const [aba, setAba] = useState('atuais')
  const [culturas, setCulturas] = useState([
    'Soja', 'Milho', 'Cana-de-açúcar', 'Café', 'Algodão',
    'Arroz', 'Feijão', 'Trigo', 'Sorgo', 'Outro'
  ])

  async function carregar() {
    const uid = usuario.uid
    const [safSnap, propSnap, lavSnap, userDoc] = await Promise.all([
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
      getDoc(doc(db, 'usuarios', uid)),
    ])
    setLista(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    if (userDoc.exists() && userDoc.data().culturasFavoritas?.length > 0) {
      setCulturas(userDoc.data().culturasFavoritas)
    }
  }

  useEffect(() => { carregar() }, [])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-safra]')) setDropdownFiltroAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  // Lavouras da propriedade selecionada no form
  const lavourasDaPropriedade = lavouras.filter(l => l.propriedadeId === form.propriedadeId)

  // Lista filtrada e ordenada por data de colheita decrescente
  const hoje = new Date().toISOString().split('T')[0]
  const listaFiltrada = useMemo(() => {
    let resultado = filtroPropriedadeIds.length > 0
      ? lista.filter(s => filtroPropriedadeIds.includes(s.propriedadeId))
      : lista

    // Separa em atuais (sem data de término ou término >= hoje ou colhida em andamento/planejada)
    // e passadas (término < hoje E status === 'Colhida')
    resultado = resultado.filter(s => {
      const dataFim = s.dataTermino || s.dataColheitaPrev || ''
      const passada = dataFim && dataFim < hoje && s.status === 'Colhida'
      return aba === 'passadas' ? passada : !passada
    })

    return [...resultado].sort((a, b) => {
      const dA = a.dataTermino || a.dataColheitaPrev || ''
      const dB = b.dataTermino || b.dataColheitaPrev || ''
      return dB.localeCompare(dA)
    })
  }, [lista, filtroPropriedadeIds, aba, hoje])

  function toggleLavoura(id) {
    setForm(f => ({
      ...f,
      lavouraIds: f.lavouraIds.includes(id)
        ? f.lavouraIds.filter(x => x !== id)
        : [...f.lavouraIds, id]
    }))
  }

  function abrirModal() {
    setEditando(null)
    setForm(FORM_PADRAO)
    setFabAberto(false)
    setModal(true)
  }

  function abrirEdicao(s) {
    setEditando(s.id)
    setForm({
      nome: s.nome || '',
      cultura: s.cultura || '',
      propriedadeId: s.propriedadeId || '',
      lavouraIds: s.lavouraIds || [],
      dataInicio: s.dataInicio || s.dataPlantio || '',
      dataTermino: s.dataTermino || s.dataColheitaPrev || '',
      status: s.status || 'Planejada',
    })
    setModal(true)
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.propriedadeId) return alert('Selecione uma propriedade.')
    setLoading(true)
    const prop = propriedades.find(p => p.id === form.propriedadeId)
    const lavsSelecionadas = lavouras
      .filter(l => form.lavouraIds.includes(l.id))
      .map(l => l.nome)
    const payload = {
      nome: form.nome,
      cultura: form.cultura,
      propriedadeId: form.propriedadeId,
      propriedadeNome: prop?.nome || '',
      lavouraIds: form.lavouraIds,
      lavouraNomes: lavsSelecionadas,
      dataInicio: form.dataInicio,
      dataTermino: form.dataTermino,
      // mantém campos antigos para compatibilidade com dados existentes
      dataPlantio: form.dataInicio,
      dataColheitaPrev: form.dataTermino,
      status: form.status,
      uid: usuario.uid,
    }
    if (editando) {
      await updateDoc(doc(db, 'safras', editando), payload)
    } else {
      await addDoc(collection(db, 'safras'), { ...payload, criadoEm: new Date() })
    }
    setModal(false)
    setEditando(null)
    setForm(FORM_PADRAO)
    await carregar()
    setLoading(false)
  }

  function excluir(id, nome) {
    setConfirmacao({
      mensagem: `Deseja excluir a safra "${nome}"?`,
      onConfirmar: async () => {
        await deleteDoc(doc(db, 'safras', id))
        await carregar()
      }
    })
  }

  return (
    <div className="space-y-5 pb-24">

      <h1 className="text-2xl font-bold text-gray-800">Safras</h1>

      {/* Filtro */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-safra>
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
                {propriedades.length === 0 && (
                  <p className="text-xs text-gray-400 px-3 py-2">Nenhuma propriedade cadastrada.</p>
                )}
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
              className="text-xs text-gray-400 hover:text-red-400 underline">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Lista vazia */}
      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { val: 'atuais', label: 'Safras Atuais' },
          { val: 'passadas', label: 'Safras Passadas' },
        ].map(a => (
          <button key={a.val} onClick={() => setAba(a.val)}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a.val
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Lista vazia */}
      {listaFiltrada.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Layers size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {aba === 'atuais'
              ? 'Nenhuma safra atual cadastrada.'
              : 'Nenhuma safra passada encontrada.'}
          </p>
        </div>
      )}

      {/* Lista de safras */}
      <div className="space-y-3">
        {listaFiltrada.map(s => {
          // Calcula quantidade e área das lavouras vinculadas
          const lavourasVinculadas = lavouras.filter(l => s.lavouraIds?.includes(l.id))
          const qtdeLavouras = lavourasVinculadas.length
          const areaTotal = lavourasVinculadas.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)

          return (
            <div key={s.id}
              className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800">{s.nome}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${corStatus(s.status)}`}>
                    {s.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {s.cultura} · {s.propriedadeNome}
                </p>
                {qtdeLavouras > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {qtdeLavouras} lavoura{qtdeLavouras > 1 ? 's' : ''} ·{' '}
                    {areaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {(s.dataInicio || s.dataPlantio) && (
                    <p className="text-xs text-gray-400">
                      🌱 Início: <span className="font-medium text-gray-600">
                        {formatarData(s.dataInicio || s.dataPlantio)}
                      </span>
                    </p>
                  )}
                  {(s.dataTermino || s.dataColheitaPrev) && (
                    <p className="text-xs text-gray-400">
                      🌾 Término: <span className="font-medium text-gray-600">
                        {formatarData(s.dataTermino || s.dataColheitaPrev)}
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => abrirEdicao(s)}
                  className="text-gray-300 hover:text-blue-500 p-1 transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={() => excluir(s.id, s.nome)}
                  className="text-gray-300 hover:text-red-500 p-1 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">
                Nova safra
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

      {/* Modal criar/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                {editando ? 'Editar safra' : 'Nova safra'}
              </h2>
              <button onClick={() => { setModal(false); setEditando(null) }}
                className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da safra</label>
                <input value={form.nome}
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Soja 2024/25"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cultura</label>
                <select value={form.cultura}
                  onChange={e => setForm(f => ({ ...f, cultura: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {culturas.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Propriedade</label>
                <select value={form.propriedadeId}
                  onChange={e => setForm(f => ({ ...f, propriedadeId: e.target.value, lavouraIds: [] }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required>
                  <option value="">Selecione...</option>
                  {propriedades.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>

              {/* Datas — antes da propriedade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de início</label>
                  <input type="date" value={form.dataInicio}
                    onChange={e => {
                      const dataInicio = e.target.value
                      // Calcula automaticamente 1 ano após a data de início
                      let dataTermino = form.dataTermino
                      if (dataInicio) {
                        const d = new Date(dataInicio + 'T00:00:00')
                        d.setFullYear(d.getFullYear() + 1)
                        dataTermino = d.toISOString().split('T')[0]
                      }
                      setForm(f => ({ ...f, dataInicio, dataTermino }))
                    }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de término</label>
                  <input type="date" value={form.dataTermino}
                    onChange={e => setForm(f => ({ ...f, dataTermino: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>

              {/* Situação */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Situação</label>
                <select value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Lavouras — após propriedade */}
              {lavourasDaPropriedade.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Lavouras</label>
                    {form.lavouraIds.length > 0 && (
                      <span className="text-xs text-gray-500">
                        Área selecionada:{' '}
                        <span className="font-semibold text-gray-700">
                          {lavouras
                            .filter(l => form.lavouraIds.includes(l.id))
                            .reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
                            .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                    {lavourasDaPropriedade.map(l => (
                      <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox"
                          checked={form.lavouraIds.includes(l.id)}
                          onChange={() => toggleLavoura(l.id)}
                          className="accent-green-600 w-4 h-4" />
                        <span className="text-gray-700">{l.nome}</span>
                        <span className="text-gray-400 text-xs">
                          ({Number(l.areaHa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha)
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

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