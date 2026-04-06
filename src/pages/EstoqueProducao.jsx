import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
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
import { getCustoLote } from '../hooks/useCustoProducao'

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

// Ponto 4: máscara monetária BR (. milhar, , decimal)
function useMascaraMonetaria(inicial = '') {
  const [raw, setRaw] = useState(() => {
    const n = parseFloat(String(inicial).replace(',', '.'))
    return isNaN(n) ? '' : String(Math.round(n * 100))
  })
  const display = useMemo(() => {
    if (!raw) return ''
    const cents = parseInt(raw, 10) || 0
    return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }, [raw])
  const valor = useMemo(() => {
    if (!raw) return ''
    return String(parseInt(raw, 10) / 100)
  }, [raw])
  function onChange(e) {
    const nums = e.target.value.replace(/\D/g, '')
    setRaw(nums || '')
  }
  function resetar(novoValor = '') {
    const n = parseFloat(String(novoValor).replace(',', '.'))
    setRaw(isNaN(n) ? '' : String(Math.round(n * 100)))
  }
  return { display, valor, onChange, resetar }
}

// Ponto 7 (cotação): fórmulas CORRIGIDAS
const COTACAO_CONFIG = {
  'Soja':         { ticker: 'ZS=F', bolsa: 'CBOT',   orig: 'US¢/bu', conv: (p, fx) => (p / 100) * (60 / 27.216) * fx },
  'Milho':        { ticker: 'ZC=F', bolsa: 'CBOT',   orig: 'US¢/bu', conv: (p, fx) => (p / 100) * (60 / 25.401) * fx },
  'Café':         { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx },
  'Café Arábica': { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx },
  'Café Conilon': { ticker: 'KC=F', bolsa: 'ICE NY', orig: 'US¢/lb', conv: (p, fx) => (p / 100) * (60 / 0.453592) * fx },
  'Trigo':        { ticker: 'ZW=F', bolsa: 'CBOT',   orig: 'US¢/bu', conv: (p, fx) => (p / 100) * (60 / 27.216) * fx },
  'Algodão':      { ticker: 'CT=F', bolsa: 'ICE',    orig: 'US¢/lb', conv: (p, fx) => (p / 100) * (15 / 0.453592) * fx },
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
// Ponto 3: Tooltip com posição fixed (não é tampado pelo modal)
// ─────────────────────────────────────────────
function TooltipQualidade({ lote }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const camposQ = getCamposQualidade(lote.cultura || '')
  const itens = camposQ.filter(c => lote.qualidade?.[c.key] !== undefined && lote.qualidade[c.key] !== '')
  const classif = lote.classificacao
  if (itens.length === 0 && !classif) return null

  function mostrar(e) {
    e.stopPropagation()
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ x: rect.left + rect.width / 2, y: rect.top })
  }
  function esconder(e) { e.stopPropagation(); setPos(null) }

  return (
    <>
      <button ref={btnRef} type="button"
        onMouseEnter={mostrar} onMouseLeave={esconder}
        onTouchStart={e => { e.stopPropagation(); pos ? setPos(null) : mostrar(e) }}
        className="text-gray-400 hover:text-green-600 transition-colors flex-shrink-0"
        onClick={e => e.stopPropagation()}>
        <Info size={12} />
      </button>
      {pos && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}>
          <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl w-52">
            <p className="font-semibold text-gray-200 mb-1">Qualidade</p>
            {classif && <p className="text-gray-300">Classif.: <span className="text-white font-medium">{classif}</span></p>}
            {itens.map(c => (
              <p key={c.key} className="text-gray-300">
                {c.label}: <span className="text-white font-medium">{lote.qualidade[c.key]}{c.unidade ? ` ${c.unidade}` : ''}</span>
              </p>
            ))}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────
// Bloco de qualidade reutilizável
// ─────────────────────────────────────────────
function CamposQualidade({ camposQ, qualidade, setQualidade, classificacao, setClassificacao }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Classificação própria <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <input type="text" value={classificacao} onChange={e => setClassificacao(e.target.value)}
          placeholder="Ex: padrão exportação, código cooperativa..."
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
// Modal Entrada no Estoque
// Ponto 1: classificação própria adicionada
// ─────────────────────────────────────────────
function ModalEntrada({ colheita, loteExistente, totalLotesCultura, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const camposQ = getCamposQualidade(colheita.cultura || '')
  const unidade = getUnidadePadrao(colheita.cultura || '') || colheita.unidade || 'sc'
  const editando = !!loteExistente

  const [idLote, setIdLote] = useState(loteExistente?.idLote || '')
  const [local, setLocal] = useState(loteExistente?.localArmazenagem || '')
  const [classificacao, setClassificacao] = useState(loteExistente?.classificacao || '')
  const [qualidade, setQualidade] = useState({ ...(loteExistente?.qualidade || {}) })
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
        classificacao: classificacao.trim(),
        qualidade: qualidade || {},
        idLote: idLote.trim(),
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
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Qualidade <span className="text-gray-400 font-normal">(opcional)</span></p>
            <div className="bg-gray-50 rounded-xl p-3">
              <CamposQualidade camposQ={camposQ} qualidade={qualidade} setQualidade={setQualidade}
                classificacao={classificacao} setClassificacao={setClassificacao} />
            </div>
          </div>
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
// Ponto 15: Modal de detalhes de uma saída (venda ou transferência)
// ─────────────────────────────────────────────
function ModalDetalheSaida({ mov, lote, onClose }) {
  const unidade = lote?.unidade || mov.unidade || 'sc'
  const isVenda = mov.tipo === 'saida_venda'
  return (
    <div className="fixed inset-0 bg-black/50 z-[65] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <p className="font-bold text-gray-800">{isVenda ? 'Detalhes da venda' : 'Detalhes da transferência'}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-gray-500">Lote</span>
              <span className="text-xs font-semibold text-gray-800">{idLoteExibicao(mov)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-gray-500">Data</span>
              <span className="text-xs font-medium text-gray-700">{formatarData(mov.dataVenda || mov.dataMov)}</span>
            </div>
            {isVenda && mov.comprador && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Comprador</span>
                <span className="text-xs font-medium text-gray-700">{mov.comprador}</span>
              </div>
            )}
            {!isVenda && mov.localDestino && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Destino</span>
                <span className="text-xs font-medium text-gray-700">{mov.localDestino}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-gray-500">Quantidade</span>
              <span className="text-xs font-bold text-red-600">−{fmtNum(mov.quantidade)} {unidade}</span>
            </div>
            {mov.docRef && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Nº Doc.</span>
                <span className="text-xs font-medium text-gray-700">{mov.docRef}</span>
              </div>
            )}
          </div>
          {isVenda && (mov.valorBruto > 0 || mov.valorLiquido > 0) && (
            <div className="bg-green-50 rounded-xl p-3 space-y-2">
              {mov.valorBruto > 0 && (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Valor bruto</span>
                  <span className="text-xs font-medium text-gray-700">R$ {fmtMoeda(mov.valorBruto)}</span>
                </div>
              )}
              {mov.deducoes > 0 && (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Deduções</span>
                  <span className="text-xs font-medium text-red-600">−R$ {fmtMoeda(mov.deducoes)}</span>
                </div>
              )}
              {mov.valorLiquido > 0 && (
                <div className="flex justify-between border-t border-green-200 pt-2">
                  <span className="text-xs font-semibold text-gray-700">Valor líquido</span>
                  <span className="text-sm font-bold text-green-700">R$ {fmtMoeda(mov.valorLiquido)}</span>
                </div>
              )}
            </div>
          )}
          {!isVenda && mov.custoTransporte > 0 && (
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="flex justify-between">
                <span className="text-xs text-gray-500">Custo da transferência</span>
                <span className="text-xs font-medium text-gray-700">R$ {fmtMoeda(mov.custoTransporte)}</span>
              </div>
            </div>
          )}
          {mov.observacoes && (
            <p className="text-xs text-gray-400 italic">{mov.observacoes}</p>
          )}
        </div>
        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm hover:bg-gray-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Ponto 8b/8c/8d: Modal de detalhes do lote (histórico)
// ─────────────────────────────────────────────
function ModalDetalhesLote({ lote, vendas, onClose, onCancelarVenda }) {
  const unidade = lote.unidade || 'sc'
  const camposQ = getCamposQualidade(lote.cultura || '')
  const itensQ = camposQ.filter(c => lote.qualidade?.[c.key] !== undefined && lote.qualidade[c.key] !== '')

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <p className="font-bold text-gray-800">{idLoteExibicao(lote)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{lote.cultura} · {lote.safraNome} · {lote.localArmazenagem}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Ponto 8b: qualidade do lote no topo (em vez de entrada/vendido/saldo) */}
        {(lote.classificacao || itensQ.length > 0) && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
            <p className="text-xs font-semibold text-amber-800 mb-2">Qualidade do lote</p>
            <div className="flex flex-wrap gap-1.5">
              {lote.classificacao && (
                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200 font-medium">
                  {lote.classificacao}
                </span>
              )}
              {itensQ.map(c => (
                <span key={c.key} className="text-xs bg-white text-gray-700 px-2 py-0.5 rounded-full border border-amber-200">
                  {c.label}: {lote.qualidade[c.key]}{c.unidade ? ` ${c.unidade}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Ponto 8c: título da lista */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendas e Transferências</p>
        </div>

        <div className="divide-y divide-gray-100">
          {vendas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação.</p>
          ) : vendas.map((v, i) => (
            <div key={v.id} className={`flex items-center justify-between gap-2 px-5 py-3 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700">
                  {v.tipo === 'saida_venda' ? (v.comprador || 'Venda s/ comprador') : `→ ${v.localDestino || 'Transferência'}`}
                </p>
                <p className="text-xs text-gray-400">{formatarData(v.dataVenda || v.dataMov)}</p>
                {v.docRef && <p className="text-xs text-gray-400">Doc: {v.docRef}</p>}
                {/* Ponto 8d: valores abaixo da quantidade */}
                {v.tipo === 'saida_venda' && v.valorBruto > 0 && (
                  <div className="mt-1 space-y-0.5">
                    <p className="text-xs text-gray-400">Bruto: R$ {fmtMoeda(v.valorBruto)}</p>
                    {v.deducoes > 0 && <p className="text-xs text-gray-400">Deduções: −R$ {fmtMoeda(v.deducoes)}</p>}
                    <p className="text-xs font-semibold text-green-700">Líquido: R$ {fmtMoeda(v.valorLiquido)}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Ponto 1: vermelho com − */}
                <span className="text-sm font-bold text-red-600">−{fmtNum(v.quantidade)} {unidade}</span>
                <button onClick={() => onCancelarVenda(v)} className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4">
          <button onClick={onClose} className="w-full border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm hover:bg-gray-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Venda — checkbox + quantidade parcial
// Ponto 4: máscaras monetárias
// Ponto 5: validação de quantidade
// Ponto 9: checkbox separado da linha (mobile)
// Ponto 16: campo Nº Doc. Referência
// ─────────────────────────────────────────────
function ModalVenda({ lotes, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroSafra, setFiltroSafra] = useState('')
  const [selecoes, setSelecoes] = useState({})
  const [comprador, setComprador] = useState('')
  const [dataVenda, setDataVenda] = useState(getHoje())
  const [dataPagamento, setDataPagamento] = useState('')
  const [docRef, setDocRef] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)
  const bruto = useMascaraMonetaria()
  const liquido = useMascaraMonetaria()

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
  const brutoNum = parseFloat(bruto.valor) || 0
  const liquidoNum = parseFloat(liquido.valor) || 0
  const deducoes = brutoNum > 0 && liquidoNum > 0 ? Math.max(0, brutoNum - liquidoNum) : null
  const pctDed = deducoes && brutoNum ? ((deducoes / brutoNum) * 100).toFixed(1) : null

  // Ponto 5: erros de quantidade por lote
  const errosQtd = {}
  lotesSelecionados.forEach(l => {
    const q = Number(selecoes[l.id])
    if (!q || q <= 0) errosQtd[l.id] = 'Informe uma quantidade'
    else if (q > l.saldoAtual) errosQtd[l.id] = `Máx: ${fmtNum(l.saldoAtual, 2)} ${unidade}`
  })
  const invalido = lotesSelecionados.length === 0 || !bruto.valor || !liquido.valor || Object.keys(errosQtd).length > 0

  function toggleLote(loteId, saldoAtual) {
    setSelecoes(s => {
      if (s[loteId] !== undefined) { const { [loteId]: _, ...r } = s; return r }
      return { ...s, [loteId]: String(saldoAtual) }
    })
  }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      for (const lote of lotesSelecionados) {
        const qtd = Number(selecoes[lote.id])
        const movId = `venda_${Date.now()}_${lote.id}`
        await addDoc(collection(db, 'movimentacoesProducao'), {
          tipo: 'saida_venda', estoqueProducaoId: lote.id,
          idLote: lote.idLote || '', cultura: lote.cultura,
          safraId: lote.safraId, safraNome: lote.safraNome,
          lavouraId: lote.lavouraId, lavouraNome: lote.lavouraNome,
          propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome,
          localArmazenagem: lote.localArmazenagem, unidade,
          comprador: comprador.trim(), quantidade: qtd,
          valorBruto: brutoNum, valorLiquido: liquidoNum,
          deducoes: deducoes || 0, dataVenda, dataRecebimento: dataPagamento || null,
          docRef: docRef.trim(), observacoes: observacoes.trim(),
          cancelado: false, movimentacaoId: movId, uid: usuario.uid, criadoEm: new Date(),
        })
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual - qtd })
        await addDoc(collection(db, 'financeiro'), {
          descricao: `Venda de ${lote.cultura}${comprador.trim() ? ': ' + comprador.trim() : ''}`,
          tipo: 'receita', categoria: 'Receita Agrícola', tipoDespesa: '',
          valor: liquidoNum, valorBruto: brutoNum,
          vencimento: dataPagamento || dataVenda,
          status: dataPagamento ? 'pendente' : 'recebido', notaRef: docRef.trim(),
          propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome,
          safraId: lote.safraId, safraNome: lote.safraNome, patrimonioId: '',
          origemEstoqueProducao: true, movimentacaoId: movId,
          cancelado: false, uid: usuario.uid, criadoEm: new Date(),
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
          {/* Filtros + lotes */}
          <div>
            {(locaisUnicos.length > 1 || safrasUnicas.length > 1) && (
              <div className="flex gap-2 mb-2">
                {locaisUnicos.length > 1 && (
                  <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none">
                    <option value="">Todos os locais</option>
                    {locaisUnicos.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                {safrasUnicas.length > 1 && (
                  <select value={filtroSafra} onChange={e => setFiltroSafra(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none">
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
                const erroQtd = errosQtd[l.id]
                return (
                  <div key={l.id} className={`rounded-lg border transition-colors ${sel ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      {/* Ponto 9: checkbox separado — não propaga click para a linha */}
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer ${sel ? 'bg-green-700 border-green-700' : 'border-gray-300'}`}
                        onClick={e => { e.stopPropagation(); toggleLote(l.id, l.saldoAtual) }}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      {/* Label da linha (NÃO toggle) */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800">{idLoteExibicao(l)}</p>
                          <TooltipQualidade lote={l} />
                        </div>
                        <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome} · Saldo: {fmtNum(l.saldoAtual, 2)} {unidade}</p>
                      </div>
                      {sel && (
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <div className="flex items-center gap-1">
                            <input type="number" value={selecoes[l.id]}
                              onChange={e => setSelecoes(s => ({ ...s, [l.id]: e.target.value }))}
                              min="0.01" max={l.saldoAtual} step="0.01"
                              className={`w-20 border rounded-lg px-2 py-1 text-xs text-right focus:outline-none ${erroQtd ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                              onClick={e => e.stopPropagation()} />
                            <span className="text-xs text-gray-400">{unidade}</span>
                          </div>
                          {/* Ponto 5: mensagem de erro inline */}
                          {erroQtd && <p className="text-xs text-red-500">{erroQtd}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data de pagamento <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input type="date" value={dataPagamento} onChange={e => setDataPagamento(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              {/* Ponto 16: Nº Doc. Referência */}
              <label className="block text-xs font-medium text-gray-600 mb-1">Nº Doc. Referência <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input type="text" value={docRef} onChange={e => setDocRef(e.target.value)}
                placeholder="Nº nota fiscal, contrato..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          {/* Ponto 4: campos com máscara monetária */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valor bruto (R$)</label>
              <input type="text" inputMode="numeric" value={bruto.display} onChange={bruto.onChange}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valor líquido (R$)</label>
              <input type="text" inputMode="numeric" value={liquido.display} onChange={liquido.onChange}
                placeholder="0,00"
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
// Modal Transferência
// Ponto 2: "Custo da transferência"
// Ponto 9: checkbox separado; Ponto 16: Nº Doc.
// ─────────────────────────────────────────────
function ModalTransferencia({ lotes, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroSafra, setFiltroSafra] = useState('')
  const [selecoes, setSelecoes] = useState({})
  const [localDestino, setLocalDestino] = useState('')
  const [docRef, setDocRef] = useState('')
  const [dataMov, setDataMov] = useState(getHoje())
  const [salvando, setSalvando] = useState(false)
  const custoTransf = useMascaraMonetaria()

  const locaisUnicos = [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))]
  const safrasUnicas = [...new Set(lotes.map(l => l.safraNome).filter(Boolean))]
  const lotesFiltrados = lotes.filter(l => {
    if (filtroLocal && l.localArmazenagem !== filtroLocal) return false
    if (filtroSafra && l.safraNome !== filtroSafra) return false
    return true
  })
  const lotesSelecionados = lotes.filter(l => selecoes[l.id] !== undefined)
  const unidade = lotes[0]?.unidade || 'sc'

  const errosQtd = {}
  lotesSelecionados.forEach(l => {
    const q = Number(selecoes[l.id])
    if (!q || q <= 0) errosQtd[l.id] = 'Informe uma quantidade'
    else if (q > l.saldoAtual) errosQtd[l.id] = `Máx: ${fmtNum(l.saldoAtual, 2)} ${unidade}`
  })
  const invalido = lotesSelecionados.length === 0 || !localDestino.trim() || Object.keys(errosQtd).length > 0

  function toggleLote(loteId, saldoAtual) {
    setSelecoes(s => {
      if (s[loteId] !== undefined) { const { [loteId]: _, ...r } = s; return r }
      return { ...s, [loteId]: String(saldoAtual) }
    })
  }

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const custo = parseFloat(custoTransf.valor) || 0
      for (const lote of lotesSelecionados) {
        const qtd = Number(selecoes[lote.id])
        const movId = `transf_${Date.now()}_${lote.id}`
        await addDoc(collection(db, 'movimentacoesProducao'), {
          tipo: 'transferencia_estoque', estoqueProducaoId: lote.id,
          idLote: lote.idLote || '', cultura: lote.cultura,
          safraId: lote.safraId, safraNome: lote.safraNome,
          lavouraId: lote.lavouraId, propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome,
          localOrigem: lote.localArmazenagem, localDestino: localDestino.trim(),
          unidade, quantidade: qtd, custoTransporte: custo,
          docRef: docRef.trim(), dataMov,
          cancelado: false, movimentacaoId: movId, uid: usuario.uid, criadoEm: new Date(),
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
            descricao: `Transferência ${lote.cultura}: ${lote.localArmazenagem} → ${localDestino.trim()}`,
            tipo: 'despesa', categoria: 'Logística', tipoDespesa: 'Fretes e Transportes',
            valor: custo, vencimento: dataMov, status: 'pago', notaRef: docRef.trim(),
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
            {/* Ponto 8: nome do modal */}
            <p className="font-semibold text-gray-800">Transferência entre armazéns</p>
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
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none">
                    <option value="">Todos os locais</option>
                    {locaisUnicos.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                {safrasUnicas.length > 1 && (
                  <select value={filtroSafra} onChange={e => setFiltroSafra(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 focus:outline-none">
                    <option value="">Todas as safras</option>
                    {safrasUnicas.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            )}
            <p className="text-xs font-medium text-gray-600 mb-1.5">Selecione os lotes e a quantidade</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {lotesFiltrados.map(l => {
                const sel = selecoes[l.id] !== undefined
                const erroQtd = errosQtd[l.id]
                return (
                  <div key={l.id} className={`rounded-lg border ${sel ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer ${sel ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}
                        onClick={e => { e.stopPropagation(); toggleLote(l.id, l.saldoAtual) }}>
                        {sel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800">{idLoteExibicao(l)}</p>
                          <TooltipQualidade lote={l} />
                        </div>
                        <p className="text-xs text-gray-400">{l.localArmazenagem} · {l.safraNome} · Saldo: {fmtNum(l.saldoAtual, 2)} {unidade}</p>
                      </div>
                      {sel && (
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <div className="flex items-center gap-1">
                            <input type="number" value={selecoes[l.id]} onChange={e => setSelecoes(s => ({ ...s, [l.id]: e.target.value }))}
                              min="0.01" max={l.saldoAtual} step="0.01"
                              className={`w-20 border rounded-lg px-2 py-1 text-xs text-right focus:outline-none ${erroQtd ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                              onClick={e => e.stopPropagation()} />
                            <span className="text-xs text-gray-400">{unidade}</span>
                          </div>
                          {erroQtd && <p className="text-xs text-red-500">{erroQtd}</p>}
                        </div>
                      )}
                    </div>
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
              {/* Ponto 2: "Custo da transferência" */}
              <label className="block text-xs font-medium text-gray-600 mb-1">Custo da transferência <span className="text-gray-400 font-normal">(R$, opc.)</span></label>
              {/* Ponto 4: máscara monetária */}
              <input type="text" inputMode="numeric" value={custoTransf.display} onChange={custoTransf.onChange}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data</label>
              <input type="date" value={dataMov} onChange={e => setDataMov(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          {/* Ponto 16 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nº Doc. Referência <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input type="text" value={docRef} onChange={e => setDocRef(e.target.value)}
              placeholder="Nº nota fiscal, romaneio, contrato..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: invalido ? '#86efac' : 'var(--brand-gradient)' }}>
            {salvando ? 'Transferindo...' : 'Confirmar transf.'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Badges de qualidade (ponto 1b)
// ─────────────────────────────────────────────
function BadgesQualidade({ lote }) {
  const camposQ = getCamposQualidade(lote.cultura || '')
  const badges = []
  if (lote.classificacao) {
    badges.push({ key: 'classif', label: lote.classificacao, destaque: true })
  }
  camposQ.forEach(c => {
    const v = lote.qualidade?.[c.key]
    if (v !== undefined && v !== '') {
      badges.push({ key: c.key, label: `${c.label.replace(/ \(.*\)/, '')}: ${v}${c.unidade || ''}`, destaque: false })
    }
  })
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {badges.map(b => (
        <span key={b.key}
          className={`inline-flex text-xs px-1.5 py-0 rounded-full leading-5 ${
            b.destaque
              ? 'bg-amber-100 text-amber-800 border border-amber-300 font-medium'
              : 'bg-green-50 text-green-700 border border-green-100'
          }`}>
          {b.label}
        </span>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Lote — compacto, zebrado
// Ponto 11: sem +, saldo acima, entrada abaixo
// Ponto 12: saídas sempre visíveis
// Ponto 15: ícone Info nas saídas da aba atual
// ─────────────────────────────────────────────
function CardLote({ lote, movs, idx, onEditar, onCancelarLote, onCancelarSaida, safra }) {
  const [detalheSaida, setDetalheSaida] = useState(null)
  const unidade = lote.unidade || 'sc'
  const bg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
  const podeCancelar = lote.saldoAtual === lote.quantidadeEntrada

  // Custo estimado do lote (ponto 17 — subtil)
  const custoLote = safra ? getCustoLote(safra, lote.lavouraId) : null

  return (
    <>
      <div className={`${bg}`}>
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-800">{idLoteExibicao(lote)}</span>
              <span className="text-xs text-gray-400">{formatarData(lote.dataColheita)}</span>
              {lote.lavouraNome && <span className="text-xs text-gray-400 hidden sm:inline">· {lote.lavouraNome}</span>}
            </div>
            {/* Ponto 1b: badges de qualidade */}
            <BadgesQualidade lote={lote} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              {/* Ponto 11: saldo acima em destaque, entrada abaixo menor */}
              <p className="text-sm font-bold text-green-700"><span className="text-xs font-normal text-gray-500">saldo: </span> {fmtNum(lote.saldoAtual)} <span className="text-xs font-normal text-gray-500">{unidade}</span></p>
              <p className="text-xs text-gray-400">entrada: {fmtNum(lote.quantidadeEntrada)} {unidade}</p>
              {/* Custo estimado discreto (ponto 17) */}
              {custoLote && (
                <p className="text-xs text-gray-400">
                  custo est.: R$ {fmtMoeda(custoLote.valor)}/{custoLote.unidade}
                  {custoLote.incompleto && <span className="text-amber-500">⚠</span>}
                </p>
              )}
            </div>
            <button onClick={() => onEditar(lote)} title="Editar" className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={13} /></button>
            <button onClick={() => onCancelarLote(lote, podeCancelar)} title="Cancelar entrada" className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={13} /></button>
          </div>
        </div>

        {/* Ponto 12: saídas sempre visíveis, sem colapso */}
        {movs.length > 0 && (
          <div className="mx-4 mb-2 border border-gray-100 rounded-lg overflow-hidden">
            {movs.map(m => (
              <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50/80 border-b border-gray-100 last:border-0">
                <p className="text-xs text-gray-500 truncate flex-1">
                  <span className={`font-medium ${m.tipo === 'saida_venda' ? 'text-amber-600' : 'text-blue-600'}`}>
                    {m.tipo === 'saida_venda' ? '↓ Venda' : '↔ Transf.'}
                  </span>
                  {' · '}{formatarData(m.dataVenda || m.dataMov)}
                  {m.comprador ? ` · ${m.comprador}` : ''}
                  {m.localDestino ? ` → ${m.localDestino}` : ''}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Ponto 15: ícone de detalhes na saída — igual ao Estoque de Insumos */}
                  <span className="text-xs font-bold text-red-600">−{fmtNum(m.quantidade)} {unidade}</span>
                  <button onClick={() => setDetalheSaida(m)} title="Detalhes" className="text-gray-300 hover:text-blue-500 p-0.5"><Info size={12} /></button>
                  <button onClick={() => onCancelarSaida(m)} className="text-gray-300 hover:text-red-500 p-0.5"><Ban size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalhe da saída */}
      {detalheSaida && (
        <ModalDetalheSaida mov={detalheSaida} lote={lote} onClose={() => setDetalheSaida(null)} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────
// Card de Cultura — Estoque Atual
// Ponto 6: cabeçalho de armazém mais suave
// Ponto 9: sem receita potencial individual
// Ponto 10: botões empilhados no mobile
// Ponto 13: saldo em pill/badge
// ─────────────────────────────────────────────
function CardCulturaAtual({ cultura, lotes, movsPorLote, safrasPorId, onVenda, onTransferencia, onEditarLote, onCancelarLote, onCancelarSaida }) {
  const [aberto, setAberto] = useState(true)
  const unidade = lotes[0]?.unidade || 'sc'
  const cult = getCultura(cultura)
  const saldoTotal = lotes.reduce((s, l) => s + (l.saldoAtual || 0), 0)

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

  let loteIdx = 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-3">
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
          
          {/* Ponto 10: botões empilhados no mobile */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => onVenda(lotes.filter(l => l.saldoAtual > 0))}
              className="flex items-center gap-1 text-xs font-medium text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:opacity-90 whitespace-nowrap"
              style={{ background: 'linear-gradient(to right, #fdd140, #ffbb00)' }}>
              <ShoppingCart size={11} /> Venda
            </button>
            <button type="button" onClick={() => onTransferencia(lotes.filter(l => l.saldoAtual > 0))}
              className="flex items-center gap-1 text-xs font-medium text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:bg-blue-700 whitespace-nowrap"
              style={{ background: 'linear-gradient(to right, #4d84fb, #1f43e3)' }}>
              <ArrowRightLeft size={11} /> Transf.
            </button>
          </div>
           
            {/* Ponto 13: saldo em pill com destaque */}
            <span className="bg-green-100 text-green-800 font-bold text-base px-3 py-1 rounded-full border border-green-200">
            {fmtNum(saldoTotal)} <span className="text-sm font-medium">{unidade}</span>
            </span>
           
           {aberto ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}                
        </div>
      </button>

      {aberto && (
        <div className="border-t border-gray-100">
          {porLocal.map(({ loc, saldoLocal, safras }) => (
            <div key={loc} className="border-b border-gray-100 last:border-0">
              {/* Ponto 6: armazém com destaque mais suave — borda esquerda + fundo leve */}
              <div className="flex items-center justify-between px-4 py-2 bg-green-100 border-l-4 border-green-600">
                <div className="flex items-center gap-2">
                  <Warehouse size={13} className="text-green-700" />
                  <span className="text-xs font-bold text-green-900">Armazém: {loc}</span>
                </div>
                <span className="text-xs font-bold text-green-800">{fmtNum(saldoLocal)} {unidade}</span>
              </div>
              {safras.map(({ saf, safraId, lotes: lotesGrupo }) => (
                <div key={saf}>
                  <div className="flex items-center justify-between px-6 py-1.5 bg-green-50 border-b border-green-100 border-l-2 border-l-green-300 ml-4">
                    <span className="text-xs font-semibold text-green-800">Safra: {saf}</span>
                    <span className="text-xs text-green-600 font-medium">
                      {fmtNum(lotesGrupo.reduce((s, l) => s + l.saldoAtual, 0))} {unidade}
                    </span>
                  </div>
                  {lotesGrupo.map(lote => {
                    const i = loteIdx++
                    return (
                      <CardLote key={lote.id} lote={lote} movs={movsPorLote[lote.id] || []} idx={i}
                        safra={safrasPorId[safraId]}
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
// Card de Cultura — Histórico
// Ponto 14: última safra aberta por padrão
// ─────────────────────────────────────────────
function CardCulturaHistorico({ cultura, lotes, movsPorLote, onCancelarVenda }) {
  const [aberto, setAberto] = useState(true)
  const [loteDetalhe, setLoteDetalhe] = useState(null)
  const cult = getCultura(cultura)
  const unidade = lotes[0]?.unidade || 'sc'

  const porSafra = useMemo(() => {
    const m = {}
    lotes.forEach(l => {
      const saf = l.safraNome || 'Sem safra'
      if (!m[saf]) m[saf] = { safraId: l.safraId, lotes: [] }
      m[saf].lotes.push(l)
    })
    return Object.entries(m)
      .sort((a, b) => (b[1].safraId || b[0]).localeCompare(a[1].safraId || a[0]))
      .map(([saf, v]) => ({ saf, ...v }))
  }, [lotes])

  // Ponto 14: última safra = primeira da lista ordenada (desc) = aberta
  const ultimaSafra = porSafra[0]?.saf

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-3">
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
            {porSafra.map(({ saf, lotes: lotesSafra }) => (
              <SafraHistorico key={saf} saf={saf} lotes={lotesSafra}
                movsPorLote={movsPorLote} unidade={unidade}
                defaultAberto={saf === ultimaSafra}
                onVerDetalhe={setLoteDetalhe} />
            ))}
          </div>
        )}
      </div>
      {loteDetalhe && (
        <ModalDetalhesLote
          lote={loteDetalhe}
          vendas={movsPorLote[loteDetalhe.id] || []}
          onClose={() => setLoteDetalhe(null)}
          onCancelarVenda={v => { onCancelarVenda(v); setLoteDetalhe(null) }}
        />
      )}
    </>
  )
}

function SafraHistorico({ saf, lotes, movsPorLote, unidade, defaultAberto, onVerDetalhe }) {
  const [aberto, setAberto] = useState(defaultAberto)
  const qtdTotal = lotes.reduce((s, l) => s + l.quantidadeEntrada, 0)
  const receitaTotal = lotes.reduce((s, l) => {
    const vendas = (movsPorLote[l.id] || []).filter(m => m.tipo === 'saida_venda')
    return s + vendas.reduce((a, v) => a + (v.valorLiquido || 0), 0)
  }, 0)

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-2 bg-green-50 hover:bg-green-100 transition-colors">
        <span className="text-xs font-semibold text-gray-700">Safra: {saf}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-700">{fmtNum(qtdTotal, 2)} <span className="text-xs font-normal text-gray-500">{unidade}</span></span>
          {receitaTotal > 0 && <span className="text-xs text-gray-400">R$ {fmtMoeda(receitaTotal)}</span>}
          {aberto ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
        </div>
      </button>
      {aberto && (
        <div className="divide-y divide-gray-50">
          {lotes.map((l, i) => {
            const vendas = movsPorLote[l.id] || []
            const receita = vendas.filter(m => m.tipo === 'saida_venda').reduce((s, v) => s + (v.valorLiquido || 0), 0)
            return (
              <div key={l.id} className={`flex items-center justify-between gap-2 px-4 py-2 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-gray-700">{idLoteExibicao(l)}</p>
                    <TooltipQualidade lote={l} />
                  </div>
                  <p className="text-xs text-gray-400">{formatarData(l.dataColheita)} · {l.localArmazenagem}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-800">{fmtNum(l.quantidadeEntrada, 2)} <span className="text-xs font-normal text-gray-500">{unidade}</span></p>
                    {receita > 0 && <p className="text-xs text-gray-400">R$ {fmtMoeda(receita)}</p>}
                  </div>
                  {/* Ponto 8: ícone Info igual ao Estoque de Insumos */}
                  <button onClick={() => onVerDetalhe(l)} title="Detalhes"
                    className="text-gray-300 hover:text-blue-500 p-0.5"><Info size={14} /></button>
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
// Dashboard Saldo
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
                {/* Ponto 11: unidade ao lado da quantidade no dashboard */}
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
  const [culturaCotacao, setCulturaCotacao] = useState('')
  const [cotacaoEditando, setCotacaoEditando] = useState(false)
  const [cotacaoManualVal, setCotacaoManualVal] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownPropAberto, setDropdownPropAberto] = useState(false)
  const [propriedadesExpandidas, setPropriedadesExpandidas] = useState({})

  const [modalEntrada, setModalEntrada] = useState(null)
  const [modalVenda, setModalVenda] = useState(null)
  const [modalTransf, setModalTransf] = useState(null)
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState(null)
  const [confirmacaoSaida, setConfirmacaoSaida] = useState(null)
  const [confirmacaoBloqueio, setConfirmacaoBloqueio] = useState(null)

  const sugestoesLocal = useMemo(() => [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))], [lotes])

  // Mapa de safra por id (para custo estimado nos lotes)
  const safrasPorId = useMemo(() => {
    const m = {}
    safras.forEach(s => { m[s.id] = s })
    return m
  }, [safras])

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
  const lotesEsgotados = useMemo(() => lotesFiltrados.filter(l => l.saldoAtual === 0), [lotesFiltrados])

  function agruparPorPropCultura(lista) {
    const r = {}
    lista.forEach(item => {
      const propId = item.propriedadeId || ''
      const propNome = item.propriedadeNome || 'Sem propriedade'
      const cult = item.cultura || 'Outros'
      if (!r[propId]) r[propId] = { propNome, culturas: {} }
      if (!r[propId].culturas[cult]) r[propId].culturas[cult] = []
      r[propId].culturas[cult].push(item)
    })
    return Object.entries(r).map(([propId, v]) => ({ propId, ...v }))
  }

  const agrupadoAtual = useMemo(() => agruparPorPropCultura(lotesAtivos), [lotesAtivos])
  const agrupadoHistorico = useMemo(() => agruparPorPropCultura(lotesEsgotados), [lotesEsgotados])

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

  const culturasComCotacao = Object.keys(cotacoes).filter(c => saldoPorCultura[c] !== undefined)
  const culturaCotacaoEfetiva = culturaCotacao && cotacoes[culturaCotacao] ? culturaCotacao : culturasComCotacao[0] || ''
  const cotacaoDash = cotacoes[culturaCotacaoEfetiva]

  function propExpandida(propId) { return propId in propriedadesExpandidas ? propriedadesExpandidas[propId] : true }
  function toggleProp(propId) { setPropriedadesExpandidas(p => ({ ...p, [propId]: !propExpandida(propId) })) }

  function handleCancelarLote(lote, podeCancelar) {
    if (!podeCancelar) { setConfirmacaoBloqueio('Este lote já possui saídas registradas. Cancele as saídas primeiro.'); return }
    setConfirmacaoCancelamento({
      titulo: 'Cancelar entrada',
      mensagem: `Cancelar a entrada do lote ${idLoteExibicao(lote)}?`,
      detalhe: 'O botão para dar entrada voltará a aparecer na aba Produção.',
      onConfirmar: async () => {
        await updateDoc(doc(db, 'estoqueProducao', lote.id), { cancelado: true, saldoAtual: 0 })
        setConfirmacaoCancelamento(null); carregar()
      },
    })
  }

  function handleCancelarSaida(mov) {
    setConfirmacaoSaida({
      titulo: 'Cancelar saída',
      mensagem: `Cancelar ${mov.tipo === 'saida_venda' ? 'venda' : 'transferência'} de ${fmtNum(mov.quantidade)} ${mov.unidade || 'sc'}?`,
      detalhe: 'O saldo do lote será restaurado e o lançamento financeiro cancelado.',
      onConfirmar: async () => {
        await updateDoc(doc(db, 'movimentacoesProducao', mov.id), { cancelado: true })
        const lote = lotes.find(l => l.id === mov.estoqueProducaoId)
        if (lote) await updateDoc(doc(db, 'estoqueProducao', lote.id), { saldoAtual: lote.saldoAtual + mov.quantidade })
        if (mov.movimentacaoId) {
          const finSnap = await getDocs(query(collection(db, 'financeiro'), where('uid', '==', usuario.uid), where('movimentacaoId', '==', mov.movimentacaoId)))
          await Promise.all(finSnap.docs.map(d => updateDoc(d.ref, { cancelado: true, status: 'cancelado' })))
        }
        setConfirmacaoSaida(null); carregar()
      },
    })
  }

  function handleCotacaoManual() {
    const val = Number(cotacaoManualVal)
    if (!val || !culturaCotacaoEfetiva) return
    setCotacoes(prev => ({ ...prev, [culturaCotacaoEfetiva]: { ...(prev[culturaCotacaoEfetiva] || {}), valorBR: val, bolsa: 'Manual', originalFormatado: 'Manual', timestamp: new Date().toISOString() } }))
    setCotacaoEditando(false); setCotacaoManualVal('')
  }

  function totalLotesCultura(cultura) { return lotes.filter(l => l.cultura === cultura).length }

  function renderPropGrupo(propGrupos, renderCultura) {
    return (
      <div className="space-y-6">
        {propGrupos.map(({ propId, propNome, culturas }) => (
          <div key={propId}>
            <button type="button" onClick={() => toggleProp(propId)}
              className="w-full flex items-center gap-2 mb-3 group">
              <div className="h-px flex-1 bg-gray-200 group-hover:bg-gray-300 transition-colors" />
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide px-2 group-hover:text-gray-700 transition-colors">
                {propNome}
                {propExpandida(propId) ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </span>
              <div className="h-px flex-1 bg-gray-200 group-hover:bg-gray-300 transition-colors" />
            </button>
            {propExpandida(propId) && (
              <div>{Object.entries(culturas).map(([cultura, lotesC]) => renderCultura(cultura, lotesC))}</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (carregando) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
    </div>
  )

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Estoque de Produção</h1>

      {/* Filtros */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" data-dropdown-prop>
            <button type="button" onClick={() => setDropdownPropAberto(a => !a)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[180px] flex items-center justify-between gap-2">
              <span className="text-gray-700 truncate">
                {filtroPropriedadeIds.length > 0 ? propriedades.filter(p => filtroPropriedadeIds.includes(p.id)).map(p => p.nome).join(', ') : 'Selecione a(s) Propriedade(s)'}
              </span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
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
            <button onClick={() => { setFiltroPropriedadeIds([]); setFiltroSafraId('') }} className="text-xs text-gray-400 hover:text-red-400 underline">Limpar</button>
          )}
        </div>
      </div>

      {/* Dashboards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DashSaldo saldoPorCultura={saldoPorCultura} unidadePorCultura={unidadePorCultura} />
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cotação</p>
            {culturasComCotacao.length > 1 ? (
              <select value={culturaCotacaoEfetiva} onChange={e => setCulturaCotacao(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-0.5 bg-gray-50 focus:outline-none text-gray-600">
                {culturasComCotacao.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : culturaCotacaoEfetiva ? <span className="text-xs text-gray-500">{culturaCotacaoEfetiva}</span> : null}
          </div>
          {cotacaoDash ? (
            <>
              <p className="text-xs text-gray-400 mb-1">{cotacaoDash.bolsa} · {cotacaoDash.originalFormatado}</p>
              {cotacaoEditando ? (
                <div className="flex gap-2 items-center">
                  <input type="number" value={cotacaoManualVal} onChange={e => setCotacaoManualVal(e.target.value)}
                    placeholder="R$/unid." className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none" />
                  <button onClick={handleCotacaoManual} className="text-xs text-green-700 font-semibold">Salvar</button>
                  <button onClick={() => setCotacaoEditando(false)} className="text-xs text-gray-400">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-xl font-bold text-green-700">R$ {fmtMoeda(cotacaoDash.valorBR)}</p>
                  <button onClick={() => { setCotacaoEditando(true); setCotacaoManualVal(String(cotacaoDash.valorBR)) }}
                    className="text-gray-400 hover:text-gray-600 p-0.5"><Pencil size={13} /></button>
                </div>
              )}
              {cotacaoDash.timestamp && (
                <p className="text-xs text-gray-400 mt-1">{new Date(cotacaoDash.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
              )}
            </>
          ) : <p className="text-sm text-gray-400">—</p>}
        </div>
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Receita potencial</p>
          <p className="text-xl font-bold text-green-700">{receitaPotencialTotal > 0 ? `R$ ${fmtMoeda(receitaPotencialTotal)}` : '—'}</p>
          {receitaPotencialTotal > 0 && <p className="text-xs text-gray-400 mt-1">saldo × cotação atual</p>}
        </div>
      </div>

      {/* Ponto 14: aba renomeada para "Histórico" */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ val: 'atual', label: 'Estoque Atual' }, { val: 'historico', label: 'Histórico' }].map(a => (
          <button key={a.val} onClick={() => { setAba(a.val); setFiltroSafraId('') }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              aba === a.val ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'atual' && (
        agrupadoAtual.length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
            <p className="text-3xl mb-3">🌾</p>
            <p className="text-sm">Nenhum lote em estoque.</p>
            <p className="text-xs mt-1 text-gray-300">Registre colheitas na aba Produção e dê entrada no estoque.</p>
          </div>
        ) : renderPropGrupo(agrupadoAtual, (cultura, lotesC) => (
          <CardCulturaAtual key={cultura} cultura={cultura} lotes={lotesC}
            movsPorLote={movsPorLote}
            safrasPorId={safrasPorId}
            onVenda={ls => ls.length > 0 && setModalVenda(ls)}
            onTransferencia={ls => ls.length > 0 && setModalTransf(ls)}
            onEditarLote={lote => {
              const cf = { id: lote.colheitaOrigemId || lote.id, cultura: lote.cultura, safraNome: lote.safraNome, lavouraNome: lote.lavouraNome, safraId: lote.safraId, lavouraId: lote.lavouraId, propriedadeId: lote.propriedadeId, propriedadeNome: lote.propriedadeNome, dataColheita: lote.dataColheita, quantidade: lote.quantidadeEntrada, unidade: lote.unidade }
              setModalEntrada({ colheita: cf, loteExistente: lote })
            }}
            onCancelarLote={handleCancelarLote}
            onCancelarSaida={handleCancelarSaida}
          />
        ))
      )}

      {aba === 'historico' && (
        agrupadoHistorico.length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
            <p className="text-3xl mb-3">📋</p>
            <p className="text-sm">Nenhum lote totalmente vendido ainda.</p>
          </div>
        ) : renderPropGrupo(agrupadoHistorico, (cultura, lotesC) => (
          <CardCulturaHistorico key={cultura} cultura={cultura} lotes={lotesC}
            movsPorLote={movsPorLote}
            onCancelarVenda={handleCancelarSaida}
          />
        ))
      )}

      {/* Modais */}
      {modalEntrada && (
        <ModalEntrada colheita={modalEntrada.colheita} loteExistente={modalEntrada.loteExistente}
          totalLotesCultura={totalLotesCultura(modalEntrada.colheita.cultura)}
          onClose={() => setModalEntrada(null)} onSalvo={carregar} sugestoesLocal={sugestoesLocal} />
      )}
      {modalVenda && <ModalVenda lotes={modalVenda} onClose={() => setModalVenda(null)} onSalvo={carregar} />}
      {modalTransf && <ModalTransferencia lotes={modalTransf} onClose={() => setModalTransf(null)} onSalvo={carregar} sugestoesLocal={sugestoesLocal} />}
      {confirmacaoCancelamento && <ModalConfirmacao {...confirmacaoCancelamento} labelBotao="Cancelar entrada" onCancelar={() => setConfirmacaoCancelamento(null)} />}
      {confirmacaoSaida && <ModalConfirmacao {...confirmacaoSaida} labelBotao="Cancelar saída" onCancelar={() => setConfirmacaoSaida(null)} />}
      {confirmacaoBloqueio && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-gray-800">Não é possível cancelar</h3>
            <p className="text-sm text-gray-600">{confirmacaoBloqueio}</p>
            <button onClick={() => setConfirmacaoBloqueio(null)} className="w-full border border-gray-300 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Entendi</button>
          </div>
        </div>
      )}
    </div>
  )
}