// src/hooks/useCustoProducao.js
// Calcula custo médio de produção por safra/lavoura.
// Lógica correta: usa movimentacoesInsumos (saídas) para calcular custo proporcional
// ao que foi efetivamente usado em cada lavoura/safra, via custo FIFO das entradas.
// Despesas avulsas do financeiro (sem safra) entram na camada 3 pelo vencimento.

import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'

// ─────────────────────────────────────────────
// Controle de debug — mude para false para desativar o painel de verificação
// ─────────────────────────────────────────────
export const DEBUG_CUSTO = true

// ─────────────────────────────────────────────
// Função principal — chamada no login
// ─────────────────────────────────────────────
export async function calcularCustoProducao(uid) {
  if (!uid) return

  const [safrasSnap, lavouraSnap, colheitasSnap, saídasSnap, entradasSnap, despesasSnap] =
    await Promise.all([
      getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
      // Saídas de insumos (consumos aplicados nas lavouras)
      getDocs(query(
        collection(db, 'movimentacoesInsumos'),
        where('uid', '==', uid),
        where('tipoMov', '==', 'saida'),
        where('cancelado', '==', false)
      )),
      // Entradas de insumos (para obter custo unitário FIFO)
      getDocs(query(
        collection(db, 'movimentacoesInsumos'),
        where('uid', '==', uid),
        where('tipoMov', '==', 'entrada'),
        where('cancelado', '==', false)
      )),
      // Despesas avulsas do financeiro (sem vínculo com safra — camada 3)
      getDocs(query(
        collection(db, 'financeiro'),
        where('uid', '==', uid),
        where('tipo', '==', 'despesa'),
        where('cancelado', '==', false)
      )),
    ])

  const safras    = safrasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const lavouras  = lavouraSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const colheitas = colheitasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const saidas    = saídasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const entradas  = entradasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const despesas  = despesasSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Mapa de custo unitário por entradaId (para reconstruir custo das saídas via FIFO)
  // entradaId = movimentacaoId da entrada (campo adicionado no addDoc do Estoque.jsx)
  const custoUnitPorEntrada = {}
  entradas.forEach(e => {
    const movId = e.movimentacaoId || e.id
    const qtd = Number(e.quantidade) || 0
    const val = Number(e.valorTotal) || 0
    if (qtd > 0 && val > 0) {
      custoUnitPorEntrada[movId] = val / qtd
    }
  })

  for (const safra of safras) {
    try {
      const resultado = calcularCustoPorSafra(
        safra, lavouras, colheitas, saidas, entradas, custoUnitPorEntrada, despesas, safras
      )
      await updateDoc(doc(db, 'safras', safra.id), {
        custoEstimado: { ...resultado, calculadoEm: new Date().toISOString() }
      })
    } catch (e) {
      console.warn(`[custo] Erro safra ${safra.id}:`, e.message)
    }
  }
}

// ─────────────────────────────────────────────
// Calcula custo para uma safra
// ─────────────────────────────────────────────
function calcularCustoPorSafra(
  safra, todasLavouras, todasColheitas,
  todasSaidas, todasEntradas, custoUnitPorEntrada,
  todasDespesas, todasSafras
) {
  const lavourasDaSafra = todasLavouras.filter(l => safra.lavouraIds?.includes(l.id))
  const areaTotalSafra  = lavourasDaSafra.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)
  const colheitasDaSafra = todasColheitas.filter(c => c.safraId === safra.id && !c.cancelado)

  // Acumuladores de custo por lavoura
  const despesasPorLavoura = {}
  lavourasDaSafra.forEach(l => { despesasPorLavoura[l.id] = 0 })

  // Log de debug por camada
  const debugLog = { camada1: [], camada2: [], camada3: [], camada4: [] }

  // ─── CAMADA 1 e 2: saídas de insumos ────────────────────────────────────
  // Saídas com safraId === esta safra e lavouraIds preenchidos → 100% da(s) lavoura(s)
  const saidasDaSafra = todasSaidas.filter(s =>
    s.safraId === safra.id && s.propriedadeId === safra.propriedadeId
  )

  for (const saida of saidasDaSafra) {
    // Calcular custo total desta saída via FIFO nos lotesConsumidos
    let custoTotalSaida = 0
    if (saida.lotesConsumidos && saida.lotesConsumidos.length > 0) {
      saida.lotesConsumidos.forEach(lc => {
        const cuUnit = custoUnitPorEntrada[lc.entradaId] || 0
        custoTotalSaida += cuUnit * (Number(lc.quantidade) || 0)
      })
    } else {
      // Fallback: buscar a entrada do produto e calcular custo médio
      const entradasProduto = todasEntradas.filter(e =>
        e.produtoId === saida.produtoId && e.propriedadeId === safra.propriedadeId
      )
      const qtdTotalEntrada = entradasProduto.reduce((s, e) => s + (Number(e.quantidade) || 0), 0)
      const valTotalEntrada = entradasProduto.reduce((s, e) => s + (Number(e.valorTotal) || 0), 0)
      const cuMedio = qtdTotalEntrada > 0 ? valTotalEntrada / qtdTotalEntrada : 0
      custoTotalSaida = cuMedio * (Number(saida.quantidade) || 0)
    }

    if (custoTotalSaida <= 0) continue

    const lavouraIds = saida.lavouraIds || []
    const areaLavouras = lavouraIds.reduce((s, lid) => {
      const lav = todasLavouras.find(l => l.id === lid)
      return s + (Number(lav?.areaHa) || 0)
    }, 0)

    if (lavouraIds.length > 0) {
      // CAMADA 1: saída vinculada a lavouras → ratear pelo peso de área entre as lavouras da saída
      lavouraIds.forEach(lid => {
        if (despesasPorLavoura[lid] === undefined) return
        const lav = todasLavouras.find(l => l.id === lid)
        const areaLav = Number(lav?.areaHa) || 0
        const fator = areaLavouras > 0 ? areaLav / areaLavouras : 1 / lavouraIds.length
        const valor = custoTotalSaida * fator
        despesasPorLavoura[lid] = (despesasPorLavoura[lid] || 0) + valor
        debugLog.camada1.push({
          descricao: saida.produtoNome || 'Insumo',
          lavoura: lav?.nome || lid,
          valor,
          fator: `${(fator * 100).toFixed(1)}% da saída`,
        })
      })
    } else {
      // CAMADA 2: saída com safraId mas sem lavouraIds → ratear por área entre lavouras da safra
      if (areaTotalSafra > 0) {
        lavourasDaSafra.forEach(l => {
          const fator = (Number(l.areaHa) || 0) / areaTotalSafra
          const valor = custoTotalSaida * fator
          despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + valor
          debugLog.camada2.push({
            descricao: saida.produtoNome || 'Insumo',
            lavoura: l.nome,
            valor,
            fator: `${(fator * 100).toFixed(1)}% da área`,
          })
        })
      }
    }
  }

  // ─── CAMADA 3: despesas avulsas do financeiro sem safraId ────────────────
  // Campo correto: vencimento (não "data")
  const dataInicio = safra.dataInicio ? new Date(safra.dataInicio) : null
  const dataFim    = safra.dataTermino ? new Date(safra.dataTermino) : new Date()

  const despesasSemSafra = todasDespesas.filter(d =>
    !d.safraId &&
    d.propriedadeId === safra.propriedadeId &&
    // Excluir lançamentos do estoque de insumos (entradas — não são custo de uso)
    !d.origemEstoque
  )

  for (const desp of despesasSemSafra) {
    const valor = Number(desp.valor) || 0
    if (!valor) continue
    const dataDesp = desp.vencimento ? new Date(desp.vencimento) : null
    if (!dataDesp || !dataInicio || dataDesp < dataInicio || dataDesp > dataFim) continue

    // Encontrar todas as safras ativas nessa data
    const safrasNaData = todasSafras.filter(s => {
      if (!s.dataInicio || s.propriedadeId !== safra.propriedadeId) return false
      const ini = new Date(s.dataInicio)
      const fim = s.dataTermino ? new Date(s.dataTermino) : new Date()
      return dataDesp >= ini && dataDesp <= fim
    })
    if (!safrasNaData.find(s => s.id === safra.id)) continue

    const areaTotalGlobal = safrasNaData.reduce((acc, s) => {
      const lavs = todasLavouras.filter(l => s.lavouraIds?.includes(l.id))
      return acc + lavs.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
    }, 0)
    if (areaTotalGlobal <= 0) continue

    lavourasDaSafra.forEach(l => {
      const fator = (Number(l.areaHa) || 0) / areaTotalGlobal
      const val = valor * fator
      despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + val
      debugLog.camada3.push({
        descricao: desp.descricao || 'Despesa',
        lavoura: l.nome,
        valor: val,
        fator: `${(fator * 100).toFixed(1)}% área global`,
      })
    })
  }

  // ─── CAMADA 4: despesas avulsas do financeiro COM safraId desta safra ────
  // (despesas lançadas direto com vínculo de safra, sem vínculo de lavoura)
  const despesasComSafra = todasDespesas.filter(d =>
    d.safraId === safra.id &&
    !d.origemEstoque
  )

  for (const desp of despesasComSafra) {
    const valor = Number(desp.valor) || 0
    if (!valor || areaTotalSafra <= 0) continue
    lavourasDaSafra.forEach(l => {
      const fator = (Number(l.areaHa) || 0) / areaTotalSafra
      const val = valor * fator
      despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + val
      debugLog.camada4.push({
        descricao: desp.descricao || 'Despesa safra',
        lavoura: l.nome,
        valor: val,
        fator: `${(fator * 100).toFixed(1)}% da área da safra`,
      })
    })
  }

  // ─── Montar resultado ───────────────────────────────────────────────────
  const porLavoura = {}
  let totalDespesas = 0
  let totalColhido  = 0
  const unidade = safra.unidade || 'sc'

  lavourasDaSafra.forEach(l => {
    const desp = despesasPorLavoura[l.id] || 0
    const colhido = colheitasDaSafra
      .filter(c => c.lavouraId === l.id)
      .reduce((s, c) => s + (Number(c.quantidade) || 0), 0)

    totalDespesas += desp
    totalColhido  += colhido

    if (colhido > 0) {
      porLavoura[l.id] = {
        custoSc: desp / colhido,
        despesaTotal: desp,
        quantidadeColhida: colhido,
        lavouraNome: l.nome,
      }
    } else if (desp > 0) {
      porLavoura[l.id] = {
        custoSc: null,
        despesaTotal: desp,
        quantidadeColhida: 0,
        lavouraNome: l.nome,
        emAndamento: true,
      }
    }
  })

  // Para safras sem lavouras vinculadas, tentar calcular custo geral
  // usando colheitas sem lavoura específica
  if (lavourasDaSafra.length === 0) {
    const colhidoSemLavoura = colheitasDaSafra
      .reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
    totalColhido += colhidoSemLavoura
  }

  const totalCustoSc = totalColhido > 0 ? totalDespesas / totalColhido : null
  const lavourasCobertasCount = Object.values(porLavoura).filter(v => v.quantidadeColhida > 0).length
  const coberturaPercent = lavourasDaSafra.length > 0
    ? Math.round((lavourasCobertasCount / lavourasDaSafra.length) * 100)
    : (totalColhido > 0 ? 100 : 0)

  return {
    porLavoura,
    total: totalCustoSc,
    totalDespesas,
    totalColhido,
    unidade,
    coberturaPercent,
    emAndamento: safra.status !== 'Colhida',
    // Debug: salvar o log para exibição no painel
    debugLog: DEBUG_CUSTO ? debugLog : undefined,
    numSaidasInsumos: saidasDaSafra.length,
    numDespesasAvulsas: despesasSemSafra.length + despesasComSafra.length,
  }
}

// ─────────────────────────────────────────────
// Hook: dispara no login, em background (3s delay)
// ─────────────────────────────────────────────
export function useCustoProducaoBackground(uid) {
  const calculadoRef = useRef(false)

  useEffect(() => {
    if (!uid || calculadoRef.current) return
    calculadoRef.current = true
    setTimeout(() => {
      calcularCustoProducao(uid).catch(e =>
        console.warn('[custo] Cálculo background falhou:', e.message)
      )
    }, 3000)
  }, [uid])
}

// ─────────────────────────────────────────────
// Helpers de exibição
// ─────────────────────────────────────────────
export function formatarCustoEstimado(custoEstimado, unidade = 'sc') {
  if (!custoEstimado) return { texto: null, incompleto: false }
  const valor      = custoEstimado.total
  const emAndamento = custoEstimado.emAndamento
  const cobertura  = custoEstimado.coberturaPercent ?? 100
  if (valor == null) return { texto: null, incompleto: true }
  const textoValor = `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/${unidade}`
  return { texto: textoValor, incompleto: emAndamento || cobertura < 100, cobertura, emAndamento }
}

export function getCustoLote(safra, lavouraId) {
  if (!safra?.custoEstimado) return null
  const { porLavoura, total, unidade, emAndamento } = safra.custoEstimado
  if (lavouraId && porLavoura?.[lavouraId]?.custoSc != null) {
    return {
      valor: porLavoura[lavouraId].custoSc,
      unidade: unidade || 'sc',
      incompleto: emAndamento || porLavoura[lavouraId].emAndamento,
      fonte: 'lavoura',
    }
  }
  if (total != null) {
    return { valor: total, unidade: unidade || 'sc', incompleto: true, fonte: 'safra' }
  }
  return null
}