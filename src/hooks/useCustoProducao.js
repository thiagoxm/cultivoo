// src/hooks/useCustoProducao.js
// Calcula custo médio de produção por safra/lavoura.
// Fontes de custo:
//   Camada 1 — saídas de insumos com lavoura vinculada (custo via custoCalculado ou FIFO)
//   Camada 2 — saídas de insumos com safra mas sem lavoura (rateio por área entre lavouras)
//   Camada 3 — despesas avulsas do financeiro sem safraId (rateio por período e área global)
//   Camada 4 — despesas do financeiro com safraId (rateio por área entre lavouras da safra)
//   Camada 5 — depreciação de patrimônios vinculados à propriedade (proporcional ao período da safra)

import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../services/firebase'

// ─────────────────────────────────────────────
// Debug: mude para false para desativar o painel
// ─────────────────────────────────────────────
export const DEBUG_CUSTO = true

// ─────────────────────────────────────────────
// Fórmula de depreciação linear (linha reta)
// Idêntica à usada em services/depreciacao.js
// ─────────────────────────────────────────────
function calcularDepreciacaoMensal(patrimonio) {
  const aquisicao = Number(patrimonio.valorAquisicao) || 0
  const residual  = Number(patrimonio.valorResidual) || 0
  const vidaUtil  = Number(patrimonio.vidaUtil) || 0
  if (vidaUtil <= 0 || aquisicao <= residual) return 0
  return (aquisicao - residual) / (vidaUtil * 12)
}

// Percentual de rateio de um patrimônio para uma propriedade específica
function calcularPercentualRateio(patrimonio, propriedadeId, areasPorPropriedade) {
  const ids = patrimonio.propriedadeIds || []
  if (ids.length === 0) return 0
  if (!ids.includes(propriedadeId)) return 0
  if (ids.length === 1) return 1

  const { tipoRateio, percentuaisRateio } = patrimonio
  if (tipoRateio === 'personalizado') {
    return (Number(percentuaisRateio?.[propriedadeId]) || 0) / 100
  }
  if (tipoRateio === 'area') {
    const totalArea = ids.reduce((s, id) => s + (areasPorPropriedade[id] || 0), 0)
    return totalArea > 0 ? (areasPorPropriedade[propriedadeId] || 0) / totalArea : 0
  }
  // igualitario (default)
  return 1 / ids.length
}

// Número de meses de sobreposição entre dois períodos
function mesesSobrepostos(inicioA, fimA, inicioB, fimB) {
  if (!inicioA || !inicioB) return 0
  const start = new Date(Math.max(new Date(inicioA), new Date(inicioB)))
  const end   = new Date(Math.min(new Date(fimA), new Date(fimB)))
  if (start >= end) return 0
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
}

// ─────────────────────────────────────────────
// Função principal
// ─────────────────────────────────────────────
export async function calcularCustoProducao(uid) {
  if (!uid) return

  const [safrasSnap, lavouraSnap, colheitasSnap, saidasSnap, entradasSnap, despesasSnap, patrimoniosSnap] =
    await Promise.all([
      getDocs(query(collection(db, 'safras'),             where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'),           where('uid', '==', uid))),
      getDocs(query(collection(db, 'colheitas'),          where('uid', '==', uid))),
      getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', uid), where('tipoMov', '==', 'saida'),   where('cancelado', '==', false))),
      getDocs(query(collection(db, 'movimentacoesInsumos'), where('uid', '==', uid), where('tipoMov', '==', 'entrada'), where('cancelado', '==', false))),
      getDocs(query(collection(db, 'financeiro'),         where('uid', '==', uid), where('tipo', '==', 'despesa'), where('cancelado', '==', false))),
      getDocs(query(collection(db, 'patrimonios'),        where('uid', '==', uid))),
    ])

  const safras     = safrasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const lavouras   = lavouraSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const colheitas  = colheitasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const saidas     = saidasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const entradas   = entradasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const despesas   = despesasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const patrimonios = patrimoniosSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Mapa de custo unitário por entradaId (id do documento de entrada)
  // Usado como fallback quando a saída não tem custoCalculado
  const custoUnitPorEntrada = {}
  entradas.forEach(e => {
    const qtd = Number(e.quantidade) || 0
    const val = Number(e.valorTotal) || 0
    if (qtd > 0 && val > 0) custoUnitPorEntrada[e.id] = val / qtd
  })

  // Área por propriedade (para rateio por área)
  const areasPorPropriedade = {}
  lavouras.forEach(l => {
    if (l.propriedadeId) {
      areasPorPropriedade[l.propriedadeId] = (areasPorPropriedade[l.propriedadeId] || 0) + (Number(l.areaHa) || 0)
    }
  })

  for (const safra of safras) {
    try {
      const resultado = calcularCustoPorSafra(
        safra, lavouras, colheitas, saidas, custoUnitPorEntrada,
        despesas, safras, patrimonios, areasPorPropriedade
      )
      await updateDoc(doc(db, 'safras', safra.id), {
        custoEstimado: { ...resultado, calculadoEm: new Date().toISOString() }
      })
    } catch (err) {
      console.warn(`[custo] Erro safra ${safra.id}:`, err.message)
    }
  }
}

// ─────────────────────────────────────────────
// Calcula custo para uma safra
// ─────────────────────────────────────────────
function calcularCustoPorSafra(
  safra, todasLavouras, todasColheitas,
  todasSaidas, custoUnitPorEntrada,
  todasDespesas, todasSafras, todosPatrimonios, areasPorPropriedade
) {
  const lavourasDaSafra = todasLavouras.filter(l => safra.lavouraIds?.includes(l.id))
  const areaTotalSafra  = lavourasDaSafra.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)
  const colheitasDaSafra = todasColheitas.filter(c => c.safraId === safra.id && !c.cancelado)

  const despesasPorLavoura = {}
  lavourasDaSafra.forEach(l => { despesasPorLavoura[l.id] = 0 })

  const debugLog = { camada1: [], camada2: [], camada3: [], camada4: [], camada5: [] }

  // ── CAMADAS 1 e 2: saídas de insumos com safraId desta safra ──────────────
  const saidasDaSafra = todasSaidas.filter(s =>
    s.safraId === safra.id && s.propriedadeId === safra.propriedadeId
  )

  for (const saida of saidasDaSafra) {
    // Prioridade 1: campo custoCalculado salvo diretamente na saída (novo)
    let custoTotalSaida = 0
    if (typeof saida.custoCalculado === 'number' && saida.custoCalculado > 0) {
      custoTotalSaida = saida.custoCalculado
    }
    // Prioridade 2: reconstruir via lotesConsumidos + custo unitário das entradas
    else if (saida.lotesConsumidos?.length > 0) {
      saida.lotesConsumidos.forEach(lc => {
        const cuUnit = custoUnitPorEntrada[lc.entradaId] || 0
        const qtd    = Number(lc.quantidade) || 0
        custoTotalSaida += cuUnit * qtd
        if (DEBUG_CUSTO && cuUnit === 0) {
          console.warn(`[custo debug] entradaId '${lc.entradaId}' não tem custo unitário. Produto: ${saida.produtoNome}`)
        }
      })
    }
    // Prioridade 3: custo médio do produto (fallback grosseiro)
    else {
      const entradasProduto = Object.entries(custoUnitPorEntrada)
        // Não temos produtoId aqui, mas podemos usar pela quantidade registrada
        // Este fallback é impreciso mas melhor que zero
        .filter(([id]) => id.startsWith(saida.produtoId || '___'))
      if (entradasProduto.length > 0) {
        const cuMedio = entradasProduto.reduce((s, [, v]) => s + v, 0) / entradasProduto.length
        custoTotalSaida = cuMedio * (Number(saida.quantidade) || 0)
      }
    }

    if (custoTotalSaida <= 0) continue

    const lavouraIds = saida.lavouraIds || []
    const areaLavourasSaida = lavouraIds.reduce((s, lid) => {
      const lav = todasLavouras.find(l => l.id === lid)
      return s + (Number(lav?.areaHa) || 0)
    }, 0)

    if (lavouraIds.length > 0) {
      // Camada 1: saída com lavouras → alocar proporcionalmente à área de cada lavoura
      lavouraIds.forEach(lid => {
        if (despesasPorLavoura[lid] === undefined) return // lavoura não é desta safra
        const lav    = todasLavouras.find(l => l.id === lid)
        const fator  = areaLavourasSaida > 0 ? (Number(lav?.areaHa) || 0) / areaLavourasSaida : 1 / lavouraIds.length
        const valor  = custoTotalSaida * fator
        despesasPorLavoura[lid] += valor
        if (DEBUG_CUSTO) debugLog.camada1.push({
          descricao: saida.produtoNome || 'Insumo',
          lavoura: lav?.nome || lid,
          valor,
          fator: `${(fator * 100).toFixed(1)}% da saída`,
          custoFonte: typeof saida.custoCalculado === 'number' ? 'direto' : 'FIFO',
        })
      })
    } else if (areaTotalSafra > 0) {
      // Camada 2: saída sem lavoura → ratear por área entre lavouras da safra
      lavourasDaSafra.forEach(l => {
        const fator = (Number(l.areaHa) || 0) / areaTotalSafra
        const valor = custoTotalSaida * fator
        despesasPorLavoura[l.id] += valor
        if (DEBUG_CUSTO) debugLog.camada2.push({
          descricao: saida.produtoNome || 'Insumo',
          lavoura: l.nome,
          valor,
          fator: `${(fator * 100).toFixed(1)}% área safra`,
        })
      })
    }
  }

  // ── CAMADA 3: despesas do financeiro SEM safraId, no período da safra ─────
  // Campo correto: vencimento
  const dataInicioSafra = safra.dataInicio ? safra.dataInicio : null
  const dataFimSafra    = safra.dataTermino || new Date().toISOString().split('T')[0]

  const despesasSemSafra = todasDespesas.filter(d =>
    !d.safraId &&
    d.propriedadeId === safra.propriedadeId &&
    !d.origemEstoque &&           // excluir compras de insumos
    !d.origemEstoqueProducao &&   // excluir custo de transferência de produção
    d.tipoDespesa !== 'Depreciação' // depreciação calculada na camada 5
  )

  for (const desp of despesasSemSafra) {
    const valor    = Number(desp.valor) || 0
    if (!valor || !dataInicioSafra) continue
    const venc = desp.vencimento
    if (!venc || venc < dataInicioSafra || venc > dataFimSafra) continue

    // Safras ativas na data desta despesa (mesma propriedade)
    const safrasNaData = todasSafras.filter(s => {
      if (!s.dataInicio || s.propriedadeId !== safra.propriedadeId) return false
      const fim = s.dataTermino || new Date().toISOString().split('T')[0]
      return venc >= s.dataInicio && venc <= fim
    })
    if (!safrasNaData.find(s => s.id === safra.id)) continue

    // Área total de todas as lavouras das safras ativas
    const areaTotalGlobal = safrasNaData.reduce((acc, s) => {
      return acc + todasLavouras.filter(l => s.lavouraIds?.includes(l.id))
        .reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
    }, 0)
    if (areaTotalGlobal <= 0) continue

    lavourasDaSafra.forEach(l => {
      const fator = (Number(l.areaHa) || 0) / areaTotalGlobal
      const val   = valor * fator
      despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + val
      if (DEBUG_CUSTO) debugLog.camada3.push({
        descricao: desp.descricao || 'Despesa',
        lavoura: l.nome,
        valor: val,
        fator: `${(fator * 100).toFixed(1)}% área global`,
      })
    })
  }

  // ── CAMADA 4: despesas do financeiro COM safraId desta safra ──────────────
  const despesasComSafra = todasDespesas.filter(d =>
    d.safraId === safra.id &&
    !d.origemEstoque &&
    !d.origemEstoqueProducao &&
    d.tipoDespesa !== 'Depreciação'
  )

  for (const desp of despesasComSafra) {
    const valor = Number(desp.valor) || 0
    if (!valor || areaTotalSafra <= 0) continue
    lavourasDaSafra.forEach(l => {
      const fator = (Number(l.areaHa) || 0) / areaTotalSafra
      const val   = valor * fator
      despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + val
      if (DEBUG_CUSTO) debugLog.camada4.push({
        descricao: desp.descricao || 'Despesa safra',
        lavoura: l.nome,
        valor: val,
        fator: `${(fator * 100).toFixed(1)}% área safra`,
      })
    })
  }

  // ── CAMADA 5: depreciação de patrimônios ──────────────────────────────────
  // Depreciação mensal × meses de sobreposição com a safra × percentual de rateio da propriedade
  const patrimoniosDaProp = todosPatrimonios.filter(p =>
    p.propriedadeIds?.includes(safra.propriedadeId)
  )

  for (const pat of patrimoniosDaProp) {
    const deprecMensal = calcularDepreciacaoMensal(pat)
    if (deprecMensal <= 0 || !dataInicioSafra) continue

    const pct    = calcularPercentualRateio(pat, safra.propriedadeId, areasPorPropriedade)
    if (pct <= 0) continue

    // Período do patrimônio: do ano de aquisição até hoje
    const inicioPat = `${pat.anoAquisicao || 2000}-01-01`
    const fimPat    = new Date().toISOString().split('T')[0]
    const meses     = mesesSobrepostos(dataInicioSafra, dataFimSafra, inicioPat, fimPat)
    if (meses <= 0) continue

    const deprecTotal = deprecMensal * meses * pct
    if (deprecTotal <= 0 || areaTotalSafra <= 0) continue

    lavourasDaSafra.forEach(l => {
      const fator = (Number(l.areaHa) || 0) / areaTotalSafra
      const val   = deprecTotal * fator
      despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + val
      if (DEBUG_CUSTO) debugLog.camada5.push({
        descricao: `Deprec. ${pat.nome}`,
        lavoura: l.nome,
        valor: val,
        fator: `${meses}m × ${(pct * 100).toFixed(1)}% rateio × ${(fator * 100).toFixed(1)}% área`,
      })
    })
  }

  // ── Montar resultado ───────────────────────────────────────────────────────
  const porLavoura  = {}
  let totalDespesas = 0
  let totalColhido  = 0
  const unidade     = safra.unidade || 'sc'

  lavourasDaSafra.forEach(l => {
    const desp    = despesasPorLavoura[l.id] || 0
    const colhido = colheitasDaSafra
      .filter(c => c.lavouraId === l.id)
      .reduce((s, c) => s + (Number(c.quantidade) || 0), 0)

    totalDespesas += desp
    totalColhido  += colhido

    if (colhido > 0) {
      porLavoura[l.id] = { custoSc: desp / colhido, despesaTotal: desp, quantidadeColhida: colhido, lavouraNome: l.nome }
    } else if (desp > 0) {
      porLavoura[l.id] = { custoSc: null, despesaTotal: desp, quantidadeColhida: 0, lavouraNome: l.nome, emAndamento: true }
    }
  })

  // Safra sem lavouras: usar colheitas sem lavoura específica
  if (lavourasDaSafra.length === 0) {
    totalColhido += colheitasDaSafra.reduce((s, c) => s + (Number(c.quantidade) || 0), 0)
  }

  const totalCustoSc       = totalColhido > 0 ? totalDespesas / totalColhido : null
  const cobertasCount      = Object.values(porLavoura).filter(v => v.quantidadeColhida > 0).length
  const coberturaPercent   = lavourasDaSafra.length > 0
    ? Math.round((cobertasCount / lavourasDaSafra.length) * 100)
    : (totalColhido > 0 ? 100 : 0)

  return {
    porLavoura,
    total: totalCustoSc,
    totalDespesas,
    totalColhido,
    unidade,
    coberturaPercent,
    emAndamento: safra.status !== 'Colhida',
    numSaidasInsumos: saidasDaSafra.length,
    numPatrimonios: patrimoniosDaProp.length,
    debugLog: DEBUG_CUSTO ? debugLog : undefined,
  }
}

// ─────────────────────────────────────────────
// Hook de background (dispara 3s após login)
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
  const { total, emAndamento, coberturaPercent } = custoEstimado
  if (total == null) return { texto: null, incompleto: true }
  const textoValor = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/${unidade}`
  return {
    texto: textoValor,
    incompleto: emAndamento || (coberturaPercent ?? 100) < 100,
    cobertura: coberturaPercent ?? 100,
    emAndamento: !!emAndamento,
  }
}

export function getCustoLote(safra, lavouraId) {
  if (!safra?.custoEstimado) return null
  const { porLavoura, total, unidade, emAndamento } = safra.custoEstimado
  if (lavouraId && porLavoura?.[lavouraId]?.custoSc != null) {
    return { valor: porLavoura[lavouraId].custoSc, unidade: unidade || 'sc', incompleto: emAndamento || !!porLavoura[lavouraId].emAndamento, fonte: 'lavoura' }
  }
  if (total != null) {
    return { valor: total, unidade: unidade || 'sc', incompleto: true, fonte: 'safra' }
  }
  return null
}