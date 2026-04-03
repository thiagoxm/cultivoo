import { useEffect, useState, useMemo } from 'react'
import {
  collection, query, where, getDocs, addDoc, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, X, ChevronDown, ChevronUp, ArrowRightLeft, ShoppingCart, Warehouse } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { getCamposQualidade, getCultura, getUnidadePadrao } from '../config/culturasConfig'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatarData(dataISO) {
  if (!dataISO) return '—'
  try { return format(parseISO(dataISO), 'dd/MM/yyyy', { locale: ptBR }) } catch { return dataISO }
}
function formatarMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatarNumero(v, dec = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function getHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─────────────────────────────────────────────
// Tickers Yahoo Finance por cultura
// ─────────────────────────────────────────────
const COTACAO_CONFIG = {
  'Soja':         { ticker: 'ZS=F', bolsa: 'CBOT',  label: 'US¢/bu', fator: (p, fx) => (p / 100) * fx * (27.2155 / 60) },
  'Milho':        { ticker: 'ZC=F', bolsa: 'CBOT',  label: 'US¢/bu', fator: (p, fx) => (p / 100) * fx * (25.4012 / 60) },
  'Café':         { ticker: 'KC=F', bolsa: 'ICE NY', label: 'US¢/lb', fator: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Café Arábica': { ticker: 'KC=F', bolsa: 'ICE NY', label: 'US¢/lb', fator: (p, fx) => (p / 100) * fx * (60 / 0.453592) },
  'Trigo':        { ticker: 'ZW=F', bolsa: 'CBOT',  label: 'US¢/bu', fator: (p, fx) => (p / 100) * fx * (27.2155 / 60) },
  'Algodão':      { ticker: 'CT=F', bolsa: 'ICE',   label: 'US¢/lb', fator: (p, fx) => (p / 100) * fx * (15 / 0.453592) },
}

// ─────────────────────────────────────────────
// AutocompleteInput
// ─────────────────────────────────────────────
function AutocompleteInput({ value, onChange, placeholder, sugestoes, className }) {
  const [aberto, setAberto] = useState(false)
  const filtradas = useMemo(
    () => value.length >= 1
      ? sugestoes.filter(s => s.toLowerCase().startsWith(value.toLowerCase()) && s !== value)
      : [],
    [value, sugestoes]
  )
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setAberto(true) }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={placeholder}
        className={className}
      />
      {aberto && filtradas.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtradas.map(s => (
            <button key={s} type="button" onMouseDown={() => { onChange(s); setAberto(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-green-50 text-gray-700">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Entrada no Estoque
// ─────────────────────────────────────────────
function ModalEntrada({ colheita, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const camposQ = getCamposQualidade(colheita.cultura || '')
  const unidade = getUnidadePadrao(colheita.cultura || '') || colheita.unidade || 'sc'
  const [local, setLocal] = useState('')
  const [qualidade, setQualidade] = useState({ ...colheita.qualidade })
  const [quantidade, setQuantidade] = useState(String(colheita.quantidade || ''))
  const [salvando, setSalvando] = useState(false)
  const invalido = !local.trim() || !quantidade || Number(quantidade) <= 0

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      await addDoc(collection(db, 'estoqueProducao'), {
        cultura: colheita.cultura || '',
        safraId: colheita.safraId || '',
        safraNome: colheita.safraNome || '',
        lavouraId: colheita.lavouraId || '',
        lavouraNome: colheita.lavouraNome || '',
        propriedadeId: colheita.propriedadeId || '',
        propriedadeNome: colheita.propriedadeNome || '',
        quantidadeEntrada: Number(quantidade),
        saldoAtual: Number(quantidade),
        unidade,
        dataColheita: colheita.dataColheita || '',
        localArmazenagem: local.trim(),
        qualidade: qualidade || {},
        colheitaOrigemId: colheita.id,
        uid: usuario.uid,
        criadoEm: new Date(),
      })
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
            <p className="font-semibold text-gray-800">Dar entrada no estoque</p>
            <p className="text-xs text-gray-400 mt-0.5">{colheita.cultura} · {colheita.safraNome} · {colheita.lavouraNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade ({unidade})</label>
            <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de armazenagem</label>
            <AutocompleteInput value={local} onChange={setLocal}
              placeholder="Silo, cooperativa, armazém..."
              sugestoes={sugestoesLocal}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {camposQ.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Qualidade <span className="text-gray-400 font-normal">(pré-preenchida da colheita)</span></p>
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
                      <input type="number" step={c.step || '0.1'} value={qualidade[c.key] || ''}
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
            className="flex-1 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-xl py-2.5 text-sm font-semibold">
            {salvando ? 'Salvando...' : 'Confirmar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Venda
// ─────────────────────────────────────────────
function ModalVenda({ lote, cotacao, onClose, onSalvo }) {
  const { usuario } = useAuth()
  const [quantidade, setQuantidade] = useState('')
  const [comprador, setComprador] = useState('')
  const [dataVenda, setDataVenda] = useState(getHoje())
  const [dataRecebimento, setDataRecebimento] = useState('')
  const [valorBruto, setValorBruto] = useState('')
  const [valorLiquido, setValorLiquido] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)

  const qtdMax = lote.saldoAtual
  const qtdNum = Number(quantidade)
  const brutoNum = Number(valorBruto)
  const liquidoNum = Number(valorLiquido)
  const deducoes = brutoNum > 0 && liquidoNum > 0 ? Math.max(0, brutoNum - liquidoNum) : null
  const pctDed = deducoes && brutoNum ? ((deducoes / brutoNum) * 100).toFixed(1) : null
  const invalido = !quantidade || qtdNum <= 0 || qtdNum > qtdMax || !comprador.trim() || !valorBruto || !valorLiquido

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const movId = `venda_${Date.now()}`
      await addDoc(collection(db, 'movimentacoesProducao'), {
        tipo: 'saida_venda',
        estoqueProducaoId: lote.id,
        cultura: lote.cultura,
        safraId: lote.safraId,
        safraNome: lote.safraNome,
        lavouraId: lote.lavouraId,
        lavouraNome: lote.lavouraNome,
        propriedadeId: lote.propriedadeId,
        propriedadeNome: lote.propriedadeNome,
        localArmazenagem: lote.localArmazenagem,
        unidade: lote.unidade,
        comprador: comprador.trim(),
        quantidade: qtdNum,
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
      await updateDoc(doc(db, 'estoqueProducao', lote.id), {
        saldoAtual: lote.saldoAtual - qtdNum,
      })
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
            <p className="text-xs text-gray-400 mt-0.5">
              {lote.cultura} · {lote.localArmazenagem} · Saldo: {formatarNumero(lote.saldoAtual, 0)} {lote.unidade}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {cotacao && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-amber-700">{cotacao.bolsa} · {cotacao.originalFormatado}</span>
              <span className="text-sm font-bold text-amber-800">≈ R$ {formatarMoeda(cotacao.valorBR)}/{lote.unidade}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade ({lote.unidade})</label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)} max={qtdMax}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${quantidade && (qtdNum <= 0 || qtdNum > qtdMax) ? 'border-red-300' : 'border-gray-200'}`} />
              {quantidade && qtdNum > qtdMax && <p className="text-xs text-red-500 mt-1">Máx: {formatarNumero(qtdMax, 0)} {lote.unidade}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comprador</label>
              <input type="text" value={comprador} onChange={e => setComprador(e.target.value)} placeholder="Cooperativa, trading..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data da venda</label>
              <input type="date" value={dataVenda} onChange={e => setDataVenda(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Data de recebimento <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input type="date" value={dataRecebimento} onChange={e => setDataRecebimento(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
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
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">Deduções (calculado automaticamente)</span>
              <span className="text-sm font-semibold text-gray-700">
                R$ {formatarMoeda(deducoes)} <span className="text-gray-400 font-normal text-xs">({pctDed}%)</span>
              </span>
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
            className="flex-1 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-xl py-2.5 text-sm font-semibold">
            {salvando ? 'Salvando...' : 'Confirmar venda'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Modal Transferência entre armazéns
// ─────────────────────────────────────────────
function ModalTransferencia({ lote, onClose, onSalvo, sugestoesLocal }) {
  const { usuario } = useAuth()
  const [localDestino, setLocalDestino] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [custoTransporte, setCustoTransporte] = useState('')
  const [dataMov, setDataMov] = useState(getHoje())
  const [salvando, setSalvando] = useState(false)

  const qtdNum = Number(quantidade)
  const invalido = !localDestino.trim() || !quantidade || qtdNum <= 0 || qtdNum > lote.saldoAtual

  async function salvar() {
    if (invalido) return
    setSalvando(true)
    try {
      const movId = `transf_${Date.now()}`
      const custo = Number(custoTransporte) || 0

      await addDoc(collection(db, 'movimentacoesProducao'), {
        tipo: 'transferencia_estoque',
        estoqueProducaoId: lote.id,
        cultura: lote.cultura,
        safraId: lote.safraId,
        safraNome: lote.safraNome,
        lavouraId: lote.lavouraId,
        propriedadeId: lote.propriedadeId,
        propriedadeNome: lote.propriedadeNome,
        localOrigem: lote.localArmazenagem,
        localDestino: localDestino.trim(),
        unidade: lote.unidade,
        quantidade: qtdNum,
        custoTransporte: custo,
        dataMov,
        cancelado: false,
        movimentacaoId: movId,
        uid: usuario.uid,
        criadoEm: new Date(),
      })

      await updateDoc(doc(db, 'estoqueProducao', lote.id), {
        saldoAtual: lote.saldoAtual - qtdNum,
      })

      // Novo lote no destino
      const { id: _id, criadoEm: _c, ...loteSemId } = lote
      await addDoc(collection(db, 'estoqueProducao'), {
        ...loteSemId,
        localArmazenagem: localDestino.trim(),
        quantidadeEntrada: qtdNum,
        saldoAtual: qtdNum,
        colheitaOrigemId: lote.colheitaOrigemId || '',
        transferenciaOrigemId: movId,
        uid: usuario.uid,
        criadoEm: new Date(),
      })

      // Custo de transporte → financeiro
      if (custo > 0) {
        await addDoc(collection(db, 'financeiro'), {
          descricao: `Transporte ${lote.cultura}: ${lote.localArmazenagem} → ${localDestino.trim()}`,
          tipo: 'despesa',
          categoria: 'Logística',
          tipoDespesa: 'Fretes e Transportes',
          valor: custo,
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

      onSalvo()
      onClose()
    } catch (e) { console.error(e) }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-800">Transferir entre armazéns</p>
            <p className="text-xs text-gray-400 mt-0.5">De: {lote.localArmazenagem} · {formatarNumero(lote.saldoAtual, 0)} {lote.unidade} disponíveis</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Local de destino</label>
            <AutocompleteInput value={localDestino} onChange={setLocalDestino}
              placeholder="Silo, cooperativa, armazém..."
              sugestoes={sugestoesLocal.filter(s => s !== lote.localArmazenagem)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade ({lote.unidade})</label>
              <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)} max={lote.saldoAtual}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${quantidade && (qtdNum <= 0 || qtdNum > lote.saldoAtual) ? 'border-red-300' : 'border-gray-200'}`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Custo transporte (R$) <span className="text-gray-400 font-normal">opc.</span></label>
              <input type="number" step="0.01" value={custoTransporte} onChange={e => setCustoTransporte(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data</label>
            <input type="date" value={dataMov} onChange={e => setDataMov(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || invalido}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-2.5 text-sm font-semibold">
            {salvando ? 'Transferindo...' : 'Confirmar transferência'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Lote individual
// ─────────────────────────────────────────────
function CardLote({ lote, movs, cotacao, onVenda, onTransferencia }) {
  const [expandido, setExpandido] = useState(true)
  const pctSaldo = lote.quantidadeEntrada > 0 ? (lote.saldoAtual / lote.quantidadeEntrada) * 100 : 0
  const qtdSaida = lote.quantidadeEntrada - lote.saldoAtual
  const camposQ = getCamposQualidade(lote.cultura || '')
  const qualResumo = camposQ
    .map(c => lote.qualidade?.[c.key] ? `${c.label.replace(/ \(.*\)/, '')}: ${lote.qualidade[c.key]}${c.unidade ? c.unidade : ''}` : null)
    .filter(Boolean).join(' · ')

  const bgZebra = (i) => i % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Header lote */}
      <div className="px-4 py-2.5 bg-white">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {lote.lavouraNome || 'Lote'} — {formatarData(lote.dataColheita)}
            </p>
            <p className="text-xs text-gray-400 truncate mt-0.5">
              {lote.safraNome} · {lote.localArmazenagem}{qualResumo ? ` · ${qualResumo}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400">Entrada: {formatarNumero(lote.quantidadeEntrada, 0)} {lote.unidade}</span>
            {movs.length > 0 && (
              <button onClick={() => setExpandido(e => !e)} className="text-gray-400 hover:text-gray-600">
                {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Saídas vinculadas ao lote */}
      {expandido && movs.length > 0 && (
        <div className="border-t border-gray-100">
          {movs.map((m, i) => (
            <div key={m.id} className={`${bgZebra(i)} px-4 py-2 flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 truncate">
                  {m.tipo === 'transferencia_estoque'
                    ? `↔ Transferência → ${m.localDestino}`
                    : `↓ Venda · ${m.comprador}`}
                  {' · '}{formatarData(m.dataVenda || m.dataMov)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {m.tipo === 'saida_venda'
                    ? `Receita líq.: R$ ${formatarMoeda(m.valorLiquido)}`
                    : m.custoTransporte > 0 ? `Transp.: R$ ${formatarMoeda(m.custoTransporte)}` : ''}
                </p>
              </div>
              <span className="text-sm font-bold text-gray-700 flex-shrink-0">
                {formatarNumero(m.quantidade, 0)} {lote.unidade}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Barra de saldo */}
      <div className="px-4 pb-3 pt-2 bg-white border-t border-gray-50">
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${Math.min(pctSaldo, 100)}%` }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-green-700">
            Saldo: {formatarNumero(lote.saldoAtual, 0)} {lote.unidade}
            {qtdSaida > 0 && <span className="text-gray-400 font-normal"> · Saídas: {formatarNumero(qtdSaida, 0)} ({(100 - pctSaldo).toFixed(0)}%)</span>}
          </span>
          {lote.saldoAtual > 0 && (
            <div className="flex gap-2">
              <button onClick={() => onTransferencia(lote)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 px-2 py-1 rounded-lg">
                <ArrowRightLeft size={11} /> Transferir
              </button>
              <button onClick={() => onVenda(lote)}
                className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg font-medium">
                <ShoppingCart size={11} /> Vender
              </button>
            </div>
          )}
          {lote.saldoAtual === 0 && (
            <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Esgotado</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Card de Cultura (card principal colapsável)
// ─────────────────────────────────────────────
function CardCultura({ cultura, lotes, movsPorLote, cotacao, onVenda, onTransferencia }) {
  const [aberto, setAberto] = useState(true)

  const saldoTotal = lotes.reduce((s, l) => s + (l.saldoAtual || 0), 0)
  const receitaRealizada = Object.values(movsPorLote).flat()
    .filter(m => m.tipo === 'saida_venda' && !m.cancelado)
    .reduce((s, m) => s + (m.valorLiquido || 0), 0)
  const receitaPotencial = cotacao && saldoTotal > 0 ? saldoTotal * cotacao.valorBR : null
  const unidade = lotes[0]?.unidade || 'sc'

  // Ícone da cultura
  const cult = getCultura(cultura)
  const icone = cult?.icone || '🌾'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      {/* Header — estilo Producao.jsx */}
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full text-left transition-colors hover:brightness-95"
        style={{ background: 'linear-gradient(to right, #f0fdf4, #ffffff)' }}>

        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-green-600 text-white text-sm">
              {icone}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-800 text-sm truncate">{cultura}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={e => { e.stopPropagation(); onVenda(lotes.find(l => l.saldoAtual > 0)) }}
              className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1.5 rounded-lg font-medium">
              <ShoppingCart size={11} /> Venda
            </button>
            {aberto ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
          </div>
        </div>

        {/* Indicadores em colunas — mesmo padrão de Producao.jsx */}
        <div className="flex items-stretch border-t border-green-100 mt-1">
          <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
            <p className="text-sm font-bold text-green-700 leading-tight">
              {formatarNumero(saldoTotal, 0)} <span className="text-xs font-medium">{unidade}</span>
            </p>
            <p className="text-xs text-gray-400 leading-tight">saldo</p>
          </div>
          <div className="w-px bg-green-100 self-stretch" />
          <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
            {receitaPotencial != null ? (
              <>
                <p className="text-sm font-bold text-green-700 leading-tight">R$ {formatarMoeda(receitaPotencial)}</p>
                <p className="text-xs text-gray-400 leading-tight">potencial</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-gray-300 leading-tight">—</p>
                <p className="text-xs text-gray-400 leading-tight">potencial</p>
              </>
            )}
          </div>
          <div className="w-px bg-green-100 self-stretch" />
          <div className="flex-1 flex flex-col items-center justify-center py-2 px-1">
            {receitaRealizada > 0 ? (
              <>
                <p className="text-sm font-bold text-green-700 leading-tight">R$ {formatarMoeda(receitaRealizada)}</p>
                <p className="text-xs text-gray-400 leading-tight">realizado</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-gray-300 leading-tight">—</p>
                <p className="text-xs text-gray-400 leading-tight">realizado</p>
              </>
            )}
          </div>
        </div>
      </button>

      {/* Lotes */}
      {aberto && (
        <div className="border-t border-gray-100 p-3 space-y-2.5">
          {lotes.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Nenhum lote</p>
          ) : (
            lotes.map(lote => (
              <CardLote key={lote.id} lote={lote}
                movs={movsPorLote[lote.id] || []}
                cotacao={cotacao}
                onVenda={onVenda}
                onTransferencia={onTransferencia}
              />
            ))
          )}
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
  const [aba, setAba] = useState('atual')  // 'atual' | 'historico'

  const [lotes, setLotes] = useState([])
  const [movs, setMovs] = useState([])
  const [propriedades, setPropriedades] = useState([])
  const [safras, setSafras] = useState([])
  const [cotacoes, setCotacoes] = useState({})  // { cultura: { valorBR, bolsa, ... } }
  const [cotacaoEditando, setCotacaoEditando] = useState(null)
  const [cotacaoManualVal, setCotacaoManualVal] = useState('')
  const [carregando, setCarregando] = useState(true)

  // Filtros
  const [filtroPropriedadeIds, setFiltroPropriedadeIds] = useState([])
  const [filtroSafraId, setFiltroSafraId] = useState('')
  const [dropdownPropAberto, setDropdownPropAberto] = useState(false)

  // Modais
  const [modalEntrada, setModalEntrada] = useState(null)  // colheita obj
  const [modalVenda, setModalVenda] = useState(null)      // lote obj
  const [modalTransf, setModalTransf] = useState(null)    // lote obj

  // sugestões autocomplete de locais
  const sugestoesLocal = useMemo(
    () => [...new Set(lotes.map(l => l.localArmazenagem).filter(Boolean))],
    [lotes]
  )

  // ── Carregamento ──────────────────────────────────────────────────────────
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

  // ── Busca cotações via Vercel Function ────────────────────────────────────
  useEffect(() => {
    async function buscar() {
      try {
        const res = await fetch('/api/cotacao')
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        // mapear de culturaKey → cultura.nome
        const mapa = {}
        const MAP_KEY = {
          soja: 'Soja', milho: 'Milho', cafe: 'Café', cafe_arabica: 'Café Arábica',
          trigo: 'Trigo', algodao: 'Algodão', boi_gordo: 'Boi Gordo',
        }
        Object.entries(data.culturas || {}).forEach(([k, v]) => {
          if (v.ok && MAP_KEY[k]) {
            mapa[MAP_KEY[k]] = {
              valorBR: v.valorBR,
              bolsa: v.bolsa,
              originalFormatado: v.precoOriginalFormatado,
              timestamp: v.timestamp,
              unidadeBR: v.unidadeBR,
            }
          }
        })
        setCotacoes(mapa)
      } catch (e) { console.warn('Cotação indisponível') }
    }
    buscar()
    const t = setInterval(buscar, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Lógica de filtros + agrupamento ──────────────────────────────────────
  const lotesFiltrados = useMemo(() => {
    const eAtual = (l) => l.saldoAtual > 0
    return lotes.filter(l => {
      if (l.cancelado) return false
      if (aba === 'atual' && !eAtual(l)) return false
      if (aba === 'historico' && eAtual(l)) return false
      if (filtroPropriedadeIds.length > 0 && !filtroPropriedadeIds.includes(l.propriedadeId)) return false
      if (filtroSafraId && l.safraId !== filtroSafraId) return false
      return true
    })
  }, [lotes, aba, filtroPropriedadeIds, filtroSafraId])

  const movsPorLote = useMemo(() => {
    const m = {}
    movs.filter(mv => !mv.cancelado).forEach(mv => {
      const lid = mv.estoqueProducaoId
      if (!m[lid]) m[lid] = []
      m[lid].push(mv)
    })
    return m
  }, [movs])

  // Agrupado: propriedade → cultura → lotes
  const agrupado = useMemo(() => {
    const r = {}
    lotesFiltrados.forEach(l => {
      const prop = l.propriedadeNome || 'Sem propriedade'
      const cult = l.cultura || 'Outros'
      if (!r[prop]) r[prop] = {}
      if (!r[prop][cult]) r[prop][cult] = []
      r[prop][cult].push(l)
    })
    return r
  }, [lotesFiltrados])

  // Dashboards (sem filtros de aba, apenas propriedade)
  const lotesAtivos = useMemo(() =>
    lotes.filter(l => !l.cancelado && l.saldoAtual > 0 &&
      (filtroPropriedadeIds.length === 0 || filtroPropriedadeIds.includes(l.propriedadeId))),
    [lotes, filtroPropriedadeIds]
  )
  const saldoPorCultura = useMemo(() => {
    const m = {}
    lotesAtivos.forEach(l => { m[l.cultura] = (m[l.cultura] || 0) + l.saldoAtual })
    return m
  }, [lotesAtivos])
  const receitaPotencialTotal = useMemo(() =>
    Object.entries(saldoPorCultura).reduce((acc, [c, qtd]) => acc + (cotacoes[c]?.valorBR ? qtd * cotacoes[c].valorBR : 0), 0),
    [saldoPorCultura, cotacoes]
  )
  const primeiraCulturaComCotacao = Object.keys(saldoPorCultura).find(c => cotacoes[c])

  function handleCotacaoManual(cultNome) {
    const val = Number(cotacaoManualVal)
    if (!val) return
    setCotacoes(prev => ({
      ...prev,
      [cultNome]: { ...(prev[cultNome] || {}), valorBR: val, bolsa: 'Manual', originalFormatado: 'Inserido manualmente', timestamp: new Date().toISOString() },
    }))
    setCotacaoEditando(null)
    setCotacaoManualVal('')
  }

  if (carregando) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
    </div>
  )

  const temLotes = Object.keys(agrupado).length > 0

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold text-gray-800">Estoque de Produção</h1>

      {/* ── Filtros — padrão Financeiro/Producao ── */}
      <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</p>
        <div className="flex flex-wrap items-center gap-2">

          {/* Dropdown propriedades */}
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
                {propriedades.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Nenhuma propriedade.</p>}
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

          {/* Safra */}
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
        {/* Saldo */}
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Saldo em estoque</p>
          {Object.keys(saldoPorCultura).length === 0 ? (
            <p className="text-sm text-gray-400">—</p>
          ) : Object.entries(saldoPorCultura).map(([c, qtd]) => (
            <p key={c} className="text-sm font-bold text-green-700">
              {formatarNumero(qtd, 0)} <span className="text-xs font-medium text-gray-500">{lotes.find(l => l.cultura === c)?.unidade || 'sc'} {c}</span>
            </p>
          ))}
        </div>

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
                    <p className="text-lg font-bold text-green-700">R$ {formatarMoeda(cot.valorBR)}</p>
                    <button onClick={() => setCotacaoEditando(primeiraCulturaComCotacao)} className="text-xs text-gray-400 hover:text-gray-600">✎</button>
                  </div>
                )}
                {cot.timestamp && (
                  <p className="text-xs text-gray-400 mt-1">
                    Atualizado: {new Date(cot.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
          <p className="text-lg font-bold text-green-700">
            {receitaPotencialTotal > 0 ? `R$ ${formatarMoeda(receitaPotencialTotal)}` : '—'}
          </p>
          {receitaPotencialTotal > 0 && <p className="text-xs text-gray-400 mt-1">saldo × cotação</p>}
        </div>
      </div>

      {/* ── Abas — padrão do projeto ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[{ key: 'atual', label: 'Estoque atual' }, { key: 'historico', label: 'Histórico / vendidos' }].map(t => (
          <button key={t.key} onClick={() => setAba(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${aba === t.key ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo ── */}
      {!temLotes ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🌾</p>
          <p className="text-base font-medium">
            {aba === 'atual' ? 'Nenhum lote em estoque' : 'Nenhum lote no histórico'}
          </p>
          <p className="text-sm mt-1">Registre colheitas na aba Produção e dê entrada no estoque</p>
        </div>
      ) : (
        Object.entries(agrupado).map(([propNome, culturas]) => (
          <div key={propNome}>
            {Object.keys(agrupado).length > 1 && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{propNome}</p>
            )}
            {Object.entries(culturas).map(([cultura, lotesC]) => (
              <CardCultura key={cultura} cultura={cultura} lotes={lotesC}
                movsPorLote={movsPorLote}
                cotacao={cotacoes[cultura]}
                onVenda={l => l && setModalVenda(l)}
                onTransferencia={l => setModalTransf(l)}
              />
            ))}
          </div>
        ))
      )}

      {/* ── Modais ── */}
      {modalEntrada && (
        <ModalEntrada colheita={modalEntrada} onClose={() => setModalEntrada(null)}
          onSalvo={carregar} sugestoesLocal={sugestoesLocal} />
      )}
      {modalVenda && (
        <ModalVenda lote={modalVenda} cotacao={cotacoes[modalVenda.cultura]}
          onClose={() => setModalVenda(null)} onSalvo={carregar} />
      )}
      {modalTransf && (
        <ModalTransferencia lote={modalTransf} onClose={() => setModalTransf(null)}
          onSalvo={carregar} sugestoesLocal={sugestoesLocal} />
      )}
    </div>
  )
}