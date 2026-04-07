// src/components/PainelDebugCusto.jsx
// Painel de verificação do cálculo de custo estimado.
// Exibe os dados que entraram no cálculo por camada para facilitar validação.
// Para desativar: mude DEBUG_CUSTO = false em useCustoProducao.js
// Para remover definitivamente: delete este arquivo e retire o import de Producao.jsx

import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

function fmtR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtN(v, d = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function SecaoDebug({ titulo, itens, cor }) {
  const [aberta, setAberta] = useState(false)
  if (!itens || itens.length === 0) return (
    <div className={`text-xs text-gray-400 px-3 py-1.5 rounded ${cor} mb-1`}>
      {titulo}: <span className="italic">nenhum lançamento encontrado</span>
    </div>
  )
  return (
    <div className={`rounded mb-1 ${cor}`}>
      <button onClick={() => setAberta(a => !a)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left">
        <span className="text-xs font-semibold">{titulo} ({itens.length})</span>
        {aberta ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {aberta && (
        <div className="px-3 pb-2 space-y-0.5">
          {itens.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs text-gray-700 border-t border-gray-200 pt-0.5">
              <span className="truncate flex-1">{item.descricao} → {item.lavoura}</span>
              <span className="flex-shrink-0 text-gray-500">{item.fator}</span>
              <span className="flex-shrink-0 font-medium text-green-700">R$ {fmtR(item.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PainelDebugCusto({ safras }) {
  const [aberto, setAberto] = useState(false)
  const [safraSel, setSafraSel] = useState(null)

  const safrasComCusto = safras.filter(s => s.custoEstimado)
  if (safrasComCusto.length === 0) return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
      <strong>Debug Custo:</strong> Nenhuma safra com custoEstimado calculado ainda.
      Verifique se <code>useCustoProducaoBackground</code> está sendo chamado em App.jsx e aguarde ~3s após o login.
    </div>
  )

  const safra = safraSel ? safrasComCusto.find(s => s.id === safraSel) : safrasComCusto[0]
  const ce = safra?.custoEstimado

  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl overflow-hidden">
      <button onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-yellow-100 hover:bg-yellow-200 transition-colors">
        <span className="text-xs font-bold text-yellow-800">🔍 Debug: Cálculo de Custo Estimado</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-yellow-600">{safrasComCusto.length} safra(s) calculada(s)</span>
          {aberto ? <ChevronUp size={13} className="text-yellow-700" /> : <ChevronDown size={13} className="text-yellow-700" />}
        </div>
      </button>

      {aberto && (
        <div className="px-4 py-3 space-y-3">
          {/* Seletor de safra */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium">Safra:</label>
            <select value={safraSel || safrasComCusto[0]?.id}
              onChange={e => setSafraSel(e.target.value)}
              className="text-xs border border-yellow-300 rounded-lg px-2 py-1 bg-white">
              {safrasComCusto.map(s => (
                <option key={s.id} value={s.id}>{s.nome} — {s.cultura}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">
              Calculado em: {ce?.calculadoEm ? new Date(ce.calculadoEm).toLocaleTimeString('pt-BR') : '—'}
            </span>
          </div>

          {ce && (
            <>
              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Total despesas', valor: `R$ ${fmtR(ce.totalDespesas)}` },
                  { label: 'Total colhido', valor: `${fmtN(ce.totalColhido)} ${ce.unidade || 'sc'}` },
                  { label: 'Custo médio', valor: ce.total != null ? `R$ ${fmtR(ce.total)}/${ce.unidade}` : '—' },
                  { label: 'Cobertura', valor: `${ce.coberturaPercent ?? 0}%` },
                ].map(item => (
                  <div key={item.label} className="bg-white rounded-lg px-3 py-2 border border-yellow-200">
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className="text-sm font-bold text-gray-800">{item.valor}</p>
                  </div>
                ))}
              </div>

              {/* Por lavoura */}
              {ce.porLavoura && Object.keys(ce.porLavoura).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Por lavoura:</p>
                  <div className="space-y-1">
                    {Object.entries(ce.porLavoura).map(([lid, v]) => (
                      <div key={lid} className="bg-white rounded-lg px-3 py-1.5 border border-yellow-200 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">{v.lavouraNome || lid}</span>
                        <div className="flex gap-3 text-xs text-gray-500">
                          <span>Despesa: <strong>R$ {fmtR(v.despesaTotal)}</strong></span>
                          <span>Colhido: <strong>{fmtN(v.quantidadeColhida)} {ce.unidade}</strong></span>
                          <span className="text-green-700 font-bold">
                            {v.custoSc != null ? `R$ ${fmtR(v.custoSc)}/${ce.unidade}` : '⚠ sem colheita'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lançamentos por camada */}
              {ce.debugLog && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Detalhamento por camada:</p>
                  <SecaoDebug titulo="Camada 1 — Saídas de insumos com lavoura" itens={ce.debugLog.camada1} cor="bg-blue-50 border border-blue-200 text-blue-900" />
                  <SecaoDebug titulo="Camada 2 — Saídas de insumos sem lavoura (rateio área safra)" itens={ce.debugLog.camada2} cor="bg-indigo-50 border border-indigo-200 text-indigo-900" />
                  <SecaoDebug titulo="Camada 3 — Despesas avulsas (rateio período)" itens={ce.debugLog.camada3} cor="bg-purple-50 border border-purple-200 text-purple-900" />
                  <SecaoDebug titulo="Camada 4 — Despesas com safra (rateio área)" itens={ce.debugLog.camada4} cor="bg-orange-50 border border-orange-200 text-orange-900" />
                </div>
              )}

              <p className="text-xs text-yellow-700 bg-yellow-100 rounded-lg px-3 py-2">
                ⚠ Este painel é temporário para verificação. Desative mudando <code>DEBUG_CUSTO = false</code> em useCustoProducao.js e remove este componente quando confirmar que os valores estão corretos.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}