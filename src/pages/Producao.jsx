import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, doc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Wheat, X, ChevronDown, ChevronUp, CheckCircle, PackagePlus, Search, ArrowUpDown } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { getCamposQualidade, getCultura, UNIDADES, getLabelUnidade } from '../config/culturasConfig'
import { formatarCustoEstimado, DEBUG_CUSTO } from '../hooks/useCustoProducao'
import { PainelDebugCusto } from '../components/PainelDebugCusto'

const HOJE = new Date().toISOString().split('T')[0]

function formatarNumero(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}

function IconeCultura({ nomeCultura, size = 14 }) {
  const config = getCultura(nomeCultura)
  if (config?.icone) return <span style={{ fontSize: size + 2, lineHeight: 1 }}>{config.icone}</span>
  return <Wheat size={size} className="text-white" />
}

function AutocompleteInput({ value, onChange, placeholder, sugestoes, className }) {
  const [aberto, setAberto] = useState(false)
  const filtradas = sugestoes.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value)
  return (
    <div className="relative">
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={placeholder} className={className} autoComplete="off" />
      {aberto && filtradas.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtradas.map(s => (
            <button key={s} type="button" onMouseDown={() => { onChange(s); setAberto(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 text-gray-700">{s}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function CamposQualidade({ camposQ, qualidade, setQualidade, classificacao, setClassificacao }) {
  return (
    <div className="space-y-3">
      {camposQ?.map(c => (
        <div key={c.key}>
          <label className="block text-xs text-gray-500 mb-1">{c.label}{c.unidade ? ` (${c.unidade})` : ''}</label>
          {c.tipo === 'select' ? (
            <select value={qualidade[c.key] || ''} onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">—</option>
              {c.opcoes?.map(o => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input type="number" step="0.1" value={qualidade[c.key] || ''}
              onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          )}
        </div>
      ))}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Classificação geral</label>
        <input type="text" value={classificacao} onChange={e => setClassificacao(e.target.value)}
          placeholder="Ex: Tipo 1, Padrão exportação..."
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>
    </div>
  )
}

// ─── Modal Atualizar Status da Lavoura ────────────────────────────────────────
function ModalAtualizarStatus({ lavoura, safra, dadosStatus, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const [status, setStatus] = useState(dadosStatus?.statusColheita || 'nao_iniciada')
  const [inicio, setInicio] = useState(dadosStatus?.dataInicio || '')
  const [fim, setFim] = useState(dadosStatus?.dataFim || '')
  const [salvando, setSalvando] = useState(false)

  const invalido = !inicio || (status === 'colhida' && !fim)

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const id = `${safra.id}_${lavoura.id}`
      await setDoc(doc(db, 'colheitas', id), {
        safraId: safra.id,
        safraNome: safra.nome,
        cultura: safra.cultura || '',
        lavouraId: lavoura.id,
        lavouraNome: lavoura.nome,
        propriedadeId: safra.propriedadeId || '',
        propriedadeNome: safra.propriedadeNome || '',
        statusColheita: status,
        dataInicio: inicio,
        dataFim: status === 'colhida' ? fim : '',
        uid: safra.uid || usuario.uid,
        atualizadoEm: new Date(),
      })
      await onSalvo()
      onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  const STATUS_OPTS = [
    { val: 'nao_iniciada', label: 'Colheita não iniciada', cor: 'bg-gray-100 text-gray-600' },
    { val: 'em_andamento', label: 'Em andamento', cor: 'bg-blue-100 text-blue-700' },
    { val: 'colhida', label: 'Colhida', cor: 'bg-green-100 text-green-700' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Status da colheita</h2>
            <p className="text-xs text-gray-400 mt-0.5">{lavoura.nome} · {safra.nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Situação</label>
            <div className="space-y-2">
              {STATUS_OPTS.map(o => (
                <label key={o.val}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors ${status === o.val ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="status_col" value={o.val} checked={status === o.val}
                    onChange={() => setStatus(o.val)} className="accent-green-600 w-4 h-4 flex-shrink-0" />
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.cor}`}>{o.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Data de início <span className="text-red-500">*</span>
            </label>
            <input type="date" value={inicio} max={HOJE}
              onChange={e => setInicio(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {status === 'colhida' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data de término <span className="text-red-500">*</span>
              </label>
              <input type="date" value={fim} min={inicio} max={HOJE}
                onChange={e => setFim(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
            style={{ background: 'var(--brand-gradient)' }}>
            {salvando ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Entrada no Estoque ─────────────────────────────────────────────────
function ModalEntradaEstoque({ dadosLavoura, safra, lavoura, sugestoesLocal, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const cultura = safra?.cultura || ''
  const unidade = safra?.unidade || 'sc'
  const camposQ = getCamposQualidade(cultura)

  const [idLote, setIdLote] = useState('')
  const [local, setLocal] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const [qualidade, setQualidade] = useState({})
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)

  const qtdNum = Number(quantidade) || 0
  const invalido = !local.trim() || !quantidade || qtdNum <= 0

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      await addDoc(collection(db, 'estoqueProducao'), {
        cultura,
        safraId: safra.id,
        safraNome: safra.nome,
        lavouraId: lavoura.id,
        lavouraNome: lavoura.nome,
        propriedadeId: safra.propriedadeId || '',
        propriedadeNome: safra.propriedadeNome || '',
        quantidadeEntrada: qtdNum,
        saldoAtual: qtdNum,
        unidade,
        dataInicio: dadosLavoura?.dataInicio || '',
        localArmazenagem: local.trim(),
        classificacao: classificacao.trim(),
        qualidade: qualidade || {},
        idLote: idLote.trim(),
        colheitaOrigemId: `${safra.id}_${lavoura.id}`,
        cancelado: false,
        uid: safra.uid || usuario.uid,
        criadoEm: new Date(),
      })
      await onSalvo()
      onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Entrada no estoque</h2>
            <p className="text-xs text-gray-400 mt-0.5">{cultura} · {safra?.nome} · {lavoura?.nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ID / Referência do lote</label>
              <input type="text" value={idLote} onChange={e => setIdLote(e.target.value)}
                placeholder="Código do lote"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Quantidade ({getLabelUnidade(unidade)}) <span className="text-red-500">*</span>
              </label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)}
                min={0.01} step="any" placeholder="0"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Local de armazenagem <span className="text-red-500">*</span>
            </label>
            <AutocompleteInput value={local} onChange={setLocal}
              placeholder="Ex: Silo Fazenda, Cooperativa..."
              sugestoes={sugestoesLocal}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {(camposQ?.length > 0) && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">
                Qualidade <span className="text-gray-400 font-normal">(opcional)</span>
              </p>
              <div className="bg-gray-50 rounded-xl p-3">
                <CamposQualidade camposQ={camposQ} qualidade={qualidade} setQualidade={setQualidade}
                  classificacao={classificacao} setClassificacao={setClassificacao} />
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
            style={{ background: 'var(--brand-gradient)' }}>
            {salvando ? 'Salvando...' : 'Confirmar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Producao() {
  const { usuario, propriedadesCompartilhadas } = useAuth()
  const [colheitas, setColheitas] = useState([])
  const [lotesEstoque, setLotesEstoque] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [sugestoesLocal, setSugestoesLocal] = useState([])
  const [gruposExpandidos, setGruposExpandidos] = useState({})
  const [aba, setAba] = useState('atuais')
  const [modalStatus, setModalStatus] = useState(null)
  const [modalEstoque, setModalEstoque] = useState(null)
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)
  const [buscaLavoura, setBuscaLavoura] = useState('')
  const [ordenacao, setOrdenacao] = useState('alfabetica')
  const [dropdownOrdemAberto, setDropdownOrdemAberto] = useState(false)
  const [modalConcluir, setModalConcluir] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)

  async function carregar() {
    const uid = usuario.uid
    const [colSnap, estSnap, propSnap, safSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'estoqueProducao'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])
    const minhasCol = colSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const meusLotes = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const minhasProps = propSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const minhasSafras = safSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const minhasLavs = lavSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const idsComp = (propriedadesCompartilhadas || [])
      .filter(c => c.permissoes.includes('producao'))
      .map(c => c.propriedadeId)

    let colComp = [], lotesComp = [], propsComp = [], safrasComp = [], lavsComp = []
    for (const propId of idsComp) {
      const [cs, es, ps, ss, ls] = await Promise.all([
        getDocs(query(collection(db, 'colheitas'), where('propriedadeId', '==', propId))),
        getDocs(query(collection(db, 'estoqueProducao'), where('propriedadeId', '==', propId))),
        getDocs(query(collection(db, 'propriedades'), where('__name__', '==', propId))),
        getDocs(query(collection(db, 'safras'), where('propriedadeId', '==', propId))),
        getDocs(query(collection(db, 'lavouras'), where('propriedadeId', '==', propId))),
      ])
      colComp.push(...cs.docs.map(d => ({ id: d.id, ...d.data(), _compartilhada: true })))
      lotesComp.push(...es.docs.map(d => ({ id: d.id, ...d.data(), _compartilhada: true })))
      propsComp.push(...ps.docs.map(d => ({ id: d.id, ...d.data(), _compartilhada: true })))
      safrasComp.push(...ss.docs.map(d => ({ id: d.id, ...d.data(), _compartilhada: true })))
      lavsComp.push(...ls.docs.map(d => ({ id: d.id, ...d.data(), _compartilhada: true })))
    }

    const todosLotes = [...meusLotes, ...lotesComp]
    setColheitas([...minhasCol, ...colComp])
    setLotesEstoque(todosLotes)
    setPropriedades([...minhasProps, ...propsComp])
    setSafras([...minhasSafras, ...safrasComp])
    setLavouras([...minhasLavs, ...lavsComp])
    setSugestoesLocal([...new Set(todosLotes.map(l => l.localArmazenagem).filter(Boolean))])
  }

  useEffect(() => { carregar() }, [])

  useEffect(() => {
    function fechar(e) {
      if (!e.target.closest('[data-dropdown-prod]')) setDropdownFiltroAberto(false)
      if (!e.target.closest('[data-dropdown-ordem]')) setDropdownOrdemAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const safrasAtuais = useMemo(() =>
    safras.filter(s => s.status === 'Em andamento' || s.status === 'Planejada'), [safras])
  const safrasPassadas = useMemo(() =>
    safras.filter(s => s.status !== 'Em andamento' && s.status !== 'Planejada'), [safras])
  const safrasDaAba = aba === 'atuais' ? safrasAtuais : safrasPassadas

  const safrasFiltradas = useMemo(() => {
    let base = safrasDaAba
    if (filtroPropriedadeIds.length > 0)
      base = base.filter(s => filtroPropriedadeIds.includes(s.propriedadeId))
    if (filtroSafraId) base = base.filter(s => s.id === filtroSafraId)
    return base
  }, [safrasDaAba, filtroPropriedadeIds, filtroSafraId])

  const mapaStatus = useMemo(() => {
    const m = {}
    colheitas.forEach(c => { m[`${c.safraId}_${c.lavouraId}`] = c })
    return m
  }, [colheitas])

  const mapaLotes = useMemo(() => {
    const m = {}
    lotesEstoque.filter(l => !l.cancelado).forEach(l => {
      const key = l.colheitaOrigemId || ''
      if (!m[key]) m[key] = []
      m[key].push(l)
    })
    return m
  }, [lotesEstoque])

  function getStatus(safraId, lavouraId) {
    return mapaStatus[`${safraId}_${lavouraId}`] || null
  }

  function qtdEstocada(safraId, lavouraId) {
    return (mapaLotes[`${safraId}_${lavouraId}`] || [])
      .reduce((s, l) => s + (Number(l.quantidadeEntrada) || 0), 0)
  }

  function expandidoPorPadrao(safraId) {
    return safraId in gruposExpandidos ? gruposExpandidos[safraId] : aba === 'atuais'
  }

  function toggleGrupo(safraId) {
    setGruposExpandidos(g => ({ ...g, [safraId]: !expandidoPorPadrao(safraId) }))
  }

  async function verificarConclusaoSafra(safraId) {
    const safra = safras.find(s => s.id === safraId)
    if (!safra || safra.status === 'Colhida') return
    const lavVinc = lavouras.filter(l => safra.lavouraIds?.includes(l.id))
    if (!lavVinc.length) return
    // Reler mapaStatus atualizado
    const snap = await getDocs(query(collection(db, 'colheitas'), where('safraId', '==', safraId)))
    const statusMapa = {}
    snap.docs.forEach(d => { statusMapa[d.data().lavouraId] = d.data() })
    const todasColhidas = lavVinc.every(l => statusMapa[l.id]?.statusColheita === 'colhida')
    if (!todasColhidas) return
    const datas = lavVinc.map(l => statusMapa[l.id]?.dataFim).filter(Boolean).sort()
    setModalConcluir({ safraId, safraNome: safra.nome, dataTermino: datas[datas.length - 1] || HOJE })
  }

  async function concluirSafra() {
    await updateDoc(doc(db, 'safras', modalConcluir.safraId), {
      status: 'Colhida', dataTermino: modalConcluir.dataTermino
    })
    setSafras(prev => prev.map(s =>
      s.id === modalConcluir.safraId
        ? { ...s, status: 'Colhida', dataTermino: modalConcluir.dataTermino }
        : s
    ))
    setModalConcluir(null)
  }

  const OPCOES_ORDEM = [
    { val: 'alfabetica', label: 'Alfabética' },
    { val: 'area_desc', label: 'Maior área' },
    { val: 'area_asc', label: 'Menor área' },
    { val: 'inicio_recente', label: 'Início mais recente' },
    { val: 'inicio_antigo', label: 'Início mais antigo' },
  ]

  function ordenarLavouras(lavs, safraId) {
    return [...lavs].sort((a, b) => {
      if (ordenacao === 'alfabetica') return a.nome.localeCompare(b.nome)
      if (ordenacao === 'area_desc') return (Number(b.areaHa) || 0) - (Number(a.areaHa) || 0)
      if (ordenacao === 'area_asc') return (Number(a.areaHa) || 0) - (Number(b.areaHa) || 0)
      const dA = mapaStatus[`${safraId}_${a.id}`]?.dataInicio || ''
      const dB = mapaStatus[`${safraId}_${b.id}`]?.dataInicio || ''
      return ordenacao === 'inicio_recente' ? dB.localeCompare(dA) : dA.localeCompare(dB)
    })
  }

  const STATUS_VISUAL = {
    nao_iniciada: { label: 'Não iniciada', cor: 'bg-gray-100 text-gray-600' },
    em_andamento: { label: 'Em andamento', cor: 'bg-blue-100 text-blue-700' },
    colhida:      { label: 'Colhida',      cor: 'bg-green-100 text-green-700' },
  }

  function badgeStatus(st) {
    const v = STATUS_VISUAL[st] || STATUS_VISUAL['nao_iniciada']
    return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium leading-tight ${v.cor}`}>{v.label}</span>
  }

  return (
    <div className="space-y-5 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Produção</h1>
      {DEBUG_CUSTO && <PainelDebugCusto safras={safras} />}

      {/* Filtros */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">

          {/* Filtro propriedade */}
          <div className="relative" data-dropdown-prod>
            <button type="button" onClick={() => setDropdownFiltroAberto(a => !a)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none min-w-[160px] flex items-center justify-between gap-2">
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
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[160px] py-1 max-h-48 overflow-y-auto">
                {propriedades.map(p => {
                  const sel = filtroPropriedadeIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setFiltroPropriedadeIds(ids =>
                        sel ? ids.filter(i => i !== p.id) : [...ids, p.id]
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

          {/* Filtro safra */}
          {safrasFiltradas.length > 1 && (
            <select value={filtroSafraId} onChange={e => setFiltroSafraId(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none">
              <option value="">Todas as safras</option>
              {safrasFiltradas.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}

          {(filtroPropriedadeIds.length > 0 || filtroSafraId) && (
            <button onClick={() => { setFiltroPropriedadeIds([]); setFiltroSafraId('') }}
              className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>
          )}

          {/* Busca lavoura */}
          <div className="relative flex-1 min-w-[140px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={buscaLavoura} onChange={e => setBuscaLavoura(e.target.value)}
              placeholder="Buscar lavoura..."
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
            {buscaLavoura && (
              <button onClick={() => setBuscaLavoura('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={11} />
              </button>
            )}
          </div>

          {/* Ordenação */}
          <div className="relative" data-dropdown-ordem>
            <button type="button" onClick={() => setDropdownOrdemAberto(a => !a)}
              className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none">
              <ArrowUpDown size={12} className="text-gray-400" />
              <span className="text-gray-600 hidden sm:inline">
                {OPCOES_ORDEM.find(o => o.val === ordenacao)?.label}
              </span>
            </button>
            {dropdownOrdemAberto && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[160px] py-1">
                {OPCOES_ORDEM.map(o => (
                  <button key={o.val} type="button"
                    onClick={() => { setOrdenacao(o.val); setDropdownOrdemAberto(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${ordenacao === o.val ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Abas Atuais / Passadas */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ val: 'atuais', label: 'Safras Atuais' }, { val: 'passadas', label: 'Safras Passadas' }].map(a => (
          <button key={a.val}
            onClick={() => { setAba(a.val); setFiltroSafraId(''); setGruposExpandidos({}) }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a.val ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {safrasFiltradas.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{aba === 'atuais' ? 'Nenhuma safra atual.' : 'Nenhuma safra passada.'}</p>
        </div>
      )}

      {/* Lista de safras */}
      <div className="space-y-4">
        {safrasFiltradas.map(safra => {
          const lavVinc = lavouras.filter(l => safra.lavouraIds?.includes(l.id))
          const expandido = expandidoPorPadrao(safra.id)

          const naoIniciadas = lavVinc.filter(l => {
            const st = getStatus(safra.id, l.id)
            return !st || st.statusColheita === 'nao_iniciada'
          })
          const emAndamento = lavVinc.filter(l => getStatus(safra.id, l.id)?.statusColheita === 'em_andamento')
          const colhidas    = lavVinc.filter(l => getStatus(safra.id, l.id)?.statusColheita === 'colhida')

          const areaNaoIniciada = naoIniciadas.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)
          const areaEmAndamento = emAndamento.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)
          const areaColhida     = colhidas.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)

          const lavFiltradas = buscaLavoura.trim()
            ? lavVinc.filter(l => l.nome.toLowerCase().includes(buscaLavoura.toLowerCase()))
            : lavVinc
          const lavOrdenadas = ordenarLavouras(lavFiltradas, safra.id)

          return (
            <div key={safra.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

              {/* Cabeçalho clicável */}
              <button type="button" onClick={() => toggleGrupo(safra.id)}
                className="w-full text-left hover:brightness-95 transition-colors"
                style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--brand-gradient)' }}>
                      <IconeCultura nomeCultura={safra.cultura} size={13} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{safra.nome}</p>
                      <p className="text-xs text-gray-400">{safra.cultura} · {safra.propriedadeNome || ''}</p>
                    </div>
                  </div>
                  {expandido
                    ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" />
                    : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
                </div>

                {/* 3 quadrantes de status */}
                <div className="flex items-stretch border-t border-green-100 mt-1">
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    <p className="text-sm font-bold text-gray-500 leading-tight">{naoIniciadas.length}</p>
                    <p className="text-xs text-gray-400 leading-tight text-center">não iniciada{naoIniciadas.length !== 1 ? 's' : ''}</p>
                    {areaNaoIniciada > 0 && <p className="text-xs text-gray-300 leading-tight">{formatarNumero(areaNaoIniciada)} ha</p>}
                  </div>
                  <div className="w-px bg-green-100 self-stretch" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    <p className="text-sm font-bold text-blue-600 leading-tight">{emAndamento.length}</p>
                    <p className="text-xs text-gray-400 leading-tight text-center">em andamento</p>
                    {areaEmAndamento > 0 && <p className="text-xs text-blue-300 leading-tight">{formatarNumero(areaEmAndamento)} ha</p>}
                  </div>
                  <div className="w-px bg-green-100 self-stretch" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    <p className="text-sm font-bold text-green-600 leading-tight">{colhidas.length}</p>
                    <p className="text-xs text-gray-400 leading-tight text-center">colhida{colhidas.length !== 1 ? 's' : ''}</p>
                    {areaColhida > 0 && <p className="text-xs text-green-300 leading-tight">{formatarNumero(areaColhida)} ha</p>}
                  </div>
                </div>
              </button>

              {/* Lista de lavouras expandida */}
              {expandido && (
                <div className="border-t border-gray-100">
                  {lavOrdenadas.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 py-3">
                      {buscaLavoura ? 'Nenhuma lavoura encontrada.' : 'Nenhuma lavoura vinculada a esta safra.'}
                    </p>
                  ) : lavOrdenadas.map((lav, idx) => {
                    const dadosStatus = getStatus(safra.id, lav.id)
                    const statusColheita = dadosStatus?.statusColheita || 'nao_iniciada'
                    const qtd = qtdEstocada(safra.id, lav.id)
                    const bgZ = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    const isComp = lav._compartilhada || safra._compartilhada

                    return (
                      <div key={lav.id}
                        className={`${bgZ} px-4 py-3 border-b border-gray-100 last:border-0`}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium text-gray-800 leading-tight">{lav.nome}</p>
                              {badgeStatus(statusColheita)}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              <span className="text-xs text-gray-400">{formatarNumero(lav.areaHa)} ha</span>
                              {dadosStatus?.dataInicio && (
                                <span className="text-xs text-gray-400">
                                  Início: {formatarData(dadosStatus.dataInicio)}
                                </span>
                              )}
                              {dadosStatus?.dataFim && (
                                <span className="text-xs text-gray-400">
                                  Fim: {formatarData(dadosStatus.dataFim)}
                                </span>
                              )}
                              {qtd > 0 && (
                                <span className="text-xs text-green-600 font-medium">
                                  <CheckCircle size={10} className="inline mr-0.5" />
                                  {formatarNumero(qtd)} {safra.unidade || 'sc'} estocado{qtd !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>

                          {(() => {
                            const podeEditar = !isComp || propriedadesCompartilhadas.find(c => c.propriedadeId === safra.propriedadeId)?.permissoes.includes('producao')
                            return podeEditar ? (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => setModalStatus({ lavoura: lav, safra, dadosStatus })}
                                className="text-xs border border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-700 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                                Status
                              </button>
                              <button
                                onClick={() => setModalEstoque({ lavoura: lav, safra, dadosStatus })}
                                className="flex items-center gap-1 text-xs text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:opacity-90 whitespace-nowrap"
                                style={{ background: 'var(--brand-gradient)' }}>
                                <PackagePlus size={12} />
                                <span className="hidden sm:inline">Estoque</span>
                              </button>
                            </div>
                            ) : null
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal Atualizar Status */}
      {modalStatus && (
        <ModalAtualizarStatus
          lavoura={modalStatus.lavoura}
          safra={modalStatus.safra}
          dadosStatus={modalStatus.dadosStatus}
          onClose={() => setModalStatus(null)}
          onSalvo={async () => {
            await carregar()
            await verificarConclusaoSafra(modalStatus.safra.id)
          }}
        />
      )}

      {/* Modal Entrada no Estoque */}
      {modalEstoque && (
        <ModalEntradaEstoque
          dadosLavoura={modalEstoque.dadosStatus}
          safra={modalEstoque.safra}
          lavoura={modalEstoque.lavoura}
          sugestoesLocal={sugestoesLocal}
          onClose={() => setModalEstoque(null)}
          onSalvo={carregar}
        />
      )}

      {/* Modal Concluir Safra */}
      {modalConcluir && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle size={20} className="text-green-600" />
              </div>
              <h3 className="font-bold text-gray-800">Safra concluída!</h3>
            </div>
            <p className="text-sm text-gray-600">
              Todas as lavouras da safra <span className="font-semibold">{modalConcluir.safraNome}</span> foram colhidas.
            </p>
            <p className="text-sm text-gray-600">
              Marcar como <span className="font-semibold text-green-700">Colhida</span> com data de término{' '}
              <span className="font-semibold">{formatarData(modalConcluir.dataTermino)}</span>?
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setModalConcluir(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={concluirSafra}
                className="flex-1 text-white py-2 rounded-xl text-sm font-medium shadow-md"
                style={{ background: 'var(--brand-gradient)' }}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação genérica */}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Confirmar</h3>
            <p className="text-sm text-gray-600">{confirmacao.mensagem}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmacao(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => { confirmacao.onConfirmar(); setConfirmacao(null) }}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}