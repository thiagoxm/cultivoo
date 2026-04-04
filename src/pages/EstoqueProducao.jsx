import { useEffect, useState, useMemo } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  Pencil, X, ChevronDown, ChevronUp,
  ArrowRightLeft, ShoppingCart, Ban, Warehouse, Info
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { getCamposQualidade, getCultura, getUnidadePadrao } from '../config/culturasConfig'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatarData(iso) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR }) } catch { return iso }
}
function fmtNum(v, dec = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function getHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function idLoteExibicao(lote) {
  return lote?.idLote && lote.idLote.trim() ? lote.idLote : 'Lote s/ referência'
}

// ─────────────────────────────────────────────
// Cotação por cultura
// ─────────────────────────────────────────────
const COTACAO_CONFIG = {
  'Soja':         { ticker: 'ZS=F', bolsa: 'CBOT', orig: 'US¢/bu', conv: (p, fx) => (p / 100) * fx * (27.216 / 60) },
  'Milho':        { ticker: 'ZC=F', bolsa: 'CBOT', orig: 'US¢/bu', conv: (p, fx) => (p / 100) * fx * (25.401 / 60) },
  'Café':         { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Café Arábica': { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Café Conilon': { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Trigo':        { ticker: 'ZW=F', bolsa: 'CBOT', orig: 'US¢/bu', conv: (p, fx) => (p / 100) * fx * (27.216 / 60) },
  'Algodão':      { ticker: 'CT=F', bolsa: 'ICE', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * fx * (15 / 0.453592) },
}

// ─────────────────────────────────────────────
// AutocompleteInput
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Tooltip de qualidade
// ─────────────────────────────────────────────
function TooltipQualidade({ lote }) {
  const [vis, setVis] = useState(false)
  const camposQ = getCamposQualidade(lote.cultura || '')
  const itens = camposQ.filter(c => lote.qualidade?.[c.key] !== undefined && lote.qualidade[c.key] !== '')
  if (itens.length === 0) return null
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setVis(true)}
        onMouseLeave={() => setVis(false)}
        onTouchStart={() => setVis(v => !v)}
        className="text-gray-400 hover:text-green-600 transition-colors"
        type="button">
        <Info size={13} />
      </button>
      {vis && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl w-44 pointer-events-none">
          <p className="font-semibold text-gray-200 mb-1">Qualidade</p>
          {itens.map(c => (
            <p key={c.key} className="text-gray-300">
              {c.label}: <span className="text-white font-medium">{lote.qualidade[c.key]}{c.unidade ? ` ${c.unidade}` : ''}</span>
            </p>
          ))}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal confirmação genérico
// ─────────────────────────────────────────────
function ModalConfirmacao({ titulo, mensagem, detalhe, labelBotao = 'Confirmar', corBotao = 'bg-red-600 hover:bg-red-700', onConfirmar, onCancelar }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h3 className="font-bold text-gray-800">{titulo}</h3>
        <p className="text-sm text-gray-600">{mensagem}</p>
        {detalhe && <p className="text-xs text-gray-400">{detalhe}</p>}
        <div className="flex gap-3">
          <button onClick={onCancelar} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Voltar</button>
          <button onClick={onConfirmar} className={`flex-1 text-white py-2 rounded-xl text-sm font-medium ${corBotao}`}>{labelBotao}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Entrada no Estoque (edição de lote)
// ─────────────────────────────────────────────
function ModalEntrada({ colheita, loteExistente, totalLotesCultura, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const camposQ = getCamposQualidade(colheita.cultura || '')
  const unidade = getUnidadePadrao(colheita.cultura || '') || colheita.unidade || 'sc'
  const editando = !!loteExistente

  const prefixo = (colheita.cultura || 'LOT').substring(0, 3).toUpperCase()
  const idSugerido = `${prefixo}-${String(totalLotesCultura + 1).padStart(3, '0')}`

  const [idLote, setIdLote] = useState(loteExistente?.idLote || idSugerido)
  const [local, setLocal] = useState(loteExistente?.localArmazenagem || '')
  const [qualidade, setQualidade] = useState({ ...(loteExistente?.qualidade || colheita.qualidade || {}) })
  const [quantidade, setQuantidade] = useState(String(loteExistente?.quantidadeEntrada || colheita.quantidade || ''))
  const [salvando, setSalvando] = useState(false)
  const invalido = !local.trim() || !quantidade || Number(quantidade) <= 0

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const payload = {
        cultura: colheita.cultura || '',
        safraId: colheita.safraId || '',
        safraNome: colheita.safraNome || '',
        lavouraId: colheita.lavouraId || '',
        lavouraNome: colheita.lavouraNome || '',
        propriedadeId: colheita.propriedadeId || '',
        propriedadeNome: colheita.propriedadeNome || '',
        quantidadeEntrada: Number(quantidade),
        unidade,
        dataColheita: colheita.dataColheita || '',
        localArmazenagem: local.trim(),
        qualidade: qualidade || {},
        idLote: idLote.trim() || idSugerido,
        colheitaOrigemId: colheita.id,
        uid: usuario.uid,
      }
      if (editando) {
        await updateDoc(doc(db, 'estoqueProducao', loteExistente.id), {
          ...payload,
          saldoAtual: loteExistente.saldoAtual + (Number(quantidade) - loteExistente.quantidadeEntrada),
        })
      } else {
        await addDoc(collection(db, 'estoqueProducao'), { ...payload, saldoAtual: Number(quantidade), cancelado: false, criadoEm: new Date() })
      }
      onSalvo(); onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-800">{editando ? 'Editar lote' : 'Dar entrada no estoque'}</p>
            <p className="text-xs text-gray-400 mt-0.5">{colheita.cultura} · {colheita.safraNome} · {colheita.lavouraNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ID / Referência do lote</label>
              <input type="text" value={idLote} onChange={e => setIdLote(e.target.value)}
                placeholder="Código de referência do lote"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade ({unidade})</label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de armazenagem <span className="text-red-500">*</span></label>
            <AutocompleteInput value={local} onChange={setLocal} placeholder="Silo, cooperativa, armazém..."
              sugestoes={sugestoesLocal}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {camposQ.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Qualidade <span className="text-gray-400 font-normal">(opcional)</span></p>
              <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2">
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
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: invalido ? '#86efac' : 'var(--brand-gradient)' }}>
            {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Confirmar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Venda — checkbox por lote, parcial
// ─────────────────────────────────────────────
function ModalVenda({ lotes, cotacao, onClose, onSalvo }) {
  const { usuario } = useAuth()
  // Filtros internos do modal
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroSafra, setFiltroSafra] = useState('')
  // Lotes selecionados: { [id]: quantidade }
  const [selecoes, setSelecoes] = useState({})
  const [comprador, setComprador] = useState('')
  const [dataVenda, setDataVenda] = useState(getHoje())
  const [dataPagamento, setDataPagamento] = useState('')
  const [valorBruto, setValorBruto] = useState('')
  const [valorLiquido, setValorLiquido] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)

  const locaisUnicos = [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))]
  const safrasUnicas = [...new Set(lotes.map(l => l.safraNome).filter(Boolean))]

  const lotesFiltrados = lotes.filter(l => {
    if (filtroLocal && l.localArmazenagem !== filtroLocal) return false
    if (filtroSafra && l.safraNome !== filtroSafra) return false
    return true
  })

  const lotesSelecionados = lotes.filter(l => selecoes[l.id] !== undefined)
  const unidade = lotes[0]?.unidade || 'sc'
  const totalSelecionado = lotesSelecionados.reduce((s, l) => s + (Number(selecoes[l.id]) || 0), 0)

  const brutoNum = Number(valorBruto)
  const liquidoNum = Number(valorLiquido)
  const deducoes = brutoNum > 0 && liquidoNum > 0 ? Math.max(0, brutoNum - liquidoNum) : null
  const pctDed = deducoes && brutoNum ? ((deducoes / brutoNum) * 100).toFixed(1) : null

  const invalido = lotesSelecionados.length === 0 || !valorBruto || !valorLiquido ||
    lotesSelecionados.some(l => {
      const qtd = Number(selecoes[l.id])
      return !qtd || qtd <= 0 || qtd > l.saldoAtual
    })

  function toggleLote(lote) {
    setSelecoes(s => {
      if (s[lote.id] !== undefined) {
        const { [lote.id]: _, ...resto } = s
        return resto
      }
      return { ...s, [lote.id]: lote.saldoAtual }
    })
  }
  function setQtd(id, val) {
    setSelecoes(s => ({ ...s, [id]: val }))
  }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      for (const lote of lotesSelecionados) {
        const qtd = Number(selecoes[lote.id])
        const movId = `venda_${Date.now()}_${lote.id}`
        await addDoc(collection(db, 'movimentacoesProducao'), {
          tipo: 'saida_venda',
          estoqueProducaoId: lote.id,
          idLote: lote.idLote || '',
          cultura: lote.cultura,
          safraId: lote.safraId,
          safraNome: lote.safraNome,
          lavouraId: lote.lavouraId,
          lavouraNome: lote.lavouraNome,
          propriedadeId: lote.propriedadeId,
          propriedadeNome: lote.propriedadeNome,
          localArmazenagem: lote.localArmazenagem,
          unidade,
          comprador: comprador.trim(),
          quantidade: qtd,
          valorBruto: brutoNum,
          valorLiquido: liquidoNum,
          deducoes: deducoes || 0,
          dataVenda,
          dataRecebimento: dataPagamento || null,
          observacoes: observacoes.trim(),
          cancelado: false,
          movimentacaoId: movId,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual - qtd })
        await addDoc(collection(db, 'financeiro'), {
          descricao: `Venda de ${lote.cultura}${comprador.trim() ? ': ' + comprador.trim() : ''}`,
          tipo: 'receita',
          categoria: 'Receita Agrícola',
          tipoDespesa: '',
          valor: liquidoNum,
          valorBruto: brutoNum,
          vencimento: dataPagamento || dataVenda,
          status: dataPagamento ? 'pendente' : 'recebido',
          notaRef: '',
          propriedadeId: lote.propriedadeId,
          propriedadeNome: lote.propriedadeNome,
          safraId: lote.safraId,
          safraNome: lote.safraNome,
          patrimonioId: '',
          origemEstoqueProducao: true,
          movimentacaoId: movId,
          cancelado: false,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
      }
      onSalvo(); onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-800">Registrar venda</p>
            <p className="text-xs text-gray-400 mt-0.5">{lotes[0]?.cultura} · {lotes[0]?.propriedadeNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Filtros internos + lista de lotes */}
          <div>
            {(locaisUnicos.length > 1 || safrasUnicas.length > 1) && (
              <div className="flex gap-2 mb-2">
                {locaisUnicos.length > 1 && (
                  <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500">
                    <option value="">Todos os locais</option>
                    {locaisUnicos.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                {safrasUnicas.length > 1 && (
                  <select value={filtroSafra} onChange={e => setFiltroSafra(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500">
                    <option value="">Todas as safras</option>
                    {safrasUnicas.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            )}

            <p className="text-xs font-medium text-gray-600 mb-1.5">Selecione os lotes e informe a quantidade</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {lotesFiltrados.map(l => {
                const sel = selecoes[l.id] !== undefined
                return (
                  <div key={l.id} className={`rounded-lg border transition-colors ${sel ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                    <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}
                        onClick={() => toggleLote(l)}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <div className="flex-1 min-w-0" onClick={() => toggleLote(l)}>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800">{idLoteExibicao(l)}</p>
                          <TooltipQualidade lote={l} />
                        </div>
                        <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome} · Saldo: {fmtNum(l.saldoAtual)} {unidade}</p>
                      </div>
                      {sel && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <input type="number" value={selecoes[l.id]} onChange={e => setQtd(l.id, e.target.value)}
                            min="0.01" max={l.saldoAtual} step="0.01"
                            className={`w-20 border rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-green-500 ${Number(selecoes[l.id]) > l.saldoAtual ? 'border-red-400' : 'border-gray-300'}`}
                            onClick={e => e.stopPropagation()} />
                          <span className="text-xs text-gray-400">{unidade}</span>
                        </div>
                      )}
                    </label>
                  </div>
                )
              })}
              {lotesFiltrados.length === 0 && <p className="text-xs text-gray-400 text-center py-3">Nenhum lote encontrado com esses filtros.</p>}
            </div>
            {totalSelecionado > 0 && (
              <p className="text-xs text-gray-500 mt-1.5">Total: <span className="font-semibold text-green-700">{fmtNum(totalSelecionado, 2)} {unidade}</span></p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comprador <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input type="text" value={comprador} onChange={e => setComprador(e.target.value)} placeholder="Cooperativa, trading..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data da venda</label>
              <input type="date" value={dataVenda} onChange={e => setDataVenda(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Data de pagamento <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input type="date" value={dataPagamento} onChange={e => setDataPagamento(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valor bruto (R$)</label>
              <input type="number" step="0.01" value={valorBruto} onChange={e => setValorBruto(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valor líquido (R$)</label>
              <input type="number" step="0.01" value={valorLiquido} onChange={e => setValorLiquido(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          {deducoes !== null && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between items-center">
              <span className="text-xs text-gray-500">Deduções</span>
              <span className="text-sm font-semibold text-gray-700">R$ {fmtMoeda(deducoes)} <span className="text-xs text-gray-400 font-normal">({pctDed}%)</span></span>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações <span className="text-gray-400 font-normal">(opcional)</span></label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: invalido ? '#86efac' : 'var(--brand-gradient)' }}>
            {salvando ? 'Salvando...' : 'Confirmar venda'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Transferência — checkbox por lote, parcial
// ─────────────────────────────────────────────
function ModalTransferencia({ lotes, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroSafra, setFiltroSafra] = useState('')
  const [selecoes, setSelecoes] = useState({})
  const [localDestino, setLocalDestino] = useState('')
  const [custoTransporte, setCustoTransporte] = useState('')
  const [dataMov, setDataMov] = useState(getHoje())
  const [salvando, setSalvando] = useState(false)

  const locaisUnicos = [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))]
  const safrasUnicas = [...new Set(lotes.map(l => l.safraNome).filter(Boolean))]
  const lotesFiltrados = lotes.filter(l => {
    if (filtroLocal && l.localArmazenagem !== filtroLocal) return false
    if (filtroSafra && l.safraNome !== filtroSafra) return false
    return true
  })
  const lotesSelecionados = lotes.filter(l => selecoes[l.id] !== undefined)
  const unidade = lotes[0]?.unidade || 'sc'
  const invalido = lotesSelecionados.length === 0 || !localDestino.trim() ||
    lotesSelecionados.some(l => { const q = Number(selecoes[l.id]); return !q || q <= 0 || q > l.saldoAtual })

  function toggleLote(lote) {
    setSelecoes(s => {
      if (s[lote.id] !== undefined) { const { [lote.id]: _, ...r } = s; return r }
      return { ...s, [lote.id]: lote.saldoAtual }
    })
  }
  function setQtd(id, val) { setSelecoes(s => ({ ...s, [id]: val })) }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const custo = Number(custoTransporte) || 0
      for (const lote of lotesSelecionados) {
        const qtd = Number(selecoes[lote.id])
        const movId = `transf_${Date.now()}_${lote.id}`
        await addDoc(collection(db, 'movimentacoesProducao'), {
          tipo: 'transferencia_estoque',
          estoqueProducaoId: lote.id,
          idLote: lote.idLote || '',
          cultura: lote.cultura, safraId: lote.safraId, safraNome: lote.safraNome,
          lavouraId: lote.lavouraId, propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome,
          localOrigem: lote.localArmazenagem, localDestino: localDestino.trim(),
          unidade, quantidade: qtd, custoTransporte: custo,
          dataMov, cancelado: false, movimentacaoId: movId, uid: usuario.uid, criadoEm: new Date(),
        })
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual - qtd })
        const { id: _id, criadoEm: _c, ...base } = lote
        await addDoc(collection(db, 'estoqueProducao'), {
          ...base, localArmazenagem: localDestino.trim(),
          quantidadeEntrada: qtd, saldoAtual: qtd,
          transferenciaOrigemId: movId, cancelado: false, criadoEm: new Date(),
        })
        if (custo > 0) {
          await addDoc(collection(db, 'financeiro'), {
            descricao: `Transporte ${lote.cultura}: ${lote.localArmazenagem} → ${localDestino.trim()}`,
            tipo: 'despesa', categoria: 'Logística', tipoDespesa: 'Fretes e Transportes',
            valor: custo, vencimento: dataMov, status: 'pago', notaRef: '',
            propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome,
            safraId: lote.safraId || '', patrimonioId: '', movimentacaoId: movId,
            cancelado: false, uid: usuario.uid, criadoEm: new Date(),
          })
        }
      }
      onSalvo(); onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-800">Transferir entre armazéns</p>
            <p className="text-xs text-gray-400 mt-0.5">{lotes[0]?.cultura} · {lotes[0]?.propriedadeNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            {(locaisUnicos.length > 1 || safrasUnicas.length > 1) && (
              <div className="flex gap-2 mb-2">
                {locaisUnicos.length > 1 && (
                  <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500">
                    <option value="">Todos os locais</option>
                    {locaisUnicos.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                {safrasUnicas.length > 1 && (
                  <select value={filtroSafra} onChange={e => setFiltroSafra(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500">
                    <option value="">Todas as safras</option>
                    {safrasUnicas.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            )}
            <p className="text-xs font-medium text-gray-600 mb-1.5">Selecione os lotes e informe a quantidade</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {lotesFiltrados.map(l => {
                const sel = selecoes[l.id] !== undefined
                return (
                  <div key={l.id} className={`rounded-lg border transition-colors ${sel ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                    <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}
                        onClick={() => toggleLote(l)}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <div className="flex-1 min-w-0" onClick={() => toggleLote(l)}>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800">{idLoteExibicao(l)}</p>
                          <TooltipQualidade lote={l} />
                        </div>
                        <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome} · Saldo: {fmtNum(l.saldoAtual)} {unidade}</p>
                      </div>
                      {sel && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <input type="number" value={selecoes[l.id]} onChange={e => setQtd(l.id, e.target.value)}
                            min="0.01" max={l.saldoAtual} step="0.01"
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            onClick={e => e.stopPropagation()} />
                          <span className="text-xs text-gray-400">{unidade}</span>
                        </div>
                      )}
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de destino <span className="text-red-500">*</span></label>
            <AutocompleteInput value={localDestino} onChange={setLocalDestino}
              placeholder="Silo, cooperativa, armazém..."
              sugestoes={sugestoesLocal}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Custo transporte (R$) <span className="text-gray-400 font-normal">opc.</span></label>
              <input type="number" step="0.01" value={custoTransporte} onChange={e => setCustoTransporte(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data</label>
              <input type="date" value={dataMov} onChange={e => setDataMov(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold">
            {salvando ? 'Transferindo...' : 'Confirmar transferência'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Lote — linha zebrada, compacta
// ─────────────────────────────────────────────
function CardLote({ lote, movs, idx, onEditar, onCancelarLote, onCancelarSaida }) {
  const [expandido, setExpandido] = useState(true)
  const unidade = lote.unidade || 'sc'
  const bg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'
  const podeCancelar = lote.saldoAtual === lote.quantidadeEntrada

  // Qualidade resumida — classificação principal ou primeiro campo
  const camposQ = getCamposQualidade(lote.cultura || '')
  const qualResumo = (() => {
    if (!lote.qualidade) return ''
    const prio = camposQ.find(c => ['tipo', 'peneira', 'bebida', 'acabamento'].includes(c.key) && lote.qualidade[c.key])
    if (prio) return `${prio.label}: ${lote.qualidade[prio.key]}`
    const prim = camposQ.find(c => lote.qualidade[c.key] !== undefined && lote.qualidade[c.key] !== '')
    if (prim) return `${prim.label}: ${lote.qualidade[prim.key]}${prim.unidade || ''}`
    return ''
  })()

  return (
    <div className={`${bg}`}>
      {/* Linha principal do lote */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-800">{idLoteExibicao(lote)}</span>
            <span className="text-xs text-gray-400">{formatarData(lote.dataColheita)}</span>
          </div>
          <p className="text-xs text-gray-400 truncate">
            {lote.lavouraNome && <span>{lote.lavouraNome}</span>}
            {lote.lavouraNome && qualResumo && <span> · </span>}
            {qualResumo && <span className="text-green-700">{qualResumo}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-gray-800">{fmtNum(lote.quantidadeEntrada)} <span className="text-xs font-normal text-gray-500">{unidade}</span></p>
            <p className="text-xs text-green-700 font-medium">saldo: {fmtNum(lote.saldoAtual)} {unidade}</p>
          </div>
          {movs.length > 0 && (
            <button onClick={() => setExpandido(e => !e)} className="text-gray-400 hover:text-gray-600 p-0.5">
              {expandido ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          <button onClick={() => onEditar(lote)} title="Editar" className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={13} /></button>
          <button onClick={() => onCancelarLote(lote, podeCancelar)} title="Cancelar entrada" className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
        </div>
      </div>

      {/* Saídas vinculadas */}
      {expandido && movs.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          {movs.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-gray-50 last:border-0">
              <div className="min-w-0">
                <p className="text-xs text-gray-500 truncate">
                  <span className={`font-medium ${m.tipo === 'saida_venda' ? 'text-amber-600' : 'text-blue-600'}`}>
                    {m.tipo === 'saida_venda' ? '↓ Venda' : '↔ Transf.'}
                  </span>
                  {' · '}{formatarData(m.dataVenda || m.dataMov)}
                  {m.comprador ? ` · ${m.comprador}` : ''}
                  {m.localDestino ? ` → ${m.localDestino}` : ''}
                </p>
                {m.tipo === 'saida_venda' && m.valorLiquido > 0 && (
                  <p className="text-xs text-gray-400">R$ {fmtMoeda(m.valorLiquido)}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold text-gray-700">{fmtNum(m.quantidade)} {unidade}</span>
                <button onClick={() => onCancelarSaida(m)} title="Cancelar saída" className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Cultura — Aba Estoque Atual
// ─────────────────────────────────────────────
function CardCulturaAtual({ cultura, lotes, movsPorLote, cotacao, onVenda, onTransferencia, onEditarLote, onCancelarLote, onCancelarSaida }) {
  const [aberto, setAberto] = useState(true)
  const unidade = lotes[0]?.unidade || 'sc'
  const cult = getCultura(cultura)
  const saldoTotal = lotes.reduce((s, l) => s + (l.saldoAtual || 0), 0)
  const receitaPotencial = cotacao && saldoTotal > 0 ? saldoTotal * cotacao.valorBR : null

  // Agrupamento: Local → Safra → Lotes (local desc por saldo, safra desc por id)
  const porLocal = useMemo(() => {
    const m = {}
    lotes.forEach(l => {
      const loc = l.localArmazenagem || 'Sem local'
      if (!m[loc]) m[loc] = {}
      const saf = l.safraNome || 'Sem safra'
      if (!m[loc][saf]) m[loc][saf] = { safraId: l.safraId, lotes: [] }
      m[loc][saf].lotes.push(l)
    })
    return Object.entries(m)
      .map(([loc, safras]) => ({
        loc,
        saldoLocal: Object.values(safras).flatMap(s => s.lotes).reduce((s, l) => s + l.saldoAtual, 0),
        safras: Object.entries(safras)
          .sort((a, b) => (b[1].safraId || b[0]).localeCompare(a[1].safraId || a[0]))
          .map(([saf, v]) => ({ saf, ...v })),
      }))
      .sort((a, b) => b.saldoLocal - a.saldoLocal)
  }, [lotes])

  // Índice global de lote para zebra
  let loteIdx = 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full text-left transition-colors hover:brightness-95"
        style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
        {/* Header — ponto 7: saldo e potencial mais distribuídos */}
        <div className="flex items-center px-4 pt-3 pb-2 gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
            style={{ background: 'var(--brand-gradient)' }}>
            {cult?.icone || '🌾'}
          </div>
          <p className="font-semibold text-gray-800 text-sm">{cultura}</p>
          <div className="flex-1" />
          {/* Saldo em destaque */}
          <div className="text-center">
            <p className="text-base font-bold text-green-700 leading-tight">{fmtNum(saldoTotal)} <span className="text-xs font-medium text-gray-500">{unidade}</span></p>
            <p className="text-xs text-gray-400">saldo</p>
          </div>
          {receitaPotencial != null && (
            <>
              <div className="w-px h-8 bg-green-100 self-stretch" />
              <div className="text-center">
                <p className="text-base font-bold text-green-700 leading-tight">R$ {fmtMoeda(receitaPotencial)}</p>
                <p className="text-xs text-gray-400">receita potencial</p>
              </div>
            </>
          )}
          <div className="w-px h-8 bg-green-100 self-stretch" />
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => onVenda(lotes.filter(l => l.saldoAtual > 0))}
              className="flex items-center gap-1 text-xs font-medium text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:opacity-90"
              style={{ background: 'var(--brand-gradient)' }}>
              <ShoppingCart size={11} /> Venda
            </button>
            <button type="button" onClick={() => onTransferencia(lotes.filter(l => l.saldoAtual > 0))}
              className="flex items-center gap-1 text-xs font-medium bg-blue-600 text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:bg-blue-700">
              <ArrowRightLeft size={11} /> Transferir
            </button>
          </div>
          {aberto ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-gray-100">
          {porLocal.map(({ loc, saldoLocal, safras }) => (
            <div key={loc}>
              {/* Subgrupo Local */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-1.5">
                  <Warehouse size={12} className="text-gray-400" />
                  <span className="text-xs font-semibold text-gray-600">{loc}</span>
                </div>
                <span className="text-xs font-semibold text-gray-500">{fmtNum(saldoLocal)} {unidade}</span>
              </div>
              {safras.map(({ saf, lotes: lotesGrupo }) => (
                <div key={saf}>
                  {/* Subgrupo Safra */}
                  <div className="px-4 py-1 bg-green-50/50 border-b border-gray-50">
                    <span className="text-xs text-gray-400 font-medium">{saf}</span>
                  </div>
                  {/* Lotes — zebra */}
                  {lotesGrupo.map(lote => {
                    const i = loteIdx++
                    return (
                      <CardLote key={lote.id} lote={lote} movs={movsPorLote[lote.id] || []} idx={i}
                        onEditar={onEditarLote}
                        onCancelarLote={onCancelarLote}
                        onCancelarSaida={onCancelarSaida}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Cultura — Aba Histórico
// ─────────────────────────────────────────────
function CardCulturaHistorico({ cultura, vendas, onCancelarSaida }) {
  const [aberto, setAberto] = useState(true)
  const cult = getCultura(cultura)
  const unidade = vendas[0]?.unidade || 'sc'

  // Agrupado por safra — colapsáveis, fechados por padrão
  const porSafra = useMemo(() => {
    const m = {}
    vendas.forEach(v => {
      const saf = v.safraNome || 'Sem safra'
      if (!m[saf]) m[saf] = { safraId: v.safraId, vendas: [], qtd: 0 }
      m[saf].vendas.push(v)
      m[saf].qtd += v.quantidade || 0
    })
    return Object.entries(m)
      .sort((a, b) => (b[1].safraId || b[0]).localeCompare(a[1].safraId || a[0]))
      .map(([saf, v]) => ({ saf, ...v }))
  }, [vendas])

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full text-left hover:brightness-95 transition-colors"
        style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
        <div className="flex items-center px-4 py-3 gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
            style={{ background: 'var(--brand-gradient)' }}>
            {cult?.icone || '🌾'}
          </div>
          <p className="font-semibold text-gray-800 text-sm">{cultura}</p>
          <div className="flex-1" />
          {aberto ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>
      {aberto && (
        <div className="border-t border-gray-100">
          {porSafra.map(({ saf, vendas: vendasSafra, qtd: qtdSafra }) => (
            <SafraHistorico key={saf} saf={saf} vendas={vendasSafra} qtdSafra={qtdSafra}
              unidade={unidade} onCancelarSaida={onCancelarSaida} />
          ))}
        </div>
      )}
    </div>
  )
}

function SafraHistorico({ saf, vendas, qtdSafra, unidade, onCancelarSaida }) {
  const [aberto, setAberto] = useState(false) // fechado por padrão
  const receita = vendas.reduce((s, v) => s + (v.valorLiquido || 0), 0)
  return (
    <div>
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-2 bg-green-50 border-b border-gray-100 hover:bg-green-100 transition-colors">
        <span className="text-xs font-semibold text-gray-700">{saf}</span>
        <div className="flex items-center gap-3">
          {/* Quantidade em destaque, valor menor */}
          <span className="text-sm font-bold text-green-700">{fmtNum(qtdSafra, 2)} <span className="text-xs font-medium text-gray-500">{unidade}</span></span>
          <span className="text-xs text-gray-400">R$ {fmtMoeda(receita)}</span>
          {aberto ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
        </div>
      </button>
      {aberto && (
        <div className="divide-y divide-gray-50">
          {vendas.map((v, i) => (
            <div key={v.id} className={`flex items-center justify-between gap-2 px-4 py-2 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-gray-700">{idLoteExibicao(v)}</p>
                  {v.comprador && <span className="text-xs text-gray-400">· {v.comprador}</span>}
                </div>
                <p className="text-xs text-gray-400">{formatarData(v.dataVenda)} · {v.localArmazenagem}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Quantidade em destaque, valor menor */}
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-800">{fmtNum(v.quantidade, 2)} <span className="text-xs font-normal text-gray-500">{unidade}</span></p>
                  {v.valorLiquido > 0 && <p className="text-xs text-gray-400">R$ {fmtMoeda(v.valorLiquido)}</p>}
                </div>
                <button onClick={() => onCancelarSaida(v)} title="Cancelar" className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Dashboard Saldo — cards por cultura (ponto 11)
// ─────────────────────────────────────────────
function DashSaldo({ saldoPorCultura, unidadePorCultura }) {
  const culturas = Object.entries(saldoPorCultura)
  return (
    <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Saldo em estoque</p>
      {culturas.length === 0 ? <p className="text-sm text-gray-400">—</p> : (
        <div className="flex flex-wrap gap-2">
          {culturas.map(([c, qtd]) => {
            const unidade = unidadePorCultura[c] || 'sc'
            const cult = getCultura(c)
            return (
              <div key={c} className="flex flex-col items-center justify-center flex-1 min-w-[80px] bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                <p className="text-xs font-semibold text-green-800 mb-1">{cult?.icone || ''} {c}</p>
                {/* Ponto 11: medida ao lado da quantidade */}
                <p className="text-xl font-bold text-green-700 leading-tight">{fmtNum(qtd)} <span className="text-sm font-medium text-green-600">{unidade}</span></p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────
export default function EstoqueProducao() {
  const { usuario } = useAuth()
  const [aba, setAba] = useState('atual')

  const [lotes, setLotes] = useState([])
  const [movs, setMovs] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [cotacoes, setCotacoes] = useState({})
  // Ponto 12: cultura selecionada no dashboard de cotação
  const [culturaCotacao, setCulturaCotacao] = useState('')
  const [cotacaoEditando, setCotacaoEditando] = useState(false)
  const [cotacaoManualVal, setCotacaoManualVal] = useState('')
  const [carregando, setCarregando] = useState(true)

  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownPropAberto, setDropdownPropAberto] = useState(false)

  const [modalEntrada, setModalEntrada] = useState(null)
  const [modalVenda, setModalVenda] = useState(null)
  const [modalTransf, setModalTransf] = useState(null)
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState(null)
  const [confirmacaoSaida, setConfirmacaoSaida] = useState(null)
  const [confirmacaoBloqueio, setConfirmacaoBloqueio] = useState(null)

  const sugestoesLocal = useMemo(
    () => [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))],
    [lotes]
  )

  async function carregar() {
    if (!usuario) return
    const uid = usuario.uid
    const q = (col) => query(collection(db, col), where('uid', '==', uid))
    const [lotSnap, movSnap, propSnap, safSnap] = await Promise.all([
      getDocs(q('estoqueProducao')),
      getDocs(q('movimentacoesProducao')),
      getDocs(q('propriedades')),
      getDocs(q('safras')),
    ])
    setLotes(lotSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setMovs(movSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setPropriedades(propSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSafras(safSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [usuario])

  // Cotações
  useEffect(() => {
    async function buscar() {
      try {
        const res = await fetch('/api/cotacao')
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        const MAP = { soja: 'Soja', milho: 'Milho', cafe: 'Café', cafe_arabica: 'Café Arábica', cafe_conilon: 'Café Conilon', trigo: 'Trigo', algodao: 'Algodão' }
        const novo = {}
        Object.entries(data.culturas || {}).forEach(([k, v]) => {
          if (v.ok && MAP[k]) novo[MAP[k]] = { valorBR: v.valorBR, bolsa: v.bolsa, originalFormatado: v.precoOriginalFormatado, timestamp: v.timestamp }
        })
        setCotacoes(novo)
      } catch { /* silencioso */ }
    }
    buscar()
    const t = setInterval(buscar, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Filtros
  const lotesFiltrados = useMemo(() => lotes.filter(l => {
    if (l.cancelado) return false
    if (filtroPropriedadeIds.length > 0 && !filtroPropriedadeIds.includes(l.propriedadeId)) return false
    if (filtroSafraId && l.safraId !== filtroSafraId) return false
    return true
  }), [lotes, filtroPropriedadeIds, filtroSafraId])

  const movsPorLote = useMemo(() => {
    const m = {}
    movs.filter(mv => !mv.cancelado).forEach(mv => {
      if (!m[mv.estoqueProducaoId]) m[mv.estoqueProducaoId] = []
      m[mv.estoqueProducaoId].push(mv)
    })
    return m
  }, [movs])

  const lotesAtivos = useMemo(() => lotesFiltrados.filter(l => l.saldoAtual > 0), [lotesFiltrados])

  const vendasHistorico = useMemo(() =>
    movs.filter(m => m.tipo === 'saida_venda' && !m.cancelado &&
      (filtroPropriedadeIds.length === 0 || filtroPropriedadeIds.includes(m.propriedadeId)) &&
      (!filtroSafraId || m.safraId === filtroSafraId)
    ), [movs, filtroPropriedadeIds, filtroSafraId])

  function agrupar(lista) {
    const r = {}
    lista.forEach(item => {
      const prop = item.propriedadeNome || 'Sem propriedade'
      const cult = item.cultura || 'Outros'
      if (!r[prop]) r[prop] = {}
      if (!r[prop][cult]) r[prop][cult] = []
      r[prop][cult].push(item)
    })
    return r
  }

  const agrupadoAtual = useMemo(() => agrupar(lotesAtivos), [lotesAtivos])
  const agrupadoHistorico = useMemo(() => agrupar(vendasHistorico), [vendasHistorico])

  // Dashboards
  const saldoPorCultura = useMemo(() => {
    const m = {}
    lotesAtivos.forEach(l => { m[l.cultura] = (m[l.cultura] || 0) + l.saldoAtual })
    return m
  }, [lotesAtivos])
  const unidadePorCultura = useMemo(() => {
    const m = {}
    lotesAtivos.forEach(l => { if (!m[l.cultura]) m[l.cultura] = l.unidade || 'sc' })
    return m
  }, [lotesAtivos])
  const receitaPotencialTotal = useMemo(() =>
    Object.entries(saldoPorCultura).reduce((acc, [c, qtd]) => acc + (cotacoes[c]?.valorBR ? qtd * cotacoes[c].valorBR : 0), 0),
    [saldoPorCultura, cotacoes]
  )

  // Ponto 12: culturas com cotação disponível para o seletor
  const culturasComCotacao = Object.keys(cotacoes).filter(c => saldoPorCultura[c] !== undefined)
  // Auto-selecionar a primeira se não há seleção
  const culturaCotacaoEfetiva = culturaCotacao && cotacoes[culturaCotacao] ? culturaCotacao : culturasComCotacao[0] || ''
  const cotacaoDash = cotacoes[culturaCotacaoEfetiva]

  // Cancelar lote (entrada)
  function handleCancelarLote(lote, podeCancelar) {
    if (!podeCancelar) {
      setConfirmacaoBloqueio('Este lote já possui saídas registradas. Cancele as saídas primeiro antes de cancelar a entrada.')
      return
    }
    setConfirmacaoCancelamento({
      titulo: 'Cancelar entrada',
      mensagem: `Deseja cancelar a entrada do lote ${idLoteExibicao(lote)}?`,
      detalhe: 'O lote ficará marcado como cancelado. O botão para dar entrada no estoque voltará a aparecer na aba Produção.',
      onConfirmar: async () => {
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { cancelado: true, saldoAtual: 0 })
        setConfirmacaoCancelamento(null)
        carregar()
      },
    })
  }

  // Cancelar saída (venda ou transferência) — com correção do bug financeiro
  function handleCancelarSaida(mov) {
    setConfirmacaoSaida({
      titulo: 'Cancelar saída',
      mensagem: `Cancelar ${mov.tipo === 'saida_venda' ? 'venda' : 'transferência'} de ${fmtNum(mov.quantidade)} ${mov.unidade || 'sc'} em ${formatarData(mov.dataVenda || mov.dataMov)}?`,
      detalhe: 'O saldo do lote será restaurado. O lançamento financeiro vinculado também será cancelado.',
      onConfirmar: async () => {
        await updateDoc(doc(db, 'movimentacoesProducao', mov.id), { cancelado: true })
        const lote = lotes.find(l => l.id === mov.estoqueProducaoId)
        if (lote) await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual + mov.quantidade })
        // Buscar e cancelar financeiro pelo movimentacaoId (correção do bug)
        if (mov.movimentacaoId) {
          const finSnap = await getDocs(query(
            collection(db, 'financeiro'),
            where('uid', '==', usuario.uid),
            where('movimentacaoId', '==', mov.movimentacaoId)
          ))
          await Promise.all(finSnap.docs.map(d => updateDoc(d.ref, { cancelado: true, status: 'cancelado' })))
        }
        setConfirmacaoSaida(null)
        carregar()
      },
    })
  }

  function handleCotacaoManual() {
    const val = Number(cotacaoManualVal)
    if (!val || !culturaCotacaoEfetiva) return
    setCotacoes(prev => ({
      ...prev,
      [culturaCotacaoEfetiva]: { ...(prev[culturaCotacaoEfetiva] || {}), valorBR: val, bolsa: 'Manual', originalFormatado: 'Inserido manualmente', timestamp: new Date().toISOString() },
    }))
    setCotacaoEditando(false)
    setCotacaoManualVal('')
  }

  function totalLotesCultura(cultura) {
    return lotes.filter(l => l.cultura === cultura).length
  }

  if (carregando) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
    </div>
  )

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Estoque de Produção</h1>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-prop>
            <button type="button" onClick={() => setDropdownPropAberto(a => !a)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[180px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">
                {filtroPropriedadeIds.length > 0
                  ? propriedades.filter(p => filtroPropriedadeIds.includes(p.id)).map(p => p.nome).join(', ')
                  : 'Selecione a(s) Propriedade(s)'}
              </span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {dropdownPropAberto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] py-1 max-h-48 overflow-y-auto">
                {propriedades.map(p => {
                  const sel = filtroPropriedadeIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setFiltroPropriedadeIds(ids => sel ? ids.filter(i => i !== p.id) : [...ids, p.id])}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50">
                      <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className={sel ? 'text-gray-800 font-medium' : 'text-gray-600'}>{p.nome}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <select value={filtroSafraId} onChange={e => setFiltroSafraId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Todas as safras</option>
            {safras.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          {(filtroPropriedadeIds.length > 0 || filtroSafraId) && (
            <button onClick={() => { setFiltroPropriedadeIds([]); setFiltroSafraId('') }}
              className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>
          )}
        </div>
      </div>

      {/* ── Dashboards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DashSaldo saldoPorCultura={saldoPorCultura} unidadePorCultura={unidadePorCultura} />

        {/* Cotação — ponto 12: seletor de cultura */}
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cotação</p>
            {/* Seletor de cultura no lugar do label */}
            {culturasComCotacao.length > 1 ? (
              <select value={culturaCotacaoEfetiva}
                onChange={e => setCulturaCotacao(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-0.5 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-green-500 text-gray-600">
                {culturasComCotacao.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : culturaCotacaoEfetiva ? (
              <span className="text-xs text-gray-500">{culturaCotacaoEfetiva}</span>
            ) : null}
          </div>
          {cotacaoDash ? (
            <>
              <p className="text-xs text-gray-400 mb-1">{cotacaoDash.bolsa} · {cotacaoDash.originalFormatado}</p>
              {cotacaoEditando ? (
                <div className="flex gap-2 items-center">
                  <input type="number" value={cotacaoManualVal} onChange={e => setCotacaoManualVal(e.target.value)}
                    placeholder="R$/unid." className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <button onClick={handleCotacaoManual} className="text-xs text-green-700 font-semibold">Salvar</button>
                  <button onClick={() => setCotacaoEditando(false)} className="text-xs text-gray-400">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-xl font-bold text-green-700">R$ {fmtMoeda(cotacaoDash.valorBR)}</p>
                  <button onClick={() => { setCotacaoEditando(true); setCotacaoManualVal(String(cotacaoDash.valorBR)) }}
                    className="text-gray-400 hover:text-gray-600 p-0.5" title="Editar cotação"><Pencil size={13} /></button>
                </div>
              )}
              {cotacaoDash.timestamp && (
                <p className="text-xs text-gray-400 mt-1">{new Date(cotacaoDash.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">—</p>
          )}
        </div>

        {/* Receita potencial */}
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Receita potencial</p>
          <p className="text-xl font-bold text-green-700">{receitaPotencialTotal > 0 ? `R$ ${fmtMoeda(receitaPotencialTotal)}` : '—'}</p>
          {receitaPotencialTotal > 0 && <p className="text-xs text-gray-400 mt-1">saldo × cotação atual</p>}
        </div>
      </div>

      {/* ── Abas — padrão exato Producao.jsx ── */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ val: 'atual', label: 'Estoque Atual' }, { val: 'historico', label: 'Histórico / Vendidos' }].map(a => (
          <button key={a.val} onClick={() => { setAba(a.val); setFiltroSafraId('') }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a.val ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Aba Atual ── */}
      {aba === 'atual' && (
        Object.keys(agrupadoAtual).length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
            <p className="text-3xl mb-3">🌾</p>
            <p className="text-sm">Nenhum lote em estoque.</p>
            <p className="text-xs mt-1 text-gray-300">Registre colheitas na aba Produção e dê entrada no estoque.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(agrupadoAtual).map(([propNome, culturas]) => (
              <div key={propNome}>
                {Object.keys(agrupadoAtual).length > 1 && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{propNome}</p>
                )}
                {Object.entries(culturas).map(([cultura, lotesC]) => (
                  <CardCulturaAtual key={cultura} cultura={cultura} lotes={lotesC}
                    movsPorLote={movsPorLote}
                    cotacao={cotacoes[cultura]}
                    onVenda={ls => ls.length > 0 && setModalVenda(ls)}
                    onTransferencia={ls => ls.length > 0 && setModalTransf(ls)}
                    onEditarLote={lote => {
                      const colheitaFake = {
                        id: lote.colheitaOrigemId || lote.id,
                        cultura: lote.cultura, safraNome: lote.safraNome,
                        lavouraNome: lote.lavouraNome, safraId: lote.safraId,
                        lavouraId: lote.lavouraId, propriedadeId: lote.propriedadeId,
                        propriedadeNome: lote.propriedadeNome, dataColheita: lote.dataColheita,
                        quantidade: lote.quantidadeEntrada, unidade: lote.unidade, qualidade: lote.qualidade,
                      }
                      setModalEntrada({ colheita: colheitaFake, loteExistente: lote })
                    }}
                    onCancelarLote={handleCancelarLote}
                    onCancelarSaida={handleCancelarSaida}
                  />
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Aba Histórico ── */}
      {aba === 'historico' && (
        Object.keys(agrupadoHistorico).length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
            <p className="text-3xl mb-3">📋</p>
            <p className="text-sm">Nenhuma venda registrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(agrupadoHistorico).map(([propNome, culturas]) => (
              <div key={propNome}>
                {Object.keys(agrupadoHistorico).length > 1 && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{propNome}</p>
                )}
                {Object.entries(culturas).map(([cultura, vendasC]) => (
                  <CardCulturaHistorico key={cultura} cultura={cultura} vendas={vendasC}
                    onCancelarSaida={handleCancelarSaida} />
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Modais ── */}
      {modalEntrada && (
        <ModalEntrada colheita={modalEntrada.colheita} loteExistente={modalEntrada.loteExistente}
          totalLotesCultura={totalLotesCultura(modalEntrada.colheita.cultura)}
          onClose={() => setModalEntrada(null)} onSalvo={carregar} sugestoesLocal={sugestoesLocal} />
      )}
      {modalVenda && (
        <ModalVenda lotes={modalVenda} cotacao={cotacoes[modalVenda[0]?.cultura]}
          onClose={() => setModalVenda(null)} onSalvo={carregar} />
      )}
      {modalTransf && (
        <ModalTransferencia lotes={modalTransf}
          onClose={() => setModalTransf(null)} onSalvo={carregar} sugestoesLocal={sugestoesLocal} />
      )}
      {confirmacaoCancelamento && (
        <ModalConfirmacao {...confirmacaoCancelamento} labelBotao="Cancelar entrada"
          onCancelar={() => setConfirmacaoCancelamento(null)} />
      )}
      {confirmacaoSaida && (
        <ModalConfirmacao {...confirmacaoSaida} labelBotao="Cancelar saída"
          onCancelar={() => setConfirmacaoSaida(null)} />
      )}
      {confirmacaoBloqueio && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Não é possível cancelar</h3>
            <p className="text-sm text-gray-600">{confirmacaoBloqueio}</p>
            <button onClick={() => setConfirmacaoBloqueio(null)}
              className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Entendi</button>
          </div>
        </div>
      )}
    </div>
  )
}