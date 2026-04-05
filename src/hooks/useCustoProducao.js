// src/hooks/useCustoProducao.js
// Calcula custo médio de produção por safra/lavoura usando 3 camadas de rateio.
// Acionado no login do usuário e executa em background.
// Armazena resultado em: safras/{id}.custoEstimado = { porLavoura: {[lavouraId]: R$/sc}, total: R$/sc, calculadoEm }

import { useEffect, useRef } from 'react'
import {
  collection, query, where, getDocs, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../services/firebase'

// ─────────────────────────────────────────────
// Função principal de cálculo (não é hook — pode ser chamada diretamente)
// ─────────────────────────────────────────────
export async function calcularCustoProducao(uid) {
  if (!uid) return

  // 1. Buscar todos os dados necessários em paralelo
  const [safrasSnap, lavouraSnap, colheitasSnap, despesasSnap] = await Promise.all([
    getDocs(query(collection(db, 'safras'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'colheitas'), where('uid', '==', uid))),
    getDocs(query(
      collection(db, 'financeiro'),
      where('uid', '==', uid),
      where('tipo', '==', 'despesa'),
      where('cancelado', '==', false)
    )),
  ])

  const safras = safrasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const lavouras = lavouraSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const colheitas = colheitasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const despesas = despesasSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Mapa de lavoura por id para acesso rápido
  const lavouraMap = {}
  lavouras.forEach(l => { lavouraMap[l.id] = l })

  // Para cada safra, calcular o custo por lavoura
  for (const safra of safras) {
    try {
      const resultado = calcularCustoPorSafra(safra, lavouras, colheitas, despesas, safras)
      if (resultado) {
        await updateDoc(doc(db, 'safras', safra.id), {
          custoEstimado: {
            ...resultado,
            calculadoEm: new Date().toISOString(),
          }
        })
      }
    } catch (e) {
      console.warn(`Erro ao calcular custo safra ${safra.id}:`, e.message)
    }
  }
}

// ─────────────────────────────────────────────
// Calcula custo para uma safra específica
// Retorna { porLavoura: {[lavouraId]: custoSc}, total: custoSc, unidade, coberturaPercent }
// ─────────────────────────────────────────────
function calcularCustoPorSafra(safra, todasLavouras, todasColheitas, todasDespesas, todasSafras) {
  const lavourasDaSafra = todasLavouras.filter(l => safra.lavouraIds?.includes(l.id))
  const areaTotalSafra = lavourasDaSafra.reduce((s, l) => s + (Number(l.areaHa) || 0), 0)
  const colheitasDaSafra = todasColheitas.filter(c => c.safraId === safra.id && !c.cancelado)

  // Acumula despesas por lavoura (em R$)
  const despesasPorLavoura = {}  // { [lavouraId]: valor }
  lavourasDaSafra.forEach(l => { despesasPorLavoura[l.id] = 0 })

  // Data início/fim da safra para camada 3
  const dataInicio = safra.dataInicio ? new Date(safra.dataInicio) : null
  const dataFim = safra.dataTermino ? new Date(safra.dataTermino) : new Date()

  for (const desp of todasDespesas) {
    const valor = Number(desp.valor) || 0
    if (!valor || desp.propriedadeId !== safra.propriedadeId) continue

    // ── Camada 1: vínculo direto com safra + lavoura ─────────────────────
    if (desp.safraId === safra.id && desp.lavouraId && despesasPorLavoura[desp.lavouraId] !== undefined) {
      despesasPorLavoura[desp.lavouraId] += valor
      continue
    }

    // ── Camada 2: vínculo com safra, sem lavoura → rateio por área ────────
    if (desp.safraId === safra.id && !desp.lavouraId && areaTotalSafra > 0) {
      lavourasDaSafra.forEach(l => {
        const fator = (Number(l.areaHa) || 0) / areaTotalSafra
        despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + valor * fator
      })
      continue
    }

    // ── Camada 3: sem vínculo com safra → rateio por período ─────────────
    if (!desp.safraId && desp.data) {
      const dataDesp = new Date(desp.data)
      // Verificar se a data da despesa está dentro do período desta safra
      if (!dataInicio || dataDesp < dataInicio || dataDesp > dataFim) continue

      // Encontrar TODAS as safras ativas nessa data (para dividir proporcionalmente)
      const safrasNaData = todasSafras.filter(s => {
        if (!s.dataInicio) return false
        const ini = new Date(s.dataInicio)
        const fim = s.dataTermino ? new Date(s.dataTermino) : new Date()
        return dataDesp >= ini && dataDesp <= fim && s.propriedadeId === safra.propriedadeId
      })

      if (safrasNaData.length === 0) continue

      // Área total de TODAS as lavouras das safras ativas nessa data
      const areaTotalGlobal = safrasNaData.reduce((acc, s) => {
        const lavs = todasLavouras.filter(l => s.lavouraIds?.includes(l.id))
        return acc + lavs.reduce((a, l) => a + (Number(l.areaHa) || 0), 0)
      }, 0)

      if (areaTotalGlobal <= 0) continue

      // Nossa safra está entre as ativas?
      const nossaSafraAtiva = safrasNaData.find(s => s.id === safra.id)
      if (!nossaSafraAtiva) continue

      // Calcular o percentual que cabe a cada lavoura desta safra
      lavourasDaSafra.forEach(l => {
        const fatorGlobal = (Number(l.areaHa) || 0) / areaTotalGlobal
        despesasPorLavoura[l.id] = (despesasPorLavoura[l.id] || 0) + valor * fatorGlobal
      })
    }
  }

  // Calcular custo por saca (ou unidade) para cada lavoura
  const porLavoura = {}
  let totalDespesas = 0
  let totalColhido = 0
  const unidade = safra.unidade || 'sc'

  lavourasDaSafra.forEach(l => {
    const desp = despesasPorLavoura[l.id] || 0
    const colheidasLavoura = colheitasDaSafra
      .filter(c => c.lavouraId === l.id)
      .reduce((s, c) => s + (Number(c.quantidade) || 0), 0)

    totalDespesas += desp
    totalColhido += colheidasLavoura

    if (colheidasLavoura > 0) {
      porLavoura[l.id] = {
        custoSc: desp / colheidasLavoura,
        despesaTotal: desp,
        quantidadeColhida: colheidasLavoura,
        lavouraNome: l.nome,
      }
    } else if (desp > 0) {
      // Lavoura tem despesas mas ainda não foi colhida — custo indeterminado
      porLavoura[l.id] = {
        custoSc: null,
        despesaTotal: desp,
        quantidadeColhida: 0,
        lavouraNome: l.nome,
        emAndamento: true,
      }
    }
  })

  // Custo médio geral da safra
  const totalCustoSc = totalColhido > 0 ? totalDespesas / totalColhido : null

  // Percentual de lavouras com colheita registrada (para indicar completude)
  const lavourasCobertasCount = Object.values(porLavoura).filter(v => v.quantidadeColhida > 0).length
  const coberturaPercent = lavourasDaSafra.length > 0
    ? Math.round((lavourasCobertasCount / lavourasDaSafra.length) * 100)
    : 0

  return {
    porLavoura,
    total: totalCustoSc,
    totalDespesas,
    totalColhido,
    unidade,
    coberturaPercent,
    emAndamento: safra.status !== 'Colhida',
  }
}

// ─────────────────────────────────────────────
// Hook: executa no login, em background
// Chame em App.jsx ou no componente raiz autenticado
// ─────────────────────────────────────────────
export function useCustoProducaoBackground(uid) {
  const calculadoRef = useRef(false)

  useEffect(() => {
    if (!uid || calculadoRef.current) return
    calculadoRef.current = true

    // Executa em background sem bloquear a UI
    setTimeout(() => {
      calcularCustoProducao(uid).catch(e =>
        console.warn('Cálculo de custo em background falhou:', e.message)
      )
    }, 3000) // aguarda 3s para garantir que os dados já carregaram

  }, [uid])
}

// ─────────────────────────────────────────────
// Helper para formatar custo médio com estado de completude
// ─────────────────────────────────────────────
export function formatarCustoEstimado(custoEstimado, unidade = 'sc') {
  if (!custoEstimado) return { texto: null, incompleto: false }

  const valor = custoEstimado.total
  const emAndamento = custoEstimado.emAndamento
  const cobertura = custoEstimado.coberturaPercent ?? 100

  if (valor == null) return { texto: null, incompleto: true }

  const textoValor = `R$ ${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}/${unidade}`

  return {
    texto: textoValor,
    incompleto: emAndamento || cobertura < 100,
    cobertura,
    emAndamento,
  }
}

// ─────────────────────────────────────────────
// Helper para obter custo de um lote específico (por lavouraId)
// ─────────────────────────────────────────────
export function getCustoLote(safra, lavouraId) {
  if (!safra?.custoEstimado) return null
  const { porLavoura, total, unidade, emAndamento } = safra.custoEstimado

  // Prioridade 1: custo específico da lavoura
  if (lavouraId && porLavoura?.[lavouraId]?.custoSc != null) {
    return {
      valor: porLavoura[lavouraId].custoSc,
      unidade: unidade || 'sc',
      incompleto: emAndamento || porLavoura[lavouraId].emAndamento,
      fonte: 'lavoura',
    }
  }

  // Prioridade 2: custo médio da safra
  if (total != null) {
    return {
      valor: total,
      unidade: unidade || 'sc',
      incompleto: true, // custo geral é sempre estimado
      fonte: 'safra',
    }
  }

  return null
}