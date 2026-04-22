import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, Wheat, Pencil, X, ChevronDown, ChevronUp, CheckCircle, AlertCircle, PackagePlus, Search, Info } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { getCamposQualidade, getCultura, UNIDADES, getLabelUnidade } from '../config/culturasConfig'
import { formatarCustoEstimado, DEBUG_CUSTO } from '../hooks/useCustoProducao'
import { PainelDebugCusto } from '../components/PainelDebugCusto'

function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}
function formatarNumero(valor, decimais = 2) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais })
}
function nomeMes(chave) {
  if (!chave) return 'Sem data'
  const [y, m] = chave.split('-')
  try { return format(new Date(Number(y), Number(m) - 1), 'MMMM yyyy', { locale: ptBR }) } catch { return chave }
}
function getHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HOJE = getHoje()

const FORM_PADRAO = {
  safraId: '', lavouraId: '', dataColheita: '', errData: '',
  quantidade: '', unidade: 'sc', observacoes: '',
  colheitaConcluida: false, // toggle: 'Colheita desta lavoura concluída'
}

function IconeCultura({ nomeCultura, size = 14 }) {
  const config = getCultura(nomeCultura)
  if (config?.icone) return <span style={{ fontSize: size + 2, lineHeight: 1 }}>{config.icone}</span>
  return <Wheat size={size} className="text-white" />
}

function AutocompleteInput({ value, onChange, placeholder, sugestoes, className }) {
  const [aberto, setAberto] = useState(false)
  const filtradas = useMemo(
    () => value.length >= 1 ? sugestoes.filter(s => s.toLowerCase().startsWith(value.toLowerCase()) && s !== value) : [],
    [value, sugestoes]
  )
  return (
    <div className="relative">
      <input type="text" value={value}
        onChange={e => { onChange(e.target.value); setAberto(true) }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={placeholder} className={className} />
      {aberto && filtradas.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
          {filtradas.map(s => (
            <button key={s} type="button" onMouseDown={() => { onChange(s); setAberto(false) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-gray-700">{s}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function CamposQualidade({ camposQ, qualidade, setQualidade, classificacao, setClassificacao }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Classificação própria <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input type="text" value={classificacao} onChange={e => setClassificacao(e.target.value)}
          placeholder="Ex: padrão exportação, código cooperativa, armazém..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>
      {camposQ.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {camposQ.map(c => (
            <div key={c.key}>
              <label className="block text-xs text-gray-500 mb-1">{c.label}{c.unidade ? ` (${c.unidade})` : ''}</label>
              {c.tipo === 'select' ? (
                <select value={qualidade[c.key] || ''} onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  <option value="">—</option>
                  {c.opcoes.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type="number" step="0.1" value={qualidade[c.key] || ''}
                  onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
                  placeholder={`${c.min ?? 0}–${c.max ?? ''}`}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ModalEntradaEstoque({ colheita, totalLotesExistentes, sugestoesLocal, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const camposQ = getCamposQualidade(colheita.cultura || '')
  const unidade = colheita.unidade || 'sc'
  const saldoMax = Number(colheita.saldoDisponivel) || Number(colheita.quantidade) || 0

  const [idLote, setIdLote] = useState('')
  const [local, setLocal] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const [qualidade, setQualidade] = useState({})
  const [quantidade, setQuantidade] = useState(String(saldoMax))
  const [salvando, setSalvando] = useState(false)

  const qtdNum = Number(quantidade) || 0
  const excedeSaldo = qtdNum > saldoMax
  const invalido = !local.trim() || !quantidade || qtdNum <= 0 || excedeSaldo

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      await addDoc(collection(db, 'estoqueProducao'), {
        cultura: colheita.cultura || '', safraId: colheita.safraId || '', safraNome: colheita.safraNome || '',
        lavouraId: colheita.lavouraId || '', lavouraNome: colheita.lavouraNome || '',
        propriedadeId: colheita.propriedadeId || '', propriedadeNome: colheita.propriedadeNome || '',
        quantidadeEntrada: qtdNum, saldoAtual: qtdNum, unidade,
        dataColheita: colheita.dataColheita || '', localArmazenagem: local.trim(),
        classificacao: classificacao.trim(), qualidade: qualidade || {},
        idLote: idLote.trim(), colheitaOrigemId: colheita.id,
        cancelado: false, uid: usuario.uid, criadoEm: new Date(),
      })
      onSalvo(); onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Dar entrada no estoque</h2>
            <p className="text-xs text-gray-400 mt-0.5">{colheita.cultura} · {colheita.safraNome} · {colheita.lavouraNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs text-amber-700">Saldo a armazenar</span>
            <span className="text-sm font-bold text-amber-800">{saldoMax.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {unidade}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ID / Referência do lote</label>
              <input type="text" value={idLote} onChange={e => setIdLote(e.target.value)} placeholder="Código de referência do lote"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Quantidade ({unidade}){excedeSaldo && <span className="text-red-500 ml-1">— máx. {saldoMax}</span>}
              </label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)} max={saldoMax} min={0.01} step="any"
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 ${excedeSaldo ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-green-500'}`} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de armazenagem <span className="text-red-500">*</span></label>
            <AutocompleteInput value={local} onChange={setLocal} placeholder="Ex: Silo Fazenda, Cooperativa ABC..." sugestoes={sugestoesLocal}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Qualidade <span className="text-gray-400 font-normal">(opcional)</span></p>
            <div className="bg-gray-50 rounded-xl p-3">
              <CamposQualidade camposQ={camposQ} qualidade={qualidade} setQualidade={setQualidade} classificacao={classificacao} setClassificacao={setClassificacao} />
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md"
            style={{ background: invalido ? '#86efac' : 'var(--brand-gradient)' }}>
            {salvando ? 'Salvando...' : 'Confirmar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Producao() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [lavouras, setLavouras] = useState([])
  const [lotesEstoque, setLotesEstoque] = useState([])
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_PADRAO)
  const [loading, setLoading] = useState(false)
  const [fabAberto, setFabAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState(null)
  const [modalConcluir, setModalConcluir] = useState(null)
  const [modalIniciar, setModalIniciar] = useState(null)
  const [gruposExpandidos, setGruposExpandidos] = useState({})
  const [aba, setAba] = useState('atuais')
  const [visaoProd, setVisaoProd] = useState('lavoura') // 'lavoura' | 'mes'
  const [modalLavoura, setModalLavoura] = useState(null)
  const [buscaLavoura, setBuscaLavoura] = useState('')
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownFiltroAberto, setDropdownFiltroAberto] = useState(false)
  const [modalEntradaEstoque, setModalEntradaEstoque] = useState(null)
  const [sugestoesLocal, setSugestoesLocal] = useState([])
  const [darEntradaEstoque, setDarEntradaEstoque] = useState(false)
  const [idLoteEstoque, setIdLoteEstoque] = useState('')
  const [localArmazenagem, setLocalArmazenagem] = useState('')
  const [classificacaoEstoque, setClassificacaoEstoque] = useState('')
  const [qualidadeEstoque, setQualidadeEstoque] = useState({})

  async function carregar() {
    const uid = usuario.uid
    const [colSnap, propSnap, safSnap, lavSnap, estSnap] = await Promise.all([
      getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'estoqueProducao'), where('uid', '==', uid))),
    ])
    setLista(colSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLavouras(lavSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    const lotes = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setLotesEstoque(lotes)
    setSugestoesLocal([...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))])
  }

  // Reler apenas colheitas + estoqueProdução após mutações
  async function recarregarColheitas() {
    const uid = usuario.uid
    const [colSnap, estSnap] = await Promise.all([
      getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'estoqueProducao'), where('uid', '==', uid))),
    ])
    setLista(colSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    const lotes = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    setLotesEstoque(lotes)
    setSugestoesLocal([...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))])
  }

  // Reler apenas safras (para concluir/iniciar safra)
  async function recarregarSafras() {
    const snap = await getDocs(query(collection(db, 'safras'), where('uid', '==', usuario.uid)))
    setSafras(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  useEffect(() => { carregar() }, [])
  useEffect(() => {
    function fechar(e) { if (!e.target.closest('[data-dropdown-prod]')) setDropdownFiltroAberto(false) }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const safraSelecionada = useMemo(() => safras.find(s => s.id === form.safraId) || null, [safras, form.safraId])
  const lavourasDaSafra = useMemo(() => {
    if (!safraSelecionada) return []
    return lavouras.filter(l => safraSelecionada.lavouraIds?.includes(l.id))
  }, [safraSelecionada, lavouras])
  const camposQualidadeEstoque = useMemo(() => {
    if (!safraSelecionada?.cultura) return []
    return getCamposQualidade(safraSelecionada.cultura)
  }, [safraSelecionada])
  const safrasParaModal = useMemo(() => {
    if (editando) return safras
    return safras.filter(s => s.status === 'Em andamento' || s.status === 'Planejada')
  }, [safras, editando])
  const safrasAtuais = useMemo(() => safras.filter(s => s.status === 'Em andamento' || s.status === 'Planejada'), [safras])
  const safrasPassadas = useMemo(() => safras.filter(s => s.status !== 'Em andamento' && s.status !== 'Planejada'), [safras])
  const safrasDaAba = aba === 'atuais' ? safrasAtuais : safrasPassadas

  const listaFiltrada = useMemo(() => {
    const safraIdsAba = safrasDaAba.map(s => s.id)
    let resultado = lista.filter(c => safraIdsAba.includes(c.safraId))
    if (filtroPropriedadeIds.length > 0) resultado = resultado.filter(c => filtroPropriedadeIds.includes(c.propriedadeId))
    if (filtroSafraId) resultado = resultado.filter(c => c.safraId === filtroSafraId)
    return resultado
  }, [lista, safrasDaAba, filtroPropriedadeIds, filtroSafraId])

  const agrupado = useMemo(() => {
    const mapaColheitas = {}
    listaFiltrada.forEach(c => {
      const safraId = c.safraId || ''
      const chaveMes = c.dataColheita ? c.dataColheita.substring(0, 7) : 'sem-data'
      if (!mapaColheitas[safraId]) mapaColheitas[safraId] = {}
      if (!mapaColheitas[safraId][chaveMes]) mapaColheitas[safraId][chaveMes] = []
      mapaColheitas[safraId][chaveMes].push(c)
    })
    return safrasDaAba
      .filter(s => {
        if (filtroPropriedadeIds.length > 0 && !filtroPropriedadeIds.includes(s.propriedadeId)) return false
        if (filtroSafraId && s.id !== filtroSafraId) return false
        return true
      })
      .map(s => {
        const colheitasDaSafra = listaFiltrada.filter(c => c.safraId === s.id)
        const lavourasVinculadas = lavouras.filter(l => s.lavouraIds?.includes(l.id))
        const totalColhido = colheitasDaSafra.reduce((a, c) => a + (Number(c.quantidade) || 0), 0)
        const unidade = s.unidade || colheitasDaSafra[0]?.unidade || 'sc'
        const areaTotal = lavourasVinculadas.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
        const produtividade = areaTotal > 0 ? totalColhido / areaTotal : null
        const lavouraIdsComColheita = [...new Set(colheitasDaSafra.map(c => c.lavouraId).filter(Boolean))]
        // Lavoura "concluída" = tem colheita com colheitaConcluida === true
        const lavouraIdsConcluidas = [...new Set(
          colheitasDaSafra.filter(c => c.colheitaConcluida === true).map(c => c.lavouraId).filter(Boolean)
        )]
        // Pendente = sem colheita OU com colheita mas sem conclusão
        const lavourasPendentes = lavourasVinculadas.filter(l => !lavouraIdsConcluidas.includes(l.id))
        const areaPendente = lavourasPendentes.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
        const todasConcluidas = lavourasVinculadas.length > 0 && lavourasVinculadas.every(l => lavouraIdsConcluidas.includes(l.id))
        const chavesOrdenadas = Object.keys(mapaColheitas[s.id] || {}).sort((a, b) => b.localeCompare(a))
        return {
          safraId: s.id, safraNome: s.nome, cultura: s.cultura, unidade,
          totalColhido, produtividade, nColheitas: colheitasDaSafra.length,
          lavourasPendentes: lavourasPendentes.length, areaPendente, todasConcluidas,
          custoEstimado: s.custoEstimado || null,
          // Ponto 7: itens dentro de cada mês ordenados do mais recente para o mais antigo
          meses: chavesOrdenadas.map(chave => {
            const itens = [...mapaColheitas[s.id][chave]].sort((a, b) =>
              (b.dataColheita || '').localeCompare(a.dataColheita || '')
            )
            return { chave, itens, totalMes: itens.reduce((a, c) => a + (Number(c.quantidade) || 0), 0) }
          }),
        }
      })
      .filter(g => g.nColheitas > 0)
  }, [safrasDaAba, listaFiltrada, lavouras, filtroPropriedadeIds, filtroSafraId])

  const safrasFiltradasParaSelect = useMemo(() => {
    let base = safrasDaAba
    if (filtroPropriedadeIds.length > 0) base = base.filter(s => filtroPropriedadeIds.includes(s.propriedadeId))
    return base
  }, [safrasDaAba, filtroPropriedadeIds])

  // Visão por lavoura — safra → lavoura (inclui lavouras pendentes)
  const agrupadoPorLavoura = useMemo(() => {
    return agrupado.map(grupo => {
      const safra = safrasDaAba.find(s => s.id === grupo.safraId)
      const lavourasVinculadas = lavouras.filter(l => safra?.lavouraIds?.includes(l.id))
      return {
        ...grupo,
        lavouras: lavourasVinculadas.map(lav => {
          const colheitasLav = listaFiltrada.filter(c => c.safraId === grupo.safraId && c.lavouraId === lav.id)
          const totalColhidoLav = colheitasLav.reduce((a, c) => a + (Number(c.quantidade) || 0), 0)
          const produtividadeLav = Number(lav.areaHa) > 0 ? totalColhidoLav / Number(lav.areaHa) : null
          const lotesLav = lotesEstoque.filter(l => !l.cancelado && colheitasLav.some(c => c.id === l.colheitaOrigemId))
          const qtdEstocada = lotesLav.reduce((s, l) => s + (Number(l.quantidadeEntrada) || 0), 0)
          const saldoDisponivel = Math.max(0, totalColhidoLav - qtdEstocada)
          const custoLav = grupo.custoEstimado?.porLavoura?.[lav.id]
          const ultimaColheita = [...colheitasLav].sort((a, b) => (b.dataColheita || '').localeCompare(a.dataColheita || ''))[0] || null
          // Status agronômico (colheita): baseado no toggle colheitaConcluida
          const colheitaConcluida = colheitasLav.some(c => c.colheitaConcluida === true)
          let statusColheita = 'pendente' // sem colheita
          if (colheitasLav.length > 0) statusColheita = colheitaConcluida ? 'concluida' : 'em_colheita'
          // Status logístico (estoque)
          let statusEstoque = 'sem_colheita'
          if (colheitasLav.length > 0) {
            if (saldoDisponivel === 0 && qtdEstocada > 0) statusEstoque = 'estocado'
            else if (qtdEstocada > 0) statusEstoque = 'parcial'
            else statusEstoque = 'nao_estocado'
          }
          return {
            lav, colheitas: colheitasLav, totalColhido: totalColhidoLav,
            produtividade: produtividadeLav, qtdEstocada, saldoDisponivel,
            custoSc: custoLav?.custoSc ?? null,
            statusColheita, statusEstoque, ultimaColheita,
          }
        }),
      }
    })
  }, [agrupado, safrasDaAba, lavouras, listaFiltrada, lotesEstoque])

  function expandidoPorPadrao(safraId) { return safraId in gruposExpandidos ? gruposExpandidos[safraId] : aba === 'atuais' }
  function toggleGrupo(safraId) { setGruposExpandidos(g => ({ ...g, [safraId]: !expandidoPorPadrao(safraId) })) }

  function abrirModal() {
    setEditando(null); setForm(FORM_PADRAO); setDarEntradaEstoque(false)
    setIdLoteEstoque(''); setLocalArmazenagem(''); setClassificacaoEstoque(''); setQualidadeEstoque({})
    setFabAberto(false); setModal(true)
  }
  function abrirEdicao(c) {
    setEditando(c.id)
    setForm({ safraId: c.safraId || '', lavouraId: c.lavouraId || '', dataColheita: c.dataColheita || '', errData: '', quantidade: String(c.quantidade || ''), unidade: c.unidade || 'sc', observacoes: c.observacoes || '', colheitaConcluida: c.colheitaConcluida === true })
    setDarEntradaEstoque(false); setIdLoteEstoque(''); setLocalArmazenagem(''); setClassificacaoEstoque(''); setQualidadeEstoque({})
    setModal(true)
  }
  function onChangeData(val) { setForm(f => ({ ...f, dataColheita: val, errData: val > HOJE ? 'A data não pode ser no futuro.' : '' })) }
  function selecionarSafra(safraId) {
    const safra = safras.find(s => s.id === safraId)
    setForm(f => ({ ...f, safraId, lavouraId: '', unidade: safra?.unidade || f.unidade }))
    setQualidadeEstoque({})
  }

  async function verificarConclusaoSafra(safraId, novaLavouraId, novaData) {
    const safra = safras.find(s => s.id === safraId)
    if (!safra || safra.status === 'Colhida') return
    const lavourasVinculadas = lavouras.filter(l => safra.lavouraIds?.includes(l.id))
    if (lavourasVinculadas.length === 0) return
    const snap = await getDocs(query(collection(db, 'colheitas'), where('uid', '==', usuario.uid), where('safraId', '==', safraId)))
    const colheitasSafra = snap.docs.map(d => d.data())
    const lavouraIdsColhidos = new Set([...colheitasSafra.map(c => c.lavouraId).filter(Boolean), novaLavouraId])
    if (!lavourasVinculadas.every(l => lavouraIdsColhidos.has(l.id))) return
    const datas = [...colheitasSafra.map(c => c.dataColheita).filter(Boolean), novaData].sort()
    setModalConcluir({ safraId, safraNome: safra.nome, dataTermino: datas[datas.length - 1] })
  }

  async function concluirSafra() {
    await updateDoc(doc(db, 'safras', modalConcluir.safraId), { status: 'Colhida', dataTermino: modalConcluir.dataTermino })
    setSafras(prev => prev.map(s => s.id === modalConcluir.safraId ? { ...s, status: 'Colhida', dataTermino: modalConcluir.dataTermino } : s))
    setModalConcluir(null)
  }
  async function confirmarIniciarSafra() {
    await updateDoc(doc(db, 'safras', modalIniciar.safraId), { status: 'Em andamento' })
    setSafras(prev => prev.map(s => s.id === modalIniciar.safraId ? { ...s, status: 'Em andamento' } : s))
    setModalIniciar(null)
  }
  async function cancelarIniciarSafra() {
    if (!modalIniciar) return
    await deleteDoc(doc(db, 'colheitas', modalIniciar.colheitaId))
    setLista(prev => prev.filter(c => c.id !== modalIniciar.colheitaId))
    setModalIniciar(null)
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.safraId) return alert('Selecione uma safra.')
    if (!form.quantidade || isNaN(Number(form.quantidade))) return alert('Informe a quantidade colhida.')
    if (form.dataColheita > HOJE) return
    setLoading(true)
    const safra = safras.find(s => s.id === form.safraId)
    const lavoura = lavouras.find(l => l.id === form.lavouraId)
    const prop = propriedades.find(p => p.id === safra?.propriedadeId)
    const payload = {
      safraId: form.safraId, safraNome: safra?.nome || '', cultura: safra?.cultura || '',
      lavouraId: form.lavouraId || '', lavouraNome: lavoura?.nome || '',
      propriedadeId: safra?.propriedadeId || '', propriedadeNome: prop?.nome || '',
      dataColheita: form.dataColheita, quantidade: Number(form.quantidade),
      unidade: form.unidade, observacoes: form.observacoes || '',
      colheitaConcluida: form.colheitaConcluida === true,
      uid: usuario.uid,
    }
    let colheitaId = editando
    if (editando) { await updateDoc(doc(db, 'colheitas', editando), payload) }
    else { const docRef = await addDoc(collection(db, 'colheitas'), { ...payload, criadoEm: new Date() }); colheitaId = docRef.id }
    if (!editando && darEntradaEstoque && localArmazenagem.trim()) {
      await addDoc(collection(db, 'estoqueProducao'), {
        cultura: safra?.cultura || '', safraId: form.safraId, safraNome: safra?.nome || '',
        lavouraId: form.lavouraId || '', lavouraNome: lavoura?.nome || '',
        propriedadeId: safra?.propriedadeId || '', propriedadeNome: prop?.nome || '',
        quantidadeEntrada: Number(form.quantidade), saldoAtual: Number(form.quantidade),
        unidade: form.unidade, dataColheita: form.dataColheita, localArmazenagem: localArmazenagem.trim(),
        classificacao: classificacaoEstoque.trim(), qualidade: qualidadeEstoque || {},
        idLote: idLoteEstoque.trim(), colheitaOrigemId: colheitaId,
        cancelado: false, uid: usuario.uid, criadoEm: new Date(),
      })
    }
    setModal(false); setEditando(null); setForm(FORM_PADRAO); setDarEntradaEstoque(false)
    setIdLoteEstoque(''); setLocalArmazenagem(''); setClassificacaoEstoque(''); setQualidadeEstoque({})
    await recarregarColheitas(); setLoading(false)
    if (!editando) {
      if (safra?.status === 'Planejada') { setModalIniciar({ safraId: form.safraId, safraNome: safra.nome, colheitaId }); return }
      if (form.lavouraId) await verificarConclusaoSafra(form.safraId, form.lavouraId, form.dataColheita)
    }
  }

  function excluir(id, nome) {
    setConfirmacao({ mensagem: `Deseja excluir o registro de colheita "${nome}"?`, onConfirmar: async () => { await deleteDoc(doc(db, 'colheitas', id)); setLista(prev => prev.filter(c => c.id !== id)) } })
  }

  function colheitaInfoEstoque(colheitaId, quantidadeColhida) {
    const lotes = lotesEstoque.filter(l => l.colheitaOrigemId === colheitaId && !l.cancelado)
    const qtdEmEstoque = lotes.reduce((s, l) => s + (Number(l.quantidadeEntrada) || 0), 0)
    const saldoDisponivel = Math.max(0, (Number(quantidadeColhida) || 0) - qtdEmEstoque)
    return { qtdEmEstoque, saldoDisponivel, temLote: lotes.length > 0 }
  }

  function totalLotesCultura(cultura) { return lotesEstoque.filter(l => l.cultura === cultura).length }

  return (
    <div className="space-y-5 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Produção</h1>
      {DEBUG_CUSTO && <PainelDebugCusto safras={safras} />}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-prod>
            <button type="button" onClick={() => setDropdownFiltroAberto(a => !a)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[160px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">{filtroPropriedadeIds.length > 0 ? propriedades.filter(p => filtroPropriedadeIds.includes(p.id)).map(p => p.nome).join(', ') : 'Selecione a(s) Propriedade(s)'}</span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownFiltroAberto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[160px] py-1 max-h-48 overflow-y-auto">
                {propriedades.map(p => { const sel = filtroPropriedadeIds.includes(p.id); return (
                  <button key={p.id} type="button" onClick={() => setFiltroPropriedadeIds(ids => sel ? ids.filter(i => i !== p.id) : [...ids, p.id])} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50">
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>{sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}</span>
                    <span className={sel ? 'text-gray-800 font-medium' : 'text-gray-600'}>{p.nome}</span>
                  </button>
                )})}
              </div>
            )}
          </div>
          {safrasFiltradasParaSelect.length > 0 && (
            <select value={filtroSafraId} onChange={e => setFiltroSafraId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">Todas as safras</option>
              {safrasFiltradasParaSelect.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
          {(filtroPropriedadeIds.length > 0 || filtroSafraId) && <button onClick={() => { setFiltroPropriedadeIds([]); setFiltroSafraId('') }} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>}
          {/* Busca por lavoura */}
          <div className="relative flex-1 min-w-[140px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={buscaLavoura} onChange={e => setBuscaLavoura(e.target.value)}
              placeholder="Buscar lavoura..."
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50" />
            {buscaLavoura && (
              <button onClick={() => setBuscaLavoura('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={11} /></button>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {[{ val: 'atuais', label: 'Safras Atuais' }, { val: 'passadas', label: 'Safras Passadas' }].map(a => (
          <button key={a.val} onClick={() => { setAba(a.val); setFiltroSafraId(''); setGruposExpandidos({}) }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${aba === a.val ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {a.label}
          </button>
        ))}
        {/* Toggle de visão */}
        <div className="ml-auto flex items-center gap-1 pb-1">
          {[{ val: 'lavoura', label: 'Por lavoura' }, { val: 'mes', label: 'Por mês' }].map(v => (
            <button key={v.val} onClick={() => setVisaoProd(v.val)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                visaoProd === v.val ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {agrupado.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{aba === 'atuais' ? 'Nenhuma colheita registrada em safras atuais.' : 'Nenhuma colheita registrada em safras passadas.'}</p>
          <p className="text-xs mt-1 text-gray-300">Use o botão + para registrar a primeira colheita.</p>
        </div>
      )}
      <div className="space-y-4">
        {agrupado.map(grupo => {
          const expandido = expandidoPorPadrao(grupo.safraId)
          const custoFmt = formatarCustoEstimado(grupo.custoEstimado, grupo.unidade)
          return (
            <div key={grupo.safraId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <button type="button" onClick={() => toggleGrupo(grupo.safraId)} className="w-full text-left transition-colors hover:brightness-95" style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--brand-gradient)' }}><IconeCultura nomeCultura={grupo.cultura} size={13} /></div>
                    <div className="min-w-0"><p className="font-semibold text-gray-800 text-sm truncate">{grupo.safraNome}</p><p className="text-xs text-gray-400">{grupo.cultura}</p></div>
                  </div>
                  {expandido ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
                </div>
                <div className="flex items-stretch border-t border-green-100 mt-1">
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1"><p className="text-sm font-bold text-green-700 leading-tight">{formatarNumero(grupo.totalColhido)} <span className="text-xs font-medium">{grupo.unidade}</span></p><p className="text-xs text-gray-400 leading-tight">{grupo.nColheitas} colheita{grupo.nColheitas !== 1 ? 's' : ''}</p></div>
                  <div className="w-px bg-green-100 self-stretch" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    {grupo.produtividade !== null ? (<><p className="text-sm font-bold text-green-700 leading-tight">{formatarNumero(grupo.produtividade)} <span className="text-xs font-medium">{grupo.unidade}/ha</span></p><p className="text-xs text-gray-400 leading-tight">produtividade</p></>) : (<><p className="text-sm font-bold text-gray-300 leading-tight">—</p><p className="text-xs text-gray-400 leading-tight">produtividade</p></>)}
                  </div>
                  <div className="w-px bg-green-100 self-stretch" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    {custoFmt.texto ? (<><div className="flex items-center gap-0.5"><p className="text-sm font-bold text-green-700 leading-tight">{custoFmt.texto}</p>{custoFmt.incompleto && <span title={custoFmt.emAndamento ? 'Safra em andamento — custo parcial' : `Cobertura: ${custoFmt.cobertura}% das lavouras`} className="text-amber-500 text-xs leading-none cursor-help">⚠</span>}</div><p className="text-xs text-gray-400 leading-tight">custo{custoFmt.incompleto ? ' est.' : ' médio'}</p></>) : (<><p className="text-sm font-bold text-gray-300 leading-tight">—</p><p className="text-xs text-gray-400 leading-tight">custo estimado</p></>)}
                  </div>
                  <div className="w-px bg-green-100 self-stretch" />
                  <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
                    {grupo.todasConcluidas ? (<><p className="text-sm font-bold text-green-600 leading-tight">✓ concluída</p><p className="text-xs text-gray-400 leading-tight">todas colhidas</p></>) : grupo.lavourasPendentes > 0 ? (<><p className="text-sm font-bold text-amber-600 leading-tight">{formatarNumero(grupo.areaPendente)} <span className="text-xs font-medium">ha</span></p><p className="text-xs text-gray-400 leading-tight">{grupo.lavourasPendentes} pendente{grupo.lavourasPendentes !== 1 ? 's' : ''}</p></>) : (<><p className="text-sm font-bold text-blue-600 leading-tight">⏳ em colheita</p><p className="text-xs text-gray-400 leading-tight">aguardando conclusão</p></>)}
                  </div>
                </div>
              </button>
              {expandido && (
                <div className="border-t border-gray-100">
                  {/* ── VISÃO POR LAVOURA ── */}
                  {visaoProd === 'lavoura' && (() => {
                    const grupoLav = agrupadoPorLavoura.find(g => g.safraId === grupo.safraId)
                    if (!grupoLav?.lavouras?.length) return (
                      <p className="text-xs text-gray-400 px-4 py-3">Nenhuma lavoura vinculada a esta safra.</p>
                    )
                    const lavFiltradas = buscaLavoura.trim()
                      ? grupoLav.lavouras.filter(i => i.lav.nome.toLowerCase().includes(buscaLavoura.toLowerCase()))
                      : grupoLav.lavouras
                    return lavFiltradas.map((item, idx) => {
                      const bgZ = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                      // Badge colheita
                      const colheitaCor = item.statusColheita === 'pendente' ? 'bg-amber-100 text-amber-700'
                        : item.statusColheita === 'concluida' ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                      const colheitaLabel = item.statusColheita === 'pendente' ? 'Pendente'
                        : item.statusColheita === 'concluida' ? 'Concluída' : 'Em colheita'
                      // Badge estoque
                      const estoqueCor = item.statusEstoque === 'estocado' ? 'text-green-600'
                        : item.statusEstoque === 'parcial' ? 'text-amber-600'
                        : item.statusEstoque === 'nao_estocado' ? 'text-gray-400'
                        : ''
                      const estoqueLabel = item.statusEstoque === 'estocado' ? '✓ Estocado'
                        : item.statusEstoque === 'parcial' ? `⏳ ${formatarNumero(item.saldoDisponivel)} a estocar`
                        : item.statusEstoque === 'nao_estocado' ? 'Não estocado'
                        : ''
                      return (
                        <div key={item.lav.id}
                          className={`${bgZ} px-4 py-2 border-b border-gray-100 last:border-0 flex items-center gap-2`}>
                          {/* Info principal */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium text-gray-800 leading-tight">{item.lav.nome}</p>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium leading-tight ${colheitaCor}`}>{colheitaLabel}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              <span className="text-xs text-gray-400">{formatarNumero(item.lav.areaHa)} ha</span>
                              {item.statusColheita !== 'pendente' && (
                                <>
                                  <span className="text-xs text-green-700 font-medium">{formatarNumero(item.totalColhido)} {grupo.unidade}</span>
                                  {item.produtividade !== null && <span className="text-xs text-gray-400">{formatarNumero(item.produtividade)} {grupo.unidade}/ha</span>}
                                  {estoqueLabel && <span className={`text-xs font-medium ${estoqueCor}`}>{estoqueLabel}</span>}
                                </>
                              )}
                            </div>
                          </div>
                          {/* Botão de detalhes */}
                          <button type="button"
                            onClick={() => setModalLavoura({ grupo, item, safraId: grupo.safraId, unidade: grupo.unidade })}
                            className="flex-shrink-0 text-gray-300 hover:text-blue-500 p-1" title="Ver detalhes">
                            <Info size={16} />
                          </button>
                        </div>
                      )
                    })
                  })()}

                  {/* ── VISÃO POR MÊS ── */}
                  {visaoProd === 'mes' && (
                    grupo.meses.length === 0 ? (
                      <p className="text-xs text-gray-400 px-4 py-3">Nenhuma colheita registrada.</p>
                    ) : grupo.meses.map(mes => (
                      <div key={mes.chave}>
                        <div className="flex items-center justify-between px-4 py-2 border-b border-green-100 bg-green-50">
                          <p className="text-xs font-semibold text-green-800 capitalize">{nomeMes(mes.chave)}</p>
                          <p className="text-xs font-semibold text-green-700">{formatarNumero(mes.totalMes)} {grupo.unidade}</p>
                        </div>
                        {mes.itens.map((c, idx) => {
                          const bgZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'
                          const { qtdEmEstoque, saldoDisponivel, temLote } = colheitaInfoEstoque(c.id, c.quantidade)
                          const totalNoEstoque = temLote && saldoDisponivel === 0
                          const parcialEstoque = temLote && saldoDisponivel > 0
                          return (
                            <div key={c.id} className={`${bgZebra} px-4 py-2.5 transition-colors hover:bg-blue-50/30`}>
                              <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-800 truncate">{c.lavouraNome || 'Sem lavoura'}</p>
                                  <p className="text-xs text-gray-400 truncate">{c.propriedadeNome}</p>
                                  <p className="text-xs text-gray-400">{formatarData(c.dataColheita)}</p>
                                </div>
                                {c.observacoes && <div className="flex-1 min-w-0"><p className="text-xs text-gray-400 italic truncate">{c.observacoes}</p></div>}
                                <div className="flex items-center justify-between md:justify-end gap-2 flex-shrink-0">
                                  <p className="text-sm font-bold text-green-700 whitespace-nowrap">{formatarNumero(c.quantidade)} {c.unidade}</p>
                                  {totalNoEstoque ? (
                                    <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ No estoque</span>
                                  ) : parcialEstoque ? (
                                    <div className="flex items-center gap-1.5">
                                      <div className="text-right">
                                        <p className="text-xs text-green-600 font-medium leading-tight">estocado: {formatarNumero(qtdEmEstoque)} {c.unidade}</p>
                                        <p className="text-xs text-amber-600 font-medium leading-tight">a estocar: {formatarNumero(saldoDisponivel)} {c.unidade}</p>
                                      </div>
                                      <button onClick={e => { e.stopPropagation(); setModalEntradaEstoque({ ...c, saldoDisponivel }) }} title="Dar entrada do saldo restante"
                                        className="flex items-center gap-1 text-xs text-white px-2 py-1 rounded-lg shadow-sm hover:opacity-90 flex-shrink-0" style={{ background: 'var(--brand-gradient)' }}>
                                        <PackagePlus size={11} /><span className="hidden sm:inline">Estoque</span>
                                      </button>
                                    </div>
                                  ) : (
                                    <button onClick={e => { e.stopPropagation(); setModalEntradaEstoque({ ...c, saldoDisponivel: c.quantidade }) }} title="Dar entrada no estoque de produção"
                                      className="flex items-center gap-1 text-xs text-white px-2 py-1 rounded-lg shadow-sm hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}>
                                      <PackagePlus size={11} /><span className="hidden sm:inline">Estoque</span>
                                    </button>
                                  )}
                                  <div className="flex items-center gap-0.5">
                                    <button onClick={e => { e.stopPropagation(); abrirEdicao(c) }} className="text-gray-300 hover:text-blue-500 p-1"><Pencil size={15} /></button>
                                    <button onClick={e => { e.stopPropagation(); excluir(c.id, c.lavouraNome || 'colheita') }} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* ── MODAL DE DETALHE DA LAVOURA ── */}
      {modalLavoura && (() => {
        const { grupo, item, unidade } = modalLavoura
        const colheitasOrdenadas = [...item.colheitas].sort((a, b) => (b.dataColheita || '').localeCompare(a.dataColheita || ''))
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-xl max-h-[90vh] flex flex-col">
              <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-gray-800 text-base">{item.lav.nome}</h2>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      item.statusColheita === 'pendente' ? 'bg-amber-100 text-amber-700' :
                      item.statusColheita === 'concluida' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>{item.statusColheita === 'pendente' ? 'Pendente' : item.statusColheita === 'concluida' ? 'Concluída' : 'Em colheita'}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{grupo.safraNome} · {formatarNumero(item.lav.areaHa)} ha</p>
                </div>
                <button onClick={() => setModalLavoura(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
              </div>
              {item.statusColheita !== 'pendente' && (
                <div className="flex border-b border-gray-100">
                  <div className="flex-1 flex flex-col items-center py-3 px-2">
                    <p className="text-sm font-bold text-green-700">{formatarNumero(item.totalColhido)} <span className="text-xs">{unidade}</span></p>
                    <p className="text-xs text-gray-400">total colhido</p>
                  </div>
                  <div className="w-px bg-gray-100" />
                  <div className="flex-1 flex flex-col items-center py-3 px-2">
                    {item.produtividade !== null ? (<><p className="text-sm font-bold text-green-700">{formatarNumero(item.produtividade)} <span className="text-xs">{unidade}/ha</span></p><p className="text-xs text-gray-400">produtividade</p></>) : (<><p className="text-sm font-bold text-gray-300">—</p><p className="text-xs text-gray-400">produtividade</p></>)}
                  </div>
                  <div className="w-px bg-gray-100" />
                  <div className="flex-1 flex flex-col items-center py-3 px-2">
                    {item.custoSc !== null ? (<><p className="text-sm font-bold text-green-700">R$ {formatarNumero(item.custoSc)}</p><p className="text-xs text-gray-400">custo/{unidade}</p></>) : (<><p className="text-sm font-bold text-gray-300">—</p><p className="text-xs text-gray-400">custo est.</p></>)}
                  </div>
                  {(item.qtdEstocada > 0 || item.saldoDisponivel > 0) && (<>
                    <div className="w-px bg-gray-100" />
                    <div className="flex-1 flex flex-col items-center py-3 px-2">
                      <p className="text-sm font-bold text-green-600">{formatarNumero(item.qtdEstocada)} <span className="text-xs">{unidade}</span></p>
                      <p className="text-xs text-gray-400">estocado</p>
                      {item.saldoDisponivel > 0 && <p className="text-xs text-amber-600 font-medium mt-0.5">{formatarNumero(item.saldoDisponivel)} a estocar</p>}
                    </div>
                  </>)}
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {colheitasOrdenadas.length === 0 ? (
                  <div className="py-10 text-center text-gray-400">
                    <Wheat size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Nenhuma colheita registrada nesta lavoura.</p>
                  </div>
                ) : colheitasOrdenadas.map((c, idx) => {
                  const { qtdEmEstoque, saldoDisponivel, temLote } = colheitaInfoEstoque(c.id, c.quantidade)
                  const totalNoEstoque = temLote && saldoDisponivel === 0
                  const parcialEstoque = temLote && saldoDisponivel > 0
                  return (
                    <div key={c.id} className={`px-5 py-3 border-b border-gray-100 last:border-0 ${idx % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-green-700">{formatarNumero(c.quantidade)} {c.unidade}</p>
                          <p className="text-xs text-gray-400">{formatarData(c.dataColheita)}</p>
                          {c.observacoes && <p className="text-xs text-gray-400 italic mt-0.5 truncate">{c.observacoes}</p>}
                          <div className="mt-1">
                            {totalNoEstoque && <span className="text-xs text-green-600">✓ No estoque</span>}
                            {parcialEstoque && (
                              <span className="text-xs">
                                <span className="text-green-600">{formatarNumero(qtdEmEstoque)} {c.unidade} estocado</span>
                                <span className="text-gray-300"> · </span>
                                <span className="text-amber-600">{formatarNumero(saldoDisponivel)} {c.unidade} a estocar</span>
                              </span>
                            )}
                            {!temLote && <span className="text-xs text-gray-400">Não estocado</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!totalNoEstoque && (
                            <button onClick={() => { setModalEntradaEstoque({ ...c, saldoDisponivel: saldoDisponivel || c.quantidade }); setModalLavoura(null) }}
                              className="flex items-center gap-1 text-xs text-white px-2 py-1 rounded-lg shadow-sm hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}>
                              <PackagePlus size={11} /><span className="hidden sm:inline">Estoque</span>
                            </button>
                          )}
                          <button onClick={() => { abrirEdicao(c); setModalLavoura(null) }} className="text-gray-300 hover:text-blue-500 p-1"><Pencil size={15} /></button>
                          <button onClick={() => { excluir(c.id, c.lavouraNome || 'colheita'); setModalLavoura(null) }} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="p-4 border-t border-gray-100">
                <button onClick={() => setModalLavoura(null)} className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {fabAberto && (<div className="flex flex-col items-end gap-2 mb-1"><div className="flex items-center gap-2"><span className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow border border-gray-200 whitespace-nowrap">Registrar colheita</span><button onClick={abrirModal} className="w-11 h-11 rounded-full text-white flex items-center justify-center shadow hover:opacity-90" style={{ background: 'var(--brand-gradient)' }}><Plus size={18} /></button></div></div>)}
        <button onClick={() => setFabAberto(!fabAberto)} className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-200 ${fabAberto ? 'rotate-45' : ''}`} style={{ background: fabAberto ? '#4B5563' : 'var(--brand-gradient)' }}><Plus size={24} /></button>
      </div>
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editando ? 'Editar colheita' : 'Registrar colheita'}</h2>
              <button onClick={() => { setModal(false); setEditando(null) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={salvar} className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Safra <span className="text-red-500">*</span></label><select value={form.safraId} onChange={e => selecionarSafra(e.target.value)} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required><option value="">Selecione a safra...</option>{safrasParaModal.map(s => <option key={s.id} value={s.id}>{s.nome} — {s.cultura}{s.status === 'Planejada' ? ' (Planejada)' : ''}</option>)}</select>{!editando && <p className="text-xs text-gray-400 mt-1">Exibindo safras em andamento e planejadas.</p>}</div>
              {lavourasDaSafra.length > 0 && <div><label className="block text-sm font-medium text-gray-700 mb-1">Lavoura</label><select value={form.lavouraId} onChange={e => setForm(f => ({ ...f, lavouraId: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"><option value="">Selecione a lavoura...</option>{lavourasDaSafra.map(l => <option key={l.id} value={l.id}>{l.nome} ({formatarNumero(l.areaHa)} ha)</option>)}</select></div>}
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Data da colheita <span className="text-red-500">*</span></label><input type="date" value={form.dataColheita} max={HOJE} onChange={e => onChangeData(e.target.value)} className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${form.errData ? 'border-red-400' : 'border-gray-300'}`} required />{form.errData && <p className="text-xs text-red-500 mt-1">{form.errData}</p>}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Quantidade <span className="text-red-500">*</span></label><input type="number" min="0" step="0.01" value={form.quantidade} onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label><select value={form.unidade} onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">{UNIDADES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select>{safraSelecionada?.unidade && <p className="text-xs text-gray-400 mt-1">Padrão: {getLabelUnidade(safraSelecionada.unidade)}</p>}</div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Observações</label><textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Condições climáticas, ocorrências, etc." rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" /></div>
              {/* Toggle: colheita concluída */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <div className="relative flex-shrink-0 mt-0.5" onClick={() => setForm(f => ({ ...f, colheitaConcluida: !f.colheitaConcluida }))}>
                  <div className={`w-10 h-6 rounded-full transition-colors ${form.colheitaConcluida ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.colheitaConcluida ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Colheita desta lavoura concluída</p>
                  <p className="text-xs text-gray-400">Desmarque se ainda haverá mais colheitas nesta lavoura</p>
                </div>
              </label>
              {!editando && (
                <div className="border-t border-gray-100 pt-4">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative flex-shrink-0" onClick={() => setDarEntradaEstoque(v => !v)}><div className={`w-10 h-6 rounded-full transition-colors ${darEntradaEstoque ? 'bg-green-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${darEntradaEstoque ? 'translate-x-5' : 'translate-x-1'}`} /></div></div>
                    <div><p className="text-sm font-medium text-gray-700">Dar entrada no Estoque de Produção</p><p className="text-xs text-gray-400">Cria o lote automaticamente ao salvar</p></div>
                  </label>
                  {darEntradaEstoque && (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-medium text-gray-600 mb-1">ID / Referência do lote</label><input type="text" value={idLoteEstoque} onChange={e => setIdLoteEstoque(e.target.value)} placeholder="Código de referência do lote" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div>
                        <div><label className="block text-xs font-medium text-gray-600 mb-1">Local de armazenagem <span className="text-red-500">*</span></label><AutocompleteInput value={localArmazenagem} onChange={setLocalArmazenagem} placeholder="Silo, cooperativa..." sugestoes={sugestoesLocal} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div>
                      </div>
                      <div><p className="text-xs font-medium text-gray-600 mb-2">Qualidade <span className="text-gray-400 font-normal">(opcional)</span></p><div className="bg-gray-50 rounded-xl p-3"><CamposQualidade camposQ={camposQualidadeEstoque} qualidade={qualidadeEstoque} setQualidade={setQualidadeEstoque} classificacao={classificacaoEstoque} setClassificacao={setClassificacaoEstoque} /></div></div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setModal(false); setEditando(null) }} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={loading || !!form.errData || (darEntradaEstoque && !localArmazenagem.trim())} className="flex-1 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md" style={{ background: 'var(--brand-gradient)' }}>{loading ? 'Salvando...' : editando ? 'Atualizar' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {modalEntradaEstoque && <ModalEntradaEstoque colheita={modalEntradaEstoque} totalLotesExistentes={totalLotesCultura(modalEntradaEstoque.cultura)} sugestoesLocal={sugestoesLocal} onClose={() => setModalEntradaEstoque(null)} onSalvo={carregar} />}
      {modalIniciar && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0"><AlertCircle size={20} className="text-amber-600" /></div><h3 className="font-bold text-gray-800">Safra ainda não iniciada</h3></div><p className="text-sm text-gray-600">A safra <span className="font-semibold">{modalIniciar.safraNome}</span> está com situação <span className="font-semibold text-amber-600">Planejada</span>.</p><p className="text-sm text-gray-600">Para manter esta colheita, atualize a safra para <span className="font-semibold text-green-700">Em andamento</span>.</p><div className="flex gap-3 pt-1"><button onClick={cancelarIniciarSafra} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar colheita</button><button onClick={confirmarIniciarSafra} className="flex-1 text-white py-2 rounded-xl text-sm font-medium shadow-md" style={{ background: 'var(--brand-gradient)' }}>Confirmar</button></div></div></div>
      )}
      {modalConcluir && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><CheckCircle size={20} className="text-green-600" /></div><h3 className="font-bold text-gray-800">Safra concluída?</h3></div><p className="text-sm text-gray-600">Todas as lavouras da safra <span className="font-semibold">{modalConcluir.safraNome}</span> já registraram colheitas.</p><p className="text-sm text-gray-600">Marcar como <span className="font-semibold text-green-700">Colhida</span> com data de término <span className="font-semibold">{formatarData(modalConcluir.dataTermino)}</span>?</p><div className="flex gap-3 pt-1"><button onClick={() => setModalConcluir(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Agora não</button><button onClick={concluirSafra} className="flex-1 text-white py-2 rounded-xl text-sm font-medium shadow-md" style={{ background: 'var(--brand-gradient)' }}>Confirmar</button></div></div></div>
      )}
      {confirmacao && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4"><h3 className="font-bold text-gray-800">Confirmar exclusão</h3><p className="text-sm text-gray-600">{confirmacao.mensagem}</p><p className="text-xs text-red-500">Esta ação não poderá ser desfeita.</p><div className="flex gap-3"><button onClick={() => setConfirmacao(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button><button onClick={() => { confirmacao.onConfirmar(); setConfirmacao(null) }} className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm hover:bg-red-700">Excluir</button></div></div></div>
      )}
    </div>
  )
}
