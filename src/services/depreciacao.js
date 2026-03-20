import { collection, query, where, getDocs, addDoc } from 'firebase/firestore'
import { db } from './firebase'

const ANO_ATUAL = new Date().getFullYear()
const MES_ATUAL = new Date().getMonth() + 1

// Calcula percentual de rateio de um patrimônio para uma propriedade específica
export function calcularPercentualRateio(patrimonio, propriedadeId, areasPropriedades = {}) {
  const ids = patrimonio.propriedadeIds || []
  if (ids.length === 0) return 1
  if (ids.length === 1) return 1

  const tipoRateio = patrimonio.tipoRateio || 'igualitario'

  if (tipoRateio === 'igualitario') {
    return 1 / ids.length
  }

  if (tipoRateio === 'area') {
    const areas = ids.map(id => areasPropriedades[id] || 0)
    const totalArea = areas.reduce((a, b) => a + b, 0)
    if (totalArea === 0) return 1 / ids.length
    const idx = ids.indexOf(propriedadeId)
    return idx >= 0 ? (areasPropriedades[propriedadeId] || 0) / totalArea : 0
  }

  if (tipoRateio === 'personalizado') {
    const percentuais = patrimonio.percentuaisRateio || {}
    return (percentuais[propriedadeId] || 0) / 100
  }

  return 1 / ids.length
}

// Calcula depreciação mensal de um patrimônio (valor total, sem rateio)
export function calcularDepreciacaoMensal(p) {
  const anoAtual = ANO_ATUAL
  const aquisicao = Number(p.anoAquisicao) || anoAtual
  const vidaUtil = Number(p.vidaUtil) || 0
  const valorAquisicao = Number(p.valorAquisicao) || 0
  const valorResidual = Number(p.valorResidual) || 0
  if (vidaUtil <= 0) return 0
  if (anoAtual > aquisicao + vidaUtil) return 0
  return (valorAquisicao - valorResidual) / vidaUtil / 12
}

// Calcula valor atual estimado com depreciação até o mês/ano de referência
export function calcularValorAtual(p, anoRef = ANO_ATUAL, mesRef = MES_ATUAL) {
  const aquisicao = Number(p.anoAquisicao) || anoRef
  const vidaUtil = Number(p.vidaUtil) || 0
  const valorAquisicao = Number(p.valorAquisicao) || 0
  const valorResidual = Number(p.valorResidual) || 0
  if (vidaUtil <= 0) return valorAquisicao
  const mesesTotal = vidaUtil * 12
  const mesesDecorridos = Math.min(
    Math.max(0, (anoRef - aquisicao) * 12 + mesRef),
    mesesTotal
  )
  const depreciacaoMensal = (valorAquisicao - valorResidual) / mesesTotal
  return Math.max(valorResidual, valorAquisicao - depreciacaoMensal * mesesDecorridos)
}

// Função principal de catch-up — roda ao fazer login
export async function executarCatchUpDepreciacao(uid) {
  try {
    // Busca patrimônios, propriedades e lavouras em paralelo
    const [patSnap, propSnap, lavSnap] = await Promise.all([
      getDocs(query(collection(db, 'patrimonios'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'propriedades'), where('uid', '==', uid))),
      getDocs(query(collection(db, 'lavouras'), where('uid', '==', uid))),
    ])

    const patrimonios = patSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (patrimonios.length === 0) return

    // Calcula área total por propriedade (soma das lavouras)
    const areasPropriedades = {}
    lavSnap.docs.forEach(d => {
      const l = d.data()
      if (l.propriedadeId) {
        areasPropriedades[l.propriedadeId] = (areasPropriedades[l.propriedadeId] || 0) + (Number(l.areaHa) || 0)
      }
    })

    // Mapa de nomes das propriedades
    const nomesPropriedades = {}
    propSnap.docs.forEach(d => { nomesPropriedades[d.id] = d.data().nome })

    // Busca lançamentos de depreciação já gerados
    const finSnap = await getDocs(
      query(
        collection(db, 'financeiro'),
        where('uid', '==', uid),
        where('geradoAutomaticamente', '==', true)
      )
    )

    // Set de chaves já geradas: mesReferencia|categoria|propriedadeId
    const jaGerados = new Set(
      finSnap.docs.map(d => {
        const data = d.data()
        return `${data.mesReferencia}|${data.descricao}|${data.propriedadeId}`
      })
    )

    // Agrupa por propriedade + categoria para somar depreciações
    // Estrutura: { "propId|categoria": { deprecMensal, anoInicio, fimVidaUtil, propNome } }
    const grupos = {}

    patrimonios.forEach(p => {
      const deprecMensalTotal = calcularDepreciacaoMensal(p)
      if (deprecMensalTotal <= 0) return

      const aquisicao = Number(p.anoAquisicao) || ANO_ATUAL
      const vidaUtil = Number(p.vidaUtil) || 0
      const fimVidaUtil = aquisicao + vidaUtil

      const ids = p.propriedadeIds?.length > 0
        ? p.propriedadeIds
        : p.propriedadeId ? [p.propriedadeId] : ['']

      ids.forEach(propId => {
        const percentual = calcularPercentualRateio(p, propId, areasPropriedades)
        const deprecRateada = deprecMensalTotal * percentual
        if (deprecRateada <= 0) return

        const chave = `${propId}|${p.categoria}`
        if (!grupos[chave]) {
          grupos[chave] = {
            propId,
            propNome: nomesPropriedades[propId] || '',
            categoria: p.categoria,
            deprecMensal: 0,
            anoInicio: aquisicao,
            fimVidaUtil,
          }
        }
        grupos[chave].deprecMensal += deprecRateada
        grupos[chave].anoInicio = Math.min(grupos[chave].anoInicio, aquisicao)
        grupos[chave].fimVidaUtil = Math.max(grupos[chave].fimVidaUtil, fimVidaUtil)
      })
    })

    const promessas = []

    Object.values(grupos).forEach(grupo => {
      // Encontra o último mês já gerado para este grupo
      let ultimoAno = grupo.anoInicio - 1
      let ultimoMes = 12

      finSnap.docs.forEach(d => {
        const data = d.data()
        if (
          data.geradoAutomaticamente &&
          data.descricao === `Depreciação - ${grupo.categoria}` &&
          data.propriedadeId === grupo.propId
        ) {
          const [a, m] = (data.mesReferencia || '').split('-').map(Number)
          if (a > ultimoAno || (a === ultimoAno && m > ultimoMes)) {
            ultimoAno = a
            ultimoMes = m
          }
        }
      })

      // Começa do mês seguinte ao último gerado
      let anoVerif = ultimoAno
      let mesVerif = ultimoMes + 1
      if (mesVerif > 12) { mesVerif = 1; anoVerif++ }

      // Gera até o mês atual
      while (
        anoVerif < ANO_ATUAL ||
        (anoVerif === ANO_ATUAL && mesVerif <= MES_ATUAL)
      ) {
        if (anoVerif > grupo.fimVidaUtil) break

        const mesRef = `${anoVerif}-${String(mesVerif).padStart(2, '0')}`
        const descricao = `Depreciação - ${grupo.categoria}`
        const chaveUnica = `${mesRef}|${descricao}|${grupo.propId}`

        if (!jaGerados.has(chaveUnica)) {
          const vencimento = `${anoVerif}-${String(mesVerif).padStart(2, '0')}-01`
          promessas.push(
            addDoc(collection(db, 'financeiro'), {
              descricao,
              tipo: 'despesa',
              categoria: 'Administrativo',
              tipoDespesa: 'Depreciação',
              vencimento,
              valor: Number(grupo.deprecMensal.toFixed(2)),
              notaRef: '',
              propriedadeId: grupo.propId,
              propriedadeNome: grupo.propNome,
              safraId: '',
              safraNome: '',
              status: 'pago',
              geradoAutomaticamente: true,
              mesReferencia: mesRef,
              uid,
              criadoEm: new Date(),
            })
          )
          jaGerados.add(chaveUnica)
        }

        mesVerif++
        if (mesVerif > 12) { mesVerif = 1; anoVerif++ }
      }
    })

    await Promise.all(promessas)
    if (promessas.length > 0) {
      console.log(`Depreciação: ${promessas.length} lançamento(s) gerado(s).`)
    }
  } catch (err) {
    console.error('Erro ao gerar depreciação:', err)
  }
}