// src/components/PainelDebugCusto.jsx
// Painel de verificação do cálculo de custo estimado.
// Recalcula em tempo real (não lê debugLog do Firestore).
// Para desativar: mude DEBUG_CUSTO = false em useCustoProducao.js

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { calcularCustoProducaoDebug, calcularCustoProducao } from '../hooks/useCustoProducao'
import { useAuth } from '../contexts/AuthContext'

function fmtR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SecaoDebug({ titulo, itens, cor }) {
  const [aberta, setAberta] = useState(false)
  const total = (itens || []).reduce((s, i) => s + (i.valor || 0), 0)

  return (
    <div className={`rounded-lg mb-1 ${cor}`}>
      <button onClick={() => setAberta(a => !a)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left">
        <span className="text-xs font-semibold">
          {titulo}
          <span className="ml-2 font-normal opacity-70">
            ({(itens || []).length} item{(itens || []).length !== 1 ? 's' : ''} · R$ {fmtR(total)})
          </span>
        </span>
        {aberta ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {aberta && (
        <div className="px-3 pb-2 space-y-0.5">
          {!(itens || []).length
            ? <p className="text-xs italic opacity-60">Nenhum lançamento nesta camada.</p>
            : itens.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs border-t border-black/5 pt-0.5">
                <span className="truncate flex-1">{item.descricao}</span>
                <span className="flex-shrink-0 opacity-60">{item.lavoura}</span>
                <span className="flex-shrink-0 opacity-60">{item.fator}{item.fonte ? ` [${item.fonte}]` : ''}</span>
                <span className="flex-shrink-0 font-semibold">R$ {fmtR(item.valor)}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

export function PainelDebugCusto({ safras }) {
  const { usuario } = useAuth()
  const [aberto, setAberto]         = useState(false)
  const [safraSel, setSafraSel]     = useState(null)
  const [resultado, setResultado]   = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando]     = useState(false)
  const [erro, setErro]             = useState(null)
  const [salvoOk, setSalvoOk]       = useState(false)

  const safrasDisponiveis = (safras || []).filter(s => s.id)

  const recalcular = useCallback(async (id) => {
    const safraId = id || safraSel || safrasDisponiveis[0]?.id
    if (!safraId || !usuario?.uid) return
    setSafraSel(safraId)
    setCarregando(true)
    setErro(null)
    setResultado(null)
    try {
      const res = await calcularCustoProducaoDebug(usuario.uid, safraId)
      setResultado(res)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [safraSel, safrasDisponiveis, usuario])

  if (safrasDisponiveis.length === 0) return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
      <strong>Debug Custo:</strong> Nenhuma safra encontrada.
    </div>
  )

  const ce = resultado

  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl overflow-hidden">
      <button
        onClick={() => {
          const novoAberto = !aberto
          setAberto(novoAberto)
          if (novoAberto && !resultado) recalcular(null)
        }}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-yellow-100 hover:bg-yellow-200 transition-colors">
        <span className="text-xs font-bold text-yellow-800">🔍 Debug: Cálculo de Custo Estimado</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-yellow-600">{safrasDisponiveis.length} safra(s)</span>
          {aberto ? <ChevronUp size={13} className="text-yellow-700" /> : <ChevronDown size={13} className="text-yellow-700" />}
        </div>
      </button>

      {aberto && (
        <div className="px-4 py-3 space-y-3">
          {/* Seletor de safra + recalcular */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500 font-medium">Safra:</label>
            <select
              value={safraSel || safrasDisponiveis[0]?.id}
              onChange={e => { setSafraSel(e.target.value); setResultado(null) }}
              className="text-xs border border-yellow-300 rounded-lg px-2 py-1 bg-white">
              {safrasDisponiveis.map(s => (
                <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>
              ))}
            </select>
            <button
              onClick={() => recalcular(safraSel || safrasDisponiveis[0]?.id)}
              disabled={carregando}
              className="flex items-center gap-1.5 text-xs bg-yellow-200 hover:bg-yellow-300 text-yellow-800 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors">
              <RefreshCw size={11} className={carregando ? 'animate-spin' : ''} />
              {carregando ? 'Calculando...' : 'Recalcular'}
            </button>
            <button
              onClick={async () => {
                if (!usuario?.uid) return
                setSalvando(true); setSalvoOk(false); setErro(null)
                try {
                  await calcularCustoProducao(usuario.uid)
                  setSalvoOk(true)
                  setTimeout(() => setSalvoOk(false), 3000)
                  // Recarregar resultado após salvar
                  await recalcular(safraSel || safrasDisponiveis[0]?.id)
                } catch(e) { setErro(e.message) }
                finally { setSalvando(false) }
              }}
              disabled={salvando || carregando}
              className="flex items-center gap-1.5 text-xs bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors">
              <RefreshCw size={11} className={salvando ? 'animate-spin' : ''} />
              {salvando ? 'Salvando...' : salvoOk ? '✓ Salvo!' : 'Salvar no Firestore'}
            </button>
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              Erro: {erro}
            </div>
          )}

          {!ce && !carregando && (
            <p className="text-xs text-gray-400 italic">Clique em Recalcular para ver o detalhamento.</p>
          )}

          {ce && (
            <>
              {/* Resumo numérico */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Total despesas', valor: `R$ ${fmtR(ce.totalDespesas)}` },
                  { label: 'Total colhido',  valor: `${Number(ce.totalColhido || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${ce.unidade || 'sc'}` },
                  { label: 'Custo médio',    valor: ce.total != null ? `R$ ${fmtR(ce.total)}/${ce.unidade}` : '—' },
                  { label: 'Cobertura',      valor: `${ce.coberturaPercent ?? 0}%` },
                ].map(item => (
                  <div key={item.label} className="bg-white rounded-lg px-3 py-2 border border-yellow-200">
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className="text-sm font-bold text-gray-800">{item.valor}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 text-xs text-gray-500">
                <span>Saídas insumos: <strong>{ce.numSaidasInsumos}</strong></span>
                <span>Patrimônios: <strong>{ce.numPatrimonios}</strong></span>
              </div>

              {/* Por lavoura */}
              {ce.porLavoura && Object.keys(ce.porLavoura).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Por lavoura:</p>
                  <div className="space-y-1">
                    {Object.entries(ce.porLavoura).map(([lid, v]) => (
                      <div key={lid} className="bg-white rounded-lg px-3 py-1.5 border border-yellow-200 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">{v.lavouraNome || lid}</span>
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                          <span>Despesa: <strong className="text-gray-700">R$ {fmtR(v.despesaTotal)}</strong></span>
                          <span>Colhido: <strong className="text-gray-700">{Number(v.quantidadeColhida || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {ce.unidade}</strong></span>
                          <span className={`font-bold ${v.custoSc != null ? 'text-green-700' : 'text-amber-500'}`}>
                            {v.custoSc != null ? `R$ ${fmtR(v.custoSc)}/${ce.unidade}` : '⚠ sem colheita'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Camadas */}
              {ce.debugLog && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Detalhamento por camada:</p>
                  <SecaoDebug titulo="Camada 1 — Insumos com lavoura"              itens={ce.debugLog.camada1} cor="bg-blue-50 border border-blue-200 text-blue-900" />
                  <SecaoDebug titulo="Camada 2 — Insumos sem lavoura (área safra)" itens={ce.debugLog.camada2} cor="bg-indigo-50 border border-indigo-200 text-indigo-900" />
                  <SecaoDebug titulo="Camada 3 — Despesas avulsas (período)"       itens={ce.debugLog.camada3} cor="bg-purple-50 border border-purple-200 text-purple-900" />
                  <SecaoDebug titulo="Camada 4 — Despesas vinculadas à safra"      itens={ce.debugLog.camada4} cor="bg-orange-50 border border-orange-200 text-orange-900" />
                  <SecaoDebug titulo="Camada 5 — Depreciação de patrimônios"       itens={ce.debugLog.camada5} cor="bg-red-50 border border-red-200 text-red-900" />
                </div>
              )}

              <p className="text-xs text-yellow-700 bg-yellow-100 rounded-lg px-3 py-2">
                ⚠ Painel temporário. Remova quando validado — <code>DEBUG_CUSTO = false</code> em useCustoProducao.js.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}