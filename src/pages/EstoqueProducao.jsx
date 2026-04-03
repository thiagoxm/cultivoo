import { useEffect, useState, useMemo } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  Plus, Pencil, X, ChevronDown, ChevronUp,
  ArrowRightLeft, ShoppingCart, Ban, Warehouse
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

// Gera ID sequencial de lote: "SOJ-001", "MIL-003", etc.
function gerarIdLote(cultura, totalExistentes) {
  const prefixo = (cultura || 'LOT').substring(0, 3).toUpperCase()
  const seq = String(totalExistentes + 1).padStart(3, '0')
  return `${prefixo}-${seq}`
}

// Conversão de cotação por cultura
// Milho CBOT: cotado em US¢/bushel. 1 bushel milho = 25.401 kg. 1 saca = 60 kg.
// Fórmula: (centavos/100) * cambio * (25.401/60) = R$/saca
// Soja CBOT: 1 bushel soja = 27.216 kg → (centavos/100) * cambio * (27.216/60)
const COTACAO_CONFIG = {
  'Soja':         { ticker: 'ZS=F', bolsa: 'CBOT', fmt: (p) => `${fmtNum(p, 2)} US¢/bu`, conv: (p, fx) => (p / 100) * fx * (27.216 / 60) },
  'Milho':        { ticker: 'ZC=F', bolsa: 'CBOT', fmt: (p) => `${fmtNum(p, 2)} US¢/bu`, conv: (p, fx) => (p / 100) * fx * (25.401 / 60) },
  'Café':         { ticker: 'KC=F', bolsa: 'ICE NY', fmt: (p) => `${fmtNum(p, 2)} US¢/lb`, conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Café Arábica': { ticker: 'KC=F', bolsa: 'ICE NY', fmt: (p) => `${fmtNum(p, 2)} US¢/lb`, conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Café Conilon': { ticker: 'KC=F', bolsa: 'ICE NY', fmt: (p) => `${fmtNum(p, 2)} US¢/lb`, conv: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Trigo':        { ticker: 'ZW=F', bolsa: 'CBOT', fmt: (p) => `${fmtNum(p, 2)} US¢/bu`, conv: (p, fx) => (p / 100) * fx * (27.216 / 60) },
  'Algodão':      { ticker: 'CT=F', bolsa: 'ICE', fmt: (p) => `${fmtNum(p, 2)} US¢/lb`, conv: (p, fx) => (p / 100) * fx * (15 / 0.453592) },
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
// Modal de confirmação (reutilizável, padrão Estoque.jsx)
// ─────────────────────────────────────────────
function ModalConfirmacao({ titulo, mensagem, detalhe, corBotao = 'bg-red-600 hover:bg-red-700', labelBotao = 'Confirmar', onConfirmar, onCancelar }) {
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
// Modal Entrada no Estoque
// ─────────────────────────────────────────────
function ModalEntrada({ colheita, loteExistente, totalLotesCultura, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const camposQ = getCamposQualidade(colheita.cultura || '')
  const unidade = getUnidadePadrao(colheita.cultura || '') || colheita.unidade || 'sc'
  const [idLote, setIdLote] = useState(loteExistente?.idLote || gerarIdLote(colheita.cultura, totalLotesCultura))
  const [local, setLocal] = useState(loteExistente?.localArmazenagem || '')
  const [qualidade, setQualidade] = useState({ ...(loteExistente?.qualidade || colheita.qualidade || {}) })
  const [quantidade, setQuantidade] = useState(String(loteExistente?.quantidadeEntrada || colheita.quantidade || ''))
  const [salvando, setSalvando] = useState(false)
  const editando = !!loteExistente
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
        colheitaOrigemId: colheita.id,
        idLote: idLote.trim() || gerarIdLote(colheita.cultura, totalLotesCultura),
        uid: usuario.uid,
      }
      if (editando) {
        await updateDoc(doc(db, 'estoqueProducao', loteExistente.id), {
          ...payload,
          // saldoAtual: recalcula com base na diferença
          saldoAtual: loteExistente.saldoAtual + (Number(quantidade) - loteExistente.quantidadeEntrada),
        })
      } else {
        await addDoc(collection(db, 'estoqueProducao'), {
          ...payload,
          saldoAtual: Number(quantidade),
          cancelado: false,
          criadoEm: new Date(),
        })
      }
      onSalvo()
      onClose()
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade ({unidade})</label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de armazenagem *</label>
            <AutocompleteInput value={local} onChange={setLocal} placeholder="Ex: Silo Fazenda, Cooperativa ABC..."
              sugestoes={sugestoesLocal}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {camposQ.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Qualidade</p>
              <div className="grid grid-cols-2 gap-2">
                {camposQ.map(c => (
                  <div key={c.key}>
                    <label className="block text-xs text-gray-500 mb-1">{c.label}{c.unidade ? ` (${c.unidade})` : ''}</label>
                    {c.tipo === 'select' ? (
                      <select value={qualidade[c.key] || ''} onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="">—</option>
                        {c.opcoes.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="number" step="0.1" value={qualidade[c.key] || ''}
                        onChange={e => setQualidade(q => ({ ...q, [c.key]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500" />
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
// Modal Venda (com seleção de lotes)
// ─────────────────────────────────────────────
function ModalVenda({ lotes, cotacao, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const [lotesSel, setLotesSel] = useState(lotes.length === 1 ? [lotes[0].id] : [])
  const [comprador, setComprador] = useState('')
  const [dataVenda, setDataVenda] = useState(getHoje())
  const [dataRecebimento, setDataRecebimento] = useState('')
  const [valorBruto, setValorBruto] = useState('')
  const [valorLiquido, setValorLiquido] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)

  const lotesSelecionados = lotes.filter(l => lotesSel.includes(l.id))
  const qtdTotalSel = lotesSelecionados.reduce((s, l) => s + l.saldoAtual, 0)
  const multiplos = lotesSelecionados.length > 1
  const brutoNum = Number(valorBruto)
  const liquidoNum = Number(valorLiquido)
  const deducoes = brutoNum > 0 && liquidoNum > 0 ? Math.max(0, brutoNum - liquidoNum) : null
  const pctDed = deducoes && brutoNum ? ((deducoes / brutoNum) * 100).toFixed(1) : null
  const unidade = lotes[0]?.unidade || 'sc'
  const invalido = lotesSel.length === 0 || !comprador.trim() || !valorBruto || !valorLiquido

  function toggleLote(id) {
    setLotesSel(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
  }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      for (const lote of lotesSelecionados) {
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
          quantidade: lote.saldoAtual,
          valorBruto: brutoNum,
          valorLiquido: liquidoNum,
          deducoes: deducoes || 0,
          dataVenda,
          dataRecebimento: dataRecebimento || null,
          observacoes: observacoes.trim(),
          cancelado: false,
          movimentacaoId: movId,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: 0 })
        await addDoc(collection(db, 'financeiro'), {
          descricao: `Venda de ${lote.cultura}: ${comprador.trim()}`,
          tipo: 'receita',
          categoria: 'Receita Agrícola',
          tipoDespesa: '',
          valor: liquidoNum,
          valorBruto: brutoNum,
          vencimento: dataRecebimento || dataVenda,
          status: dataRecebimento ? 'pendente' : 'recebido',
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
      onSalvo()
      onClose()
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
          {/* Seleção de lotes */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Selecione o(s) lote(s)</p>
            <div className="space-y-1.5">
              {lotes.map(l => (
                <label key={l.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${lotesSel.includes(l.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${lotesSel.includes(l.id) ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}>
                    {lotesSel.includes(l.id) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <input type="checkbox" checked={lotesSel.includes(l.id)} onChange={() => toggleLote(l.id)} className="sr-only" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{l.idLote || l.id.substring(0, 8)}</p>
                    <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome}</p>
                  </div>
                  <span className="text-sm font-bold text-green-700 flex-shrink-0">{fmtNum(l.saldoAtual)} {unidade}</span>
                </label>
              ))}
            </div>
            {lotesSelecionados.length > 0 && (
              <p className="text-xs text-gray-500 mt-1.5">Total selecionado: <span className="font-semibold">{fmtNum(qtdTotalSel)} {unidade}</span></p>
            )}
            {multiplos && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-800">
                  Múltiplos lotes selecionados. O preço informado será aplicado a cada lote integralmente. Para preços diferentes por lote, registre cada venda separadamente.
                </p>
              </div>
            )}
          </div>

          {cotacao && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-amber-700">{cotacao.bolsa} · {cotacao.originalFormatado}</span>
              <span className="text-sm font-bold text-amber-800">≈ R$ {fmtMoeda(cotacao.valorBR)}/{unidade}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comprador</label>
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
              Data de recebimento <span className="text-gray-400 font-normal">(opcional — se diferente da venda)</span>
            </label>
            <input type="date" value={dataRecebimento} onChange={e => setDataRecebimento(e.target.value)}
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
              <span className="text-xs text-gray-500">Deduções (calculado automaticamente)</span>
              <span className="text-sm font-semibold text-gray-700">R$ {fmtMoeda(deducoes)} <span className="text-gray-400 text-xs font-normal">({pctDed}%)</span></span>
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
// Modal Transferência (com seleção de lotes)
// ─────────────────────────────────────────────
function ModalTransferencia({ lotes, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const [lotesSel, setLotesSel] = useState(lotes.length === 1 ? [lotes[0].id] : [])
  const [localDestino, setLocalDestino] = useState('')
  const [custoTransporte, setCustoTransporte] = useState('')
  const [dataMov, setDataMov] = useState(getHoje())
  const [salvando, setSalvando] = useState(false)

  const lotesSelecionados = lotes.filter(l => lotesSel.includes(l.id))
  const multiplos = lotesSelecionados.length > 1
  const unidade = lotes[0]?.unidade || 'sc'
  const invalido = lotesSel.length === 0 || !localDestino.trim()

  function toggleLote(id) {
    setLotesSel(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
  }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const custo = Number(custoTransporte) || 0
      for (const lote of lotesSelecionados) {
        const movId = `transf_${Date.now()}_${lote.id}`
        await addDoc(collection(db, 'movimentacoesProducao'), {
          tipo: 'transferencia_estoque',
          estoqueProducaoId: lote.id,
          idLote: lote.idLote || '',
          cultura: lote.cultura,
          safraId: lote.safraId,
          safraNome: lote.safraNome,
          lavouraId: lote.lavouraId,
          propriedadeId: lote.propriedadeId,
          propriedadeNome: lote.propriedadeNome,
          localOrigem: lote.localArmazenagem,
          localDestino: localDestino.trim(),
          unidade,
          quantidade: lote.saldoAtual,
          custoTransporte: custo / lotesSelecionados.length,
          dataMov,
          cancelado: false,
          movimentacaoId: movId,
          uid: usuario.uid,
          criadoEm: new Date(),
        })
        // Novo lote no destino
        const { id: _id, criadoEm: _c, ...base } = lote
        await addDoc(collection(db, 'estoqueProducao'), {
          ...base,
          localArmazenagem: localDestino.trim(),
          quantidadeEntrada: lote.saldoAtual,
          saldoAtual: lote.saldoAtual,
          transferenciaOrigemId: movId,
          cancelado: false,
          criadoEm: new Date(),
        })
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: 0 })
        if (custo > 0) {
          await addDoc(collection(db, 'financeiro'), {
            descricao: `Transporte ${lote.cultura}: ${lote.localArmazenagem} → ${localDestino.trim()}`,
            tipo: 'despesa',
            categoria: 'Logística',
            tipoDespesa: 'Fretes e Transportes',
            valor: custo / lotesSelecionados.length,
            vencimento: dataMov,
            status: 'pago',
            notaRef: '',
            propriedadeId: lote.propriedadeId,
            propriedadeNome: lote.propriedadeNome,
            safraId: lote.safraId || '',
            patrimonioId: '',
            movimentacaoId: movId,
            cancelado: false,
            uid: usuario.uid,
            criadoEm: new Date(),
          })
        }
      }
      onSalvo()
      onClose()
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
            <p className="text-xs font-medium text-gray-600 mb-2">Selecione o(s) lote(s) a transferir</p>
            <div className="space-y-1.5">
              {lotes.map(l => (
                <label key={l.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${lotesSel.includes(l.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${lotesSel.includes(l.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                    {lotesSel.includes(l.id) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <input type="checkbox" checked={lotesSel.includes(l.id)} onChange={() => toggleLote(l.id)} className="sr-only" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{l.idLote || l.id.substring(0, 8)}</p>
                    <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome}</p>
                  </div>
                  <span className="text-sm font-bold text-blue-700 flex-shrink-0">{fmtNum(l.saldoAtual)} {unidade}</span>
                </label>
              ))}
            </div>
            {multiplos && (
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <p className="text-xs text-blue-800">
                  Múltiplos lotes selecionados. Todos serão transferidos integralmente para o mesmo destino. Para destinos diferentes, realize transferências separadas.
                </p>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de destino *</label>
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
// Linha de saída (venda ou transferência) dentro do lote
// ─────────────────────────────────────────────
function LinhaSaida({ mov, unidade, onCancelar }) {
  const isVenda = mov.tipo === 'saida_venda'
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-3 border-t border-gray-50">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-600 truncate">
          <span className={`font-medium ${isVenda ? 'text-amber-600' : 'text-blue-600'}`}>
            {isVenda ? '↓ Venda' : '↔ Transf.'}
          </span>
          {' · '}{formatarData(mov.dataVenda || mov.dataMov)}
          {mov.comprador ? ` · ${mov.comprador}` : ''}
          {mov.localDestino ? ` → ${mov.localDestino}` : ''}
        </p>
        {isVenda && mov.valorLiquido > 0 && (
          <p className="text-xs text-gray-400">R$ {fmtMoeda(mov.valorLiquido)}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-bold text-gray-700">{fmtNum(mov.quantidade)} {unidade}</span>
        <button onClick={() => onCancelar(mov)} title="Cancelar saída"
          className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Lote — versão compacta
// ─────────────────────────────────────────────
function CardLote({ lote, movs, onEditar, onCancelarLote, onCancelarSaida }) {
  const [expandido, setExpandido] = useState(true)
  const pctSaldo = lote.quantidadeEntrada > 0 ? (lote.saldoAtual / lote.quantidadeEntrada) * 100 : 0
  const unidade = lote.unidade || 'sc'

  // Resumo de qualidade
  const camposQ = getCamposQualidade(lote.cultura || '')
  const qualResumo = (() => {
    if (!lote.qualidade) return ''
    // Prioridade: campo tipo ou peneira ou bebida (classificação principal)
    const campoClassif = camposQ.find(c => ['tipo', 'peneira', 'bebida', 'acabamento'].includes(c.key) && lote.qualidade[c.key])
    if (campoClassif) return `${campoClassif.label}: ${lote.qualidade[campoClassif.key]}`
    // Senão: primeiro campo numérico preenchido
    const primeiro = camposQ.find(c => lote.qualidade[c.key] !== undefined && lote.qualidade[c.key] !== '')
    if (primeiro) return `${primeiro.label}: ${lote.qualidade[primeiro.key]}${primeiro.unidade || ''}`
    return ''
  })()

  const podeCancelar = lote.saldoAtual === lote.quantidadeEntrada // só se não tem saídas

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden bg-white">
      {/* Linha principal do lote */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-800">{lote.idLote || '—'}</span>
            <span className="text-xs text-gray-400">{formatarData(lote.dataColheita)}</span>
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {lote.lavouraNome && <span>{lote.lavouraNome}</span>}
            {lote.lavouraNome && qualResumo && <span> · </span>}
            {qualResumo && <span className="text-green-700 font-medium">{qualResumo}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-sm font-bold text-gray-800">{fmtNum(lote.quantidadeEntrada)} <span className="text-xs font-normal text-gray-500">{unidade}</span></span>
          {movs.length > 0 && (
            <button onClick={() => setExpandido(e => !e)} className="text-gray-400 hover:text-gray-600 p-0.5">
              {expandido ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          <button onClick={() => onEditar(lote)} title="Editar lote" className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={13} /></button>
          <button onClick={() => onCancelarLote(lote, podeCancelar)} title="Cancelar entrada" className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
        </div>
      </div>

      {/* Saídas */}
      {expandido && movs.length > 0 && (
        <div className="bg-gray-50/50">
          {movs.map(m => (
            <LinhaSaida key={m.id} mov={m} unidade={unidade} onCancelar={onCancelarSaida} />
          ))}
        </div>
      )}

      {/* Barra de saldo */}
      <div className="px-3 pb-2 pt-1.5">
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div className="h-full bg-green-600 rounded-full" style={{ width: `${Math.min(pctSaldo, 100)}%` }} />
        </div>
        <p className="text-xs font-medium text-green-700">
          Saldo: {fmtNum(lote.saldoAtual)} {unidade}
          {lote.saldoAtual < lote.quantidadeEntrada && (
            <span className="text-gray-400 font-normal"> · Saídas: {fmtNum(lote.quantidadeEntrada - lote.saldoAtual)} ({(100 - pctSaldo).toFixed(0)}%)</span>
          )}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Cultura — aba Estoque Atual
// Hierarquia: Cultura → Local → Safra → Lotes
// ─────────────────────────────────────────────
function CardCulturaAtual({ cultura, lotes, movsPorLote, cotacao, onVenda, onTransferencia, onEditarLote, onCancelarLote, onCancelarSaida }) {
  const [aberto, setAberto] = useState(true)
  const unidade = lotes[0]?.unidade || 'sc'
  const cult = getCultura(cultura)
  const icone = cult?.icone || '🌾'

  const saldoTotal = lotes.reduce((s, l) => s + (l.saldoAtual || 0), 0)
  const receitaPotencial = cotacao && saldoTotal > 0 ? saldoTotal * cotacao.valorBR : null

  // Agrupamento Local → Safra → Lotes
  // Ordenar locais por saldo decrescente
  const porLocal = useMemo(() => {
    const m = {}
    lotes.forEach(l => {
      const loc = l.localArmazenagem || 'Sem local'
      if (!m[loc]) m[loc] = {}
      const saf = l.safraNome || 'Sem safra'
      if (!m[loc][saf]) m[loc][saf] = { safraId: l.safraId, lotes: [] }
      m[loc][saf].lotes.push(l)
    })
    // Ordenar locais por saldo total desc
    return Object.entries(m)
      .map(([loc, safras]) => ({
        loc,
        saldoLocal: Object.values(safras).flatMap(s => s.lotes).reduce((s, l) => s + l.saldoAtual, 0),
        safras: Object.entries(safras)
          .sort((a, b) => {
            // Safra mais recente primeiro: compara strings de safraId ou nome
            return (b[1].safraId || b[0]).localeCompare(a[1].safraId || a[0])
          })
          .map(([saf, v]) => ({ saf, ...v })),
      }))
      .sort((a, b) => b.saldoLocal - a.saldoLocal)
  }, [lotes])

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      {/* Header — padrão Producao.jsx */}
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full text-left transition-colors hover:brightness-95"
        style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
              style={{ background: 'var(--brand-gradient)' }}>
              {icone}
            </div>
            <div className="flex items-center gap-4 min-w-0">
              <p className="font-semibold text-gray-800 text-sm">{cultura}</p>
              <p className="text-sm font-bold text-green-700">{fmtNum(saldoTotal)} <span className="text-xs font-normal text-gray-500">{unidade}</span></p>
              {receitaPotencial != null && (
                <p className="text-sm font-bold text-green-700 hidden sm:block">
                  <span className="text-xs font-normal text-gray-400">Receita potencial </span>
                  R$ {fmtMoeda(receitaPotencial)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={e => { e.stopPropagation(); onVenda(lotes.filter(l => l.saldoAtual > 0)) }}
              className="flex items-center gap-1 text-xs font-medium text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:opacity-90"
              style={{ background: 'var(--brand-gradient)' }}>
              <ShoppingCart size={11} /> Venda
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); onTransferencia(lotes.filter(l => l.saldoAtual > 0)) }}
              className="flex items-center gap-1 text-xs font-medium bg-blue-600 text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:bg-blue-700">
              <ArrowRightLeft size={11} /> Transferir
            </button>
            {aberto ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
          </div>
        </div>
      </button>

      {/* Conteúdo agrupado */}
      {aberto && (
        <div className="border-t border-gray-100">
          {porLocal.map(({ loc, saldoLocal, safras }) => (
            <div key={loc}>
              {/* Subgrupo: Local de Armazenagem */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-1.5">
                  <Warehouse size={12} className="text-gray-400" />
                  <span className="text-xs font-semibold text-gray-600">{loc}</span>
                </div>
                <span className="text-xs font-semibold text-gray-500">{fmtNum(saldoLocal)} {unidade}</span>
              </div>
              {safras.map(({ saf, lotes: lotesGrupo }) => (
                <div key={saf}>
                  {/* Subgrupo: Safra */}
                  <div className="px-4 py-1 bg-green-50/50 border-b border-gray-50">
                    <span className="text-xs text-gray-400 font-medium">{saf}</span>
                  </div>
                  <div className="p-2 space-y-2">
                    {lotesGrupo.map(lote => (
                      <CardLote key={lote.id} lote={lote}
                        movs={movsPorLote[lote.id] || []}
                        onEditar={onEditarLote}
                        onCancelarLote={onCancelarLote}
                        onCancelarSaida={onCancelarSaida}
                      />
                    ))}
                  </div>
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
// Card de Cultura — aba Histórico
// Hierarquia: Cultura → Safra → Vendas
// ─────────────────────────────────────────────
function CardCulturaHistorico({ cultura, vendas }) {
  const [aberto, setAberto] = useState(true)
  const cult = getCultura(cultura)
  const icone = cult?.icone || '🌾'

  const receitaTotal = vendas.reduce((s, v) => s + (v.valorLiquido || 0), 0)
  const unidade = vendas[0]?.unidade || 'sc'

  // Agrupar por safra (mais recente primeiro)
  const porSafra = useMemo(() => {
    const m = {}
    vendas.forEach(v => {
      const saf = v.safraNome || 'Sem safra'
      if (!m[saf]) m[saf] = { safraId: v.safraId, vendas: [] }
      m[saf].vendas.push(v)
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
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
              style={{ background: 'var(--brand-gradient)' }}>{icone}</div>
            <div className="flex items-center gap-4">
              <p className="font-semibold text-gray-800 text-sm">{cultura}</p>
              <p className="text-sm font-bold text-green-700">
                <span className="text-xs font-normal text-gray-400">Realizado </span>
                R$ {fmtMoeda(receitaTotal)}
              </p>
            </div>
          </div>
          {aberto ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>
      {aberto && (
        <div className="border-t border-gray-100">
          {porSafra.map(({ saf, vendas: vendasSafra }) => {
            const receitaSafra = vendasSafra.reduce((s, v) => s + (v.valorLiquido || 0), 0)
            return (
              <div key={saf}>
                <div className="flex items-center justify-between px-4 py-1.5 bg-green-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-600">{saf}</span>
                  <span className="text-xs font-semibold text-green-700">R$ {fmtMoeda(receitaSafra)}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {vendasSafra.map(v => (
                    <div key={v.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{v.idLote || '—'} · {v.comprador || 'Comprador'}</p>
                        <p className="text-xs text-gray-400">{formatarData(v.dataVenda)} · {v.localArmazenagem}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-green-700">R$ {fmtMoeda(v.valorLiquido)}</p>
                        <p className="text-xs text-gray-400">{fmtNum(v.quantidade)} {unidade}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Dashboard de Saldo — cards por cultura
// ─────────────────────────────────────────────
function DashSaldo({ saldoPorCultura, unidadePorCultura }) {
  const culturas = Object.entries(saldoPorCultura)
  if (culturas.length === 0) return (
    <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Saldo em estoque</p>
      <p className="text-sm text-gray-400">—</p>
    </div>
  )
  return (
    <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Saldo em estoque</p>
      <div className="flex flex-wrap gap-2">
        {culturas.map(([cultura, qtd]) => {
          const unidade = unidadePorCultura[cultura] || 'sc'
          const cult = getCultura(cultura)
          return (
            <div key={cultura}
              className="flex flex-col items-center justify-center flex-1 min-w-[80px] bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
              <p className="text-xs font-semibold text-green-800 mb-1">{cult?.icone || ''} {cultura}</p>
              <p className="text-xl font-bold text-green-700 leading-tight">{fmtNum(qtd)}</p>
              <p className="text-xs text-green-600 leading-tight">{unidade}</p>
            </div>
          )
        })}
      </div>
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
  const [cotacaoEditando, setCotacaoEditando] = useState(null)
  const [cotacaoManualVal, setCotacaoManualVal] = useState('')
  const [carregando, setCarregando] = useState(true)

  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownPropAberto, setDropdownPropAberto] = useState(false)

  // Modais
  const [modalEntrada, setModalEntrada] = useState(null)   // { colheita, loteExistente? }
  const [modalVenda, setModalVenda] = useState(null)       // lotes[]
  const [modalTransf, setModalTransf] = useState(null)     // lotes[]
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState(null)
  const [confirmacaoSaida, setConfirmacaoSaida] = useState(null)
  const [confirmacaoBloqueio, setConfirmacaoBloqueio] = useState(null) // mensagem de bloqueio

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

  // Aba atual: lotes com saldo > 0
  const lotesAtivos = useMemo(() => lotesFiltrados.filter(l => l.saldoAtual > 0), [lotesFiltrados])

  // Aba histórico: movimentações de venda (saídas) de lotes esgotados
  const vendasHistorico = useMemo(() =>
    movs.filter(m => m.tipo === 'saida_venda' && !m.cancelado &&
      (filtroPropriedadeIds.length === 0 || filtroPropriedadeIds.includes(m.propriedadeId)) &&
      (!filtroSafraId || m.safraId === filtroSafraId)
    ), [movs, filtroPropriedadeIds, filtroSafraId])

  // Agrupado por propriedade → cultura
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
  const primeiraCulturaComCotacao = Object.keys(saldoPorCultura).find(c => cotacoes[c])

  // Cancelar lote (entrada)
  function handleCancelarLote(lote, podeCanc) {
    if (!podeCanc) {
      setConfirmacaoBloqueio('Este lote já possui saídas registradas. Cancele as saídas primeiro antes de cancelar a entrada.')
      return
    }
    setConfirmacaoCancelamento({
      titulo: 'Cancelar entrada',
      mensagem: `Deseja cancelar a entrada do lote ${lote.idLote || ''}?`,
      detalhe: 'O lote ficará marcado como cancelado. Lançamentos vinculados não serão afetados.',
      onConfirmar: async () => {
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { cancelado: true, saldoAtual: 0 })
        setConfirmacaoCancelamento(null)
        carregar()
      },
    })
  }

  // Cancelar saída (venda ou transferência)
  async function handleCancelarSaida(mov) {
    setConfirmacaoSaida({
      titulo: 'Cancelar saída',
      mensagem: `Deseja cancelar esta ${mov.tipo === 'saida_venda' ? 'venda' : 'transferência'} de ${fmtNum(mov.quantidade)} ${mov.unidade || 'sc'} em ${formatarData(mov.dataVenda || mov.dataMov)}?`,
      detalhe: 'O saldo do lote será restaurado. O lançamento financeiro vinculado também será cancelado.',
      onConfirmar: async () => {
        // Cancelar movimentação
        await updateDoc(doc(db, 'movimentacoesProducao', mov.id), { cancelado: true })
        // Restaurar saldo no lote
        const lote = lotes.find(l => l.id === mov.estoqueProducaoId)
        if (lote) await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual + mov.quantidade })
        // Cancelar financeiro vinculado
        if (mov.movimentacaoId) {
          const finSnap = await getDocs(query(
            collection(db, 'financeiro'),
            where('uid', '==', usuario.uid),
            where('movimentacaoId', '==', mov.movimentacaoId)
          ))
          await Promise.all(finSnap.docs.map(d => updateDoc(d.ref, { cancelado: true })))
        }
        setConfirmacaoSaida(null)
        carregar()
      },
    })
  }

  function handleCotacaoManual(cultNome) {
    const val = Number(cotacaoManualVal)
    if (!val) return
    setCotacoes(prev => ({ ...prev, [cultNome]: { ...(prev[cultNome] || {}), valorBR: val, bolsa: 'Manual', originalFormatado: 'Inserido manualmente', timestamp: new Date().toISOString() } }))
    setCotacaoEditando(null)
    setCotacaoManualVal('')
  }

  // Total lotes por cultura para gerar IDs sequenciais
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

      {/* ── Filtros — padrão Financeiro/Producao ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-prop>
            <button type="button" onClick={() => setDropdownPropAberto(a => !a)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-normal bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[180px] flex items-center justify-between gap-2">
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

        {/* Cotação */}
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cotação de referência</p>
          {primeiraCulturaComCotacao ? (() => {
            const cot = cotacoes[primeiraCulturaComCotacao]
            return (
              <>
                <p className="text-xs text-gray-400 mb-1">{primeiraCulturaComCotacao} · {cot.bolsa} · {cot.originalFormatado}</p>
                {cotacaoEditando === primeiraCulturaComCotacao ? (
                  <div className="flex gap-2 items-center">
                    <input type="number" value={cotacaoManualVal} onChange={e => setCotacaoManualVal(e.target.value)}
                      placeholder="R$/unid." className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    <button onClick={() => handleCotacaoManual(primeiraCulturaComCotacao)} className="text-xs text-green-700 font-semibold">Salvar</button>
                    <button onClick={() => setCotacaoEditando(null)} className="text-xs text-gray-400">✕</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold text-green-700">R$ {fmtMoeda(cot.valorBR)}</p>
                    <button onClick={() => { setCotacaoEditando(primeiraCulturaComCotacao); setCotacaoManualVal(String(cot.valorBR)) }}
                      className="text-gray-400 hover:text-gray-600 p-0.5" title="Editar cotação"><Pencil size={13} /></button>
                  </div>
                )}
                {cot.timestamp && (
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(cot.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </>
            )
          })() : (
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
        {[
          { val: 'atual', label: 'Estoque Atual' },
          { val: 'historico', label: 'Histórico / Vendidos' },
        ].map(a => (
          <button key={a.val}
            onClick={() => { setAba(a.val); setFiltroSafraId('') }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a.val ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo Aba Atual ── */}
      {aba === 'atual' && (
        <>
          {Object.keys(agrupadoAtual).length === 0 ? (
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
                        // Monta objeto "colheita" a partir do lote para reusar ModalEntrada
                        const colheitaFake = {
                          id: lote.colheitaOrigemId || lote.id,
                          cultura: lote.cultura,
                          safraNome: lote.safraNome,
                          lavouraNome: lote.lavouraNome,
                          safraId: lote.safraId,
                          lavouraId: lote.lavouraId,
                          propriedadeId: lote.propriedadeId,
                          propriedadeNome: lote.propriedadeNome,
                          dataColheita: lote.dataColheita,
                          quantidade: lote.quantidadeEntrada,
                          unidade: lote.unidade,
                          qualidade: lote.qualidade,
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
          )}
        </>
      )}

      {/* ── Conteúdo Aba Histórico ── */}
      {aba === 'historico' && (
        <>
          {Object.keys(agrupadoHistorico).length === 0 ? (
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
                    <CardCulturaHistorico key={cultura} cultura={cultura} vendas={vendasC} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Modais ── */}
      {modalEntrada && (
        <ModalEntrada
          colheita={modalEntrada.colheita}
          loteExistente={modalEntrada.loteExistente}
          totalLotesCultura={totalLotesCultura(modalEntrada.colheita.cultura)}
          onClose={() => setModalEntrada(null)}
          onSalvo={carregar}
          sugestoesLocal={sugestoesLocal}
        />
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
        <ModalConfirmacao {...confirmacaoCancelamento}
          labelBotao="Cancelar entrada"
          onCancelar={() => setConfirmacaoCancelamento(null)} />
      )}
      {confirmacaoSaida && (
        <ModalConfirmacao {...confirmacaoSaida}
          labelBotao="Cancelar saída"
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