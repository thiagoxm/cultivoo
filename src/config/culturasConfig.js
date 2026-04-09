// src/config/culturasConfig.js
// Configuração central de culturas e insumos do Cultivoo

// ─────────────────────────────────────────────
// GRUPOS DE QUALIDADE
// ─────────────────────────────────────────────
export const GRUPOS_QUALIDADE = {
  graos: {
    label: 'Grãos',
    campos: [
      { key: 'umidade',   label: 'Umidade',        unidade: '%',   tipo: 'number', min: 0, max: 40  },
      { key: 'impureza',  label: 'Impureza',        unidade: '%',   tipo: 'number', min: 0, max: 20  },
      { key: 'avariados', label: 'Grãos Avariados', unidade: '%',   tipo: 'number', min: 0, max: 100 },
      { key: 'quebrados', label: 'Grãos Quebrados', unidade: '%',   tipo: 'number', min: 0, max: 100 },
    ],
  },
  cafe: {
    label: 'Café',
    campos: [
      { key: 'tipo',    label: 'Tipo',              unidade: '', tipo: 'select',
        opcoes: ['2', '3', '4', '5', '6', '7', '8'] },
      { key: 'peneira', label: 'Peneira',            unidade: '', tipo: 'select',
        opcoes: ['13', '14', '15', '16', '17', '18', '19', '20'] },
      { key: 'bebida',  label: 'Bebida',             unidade: '', tipo: 'select',
        opcoes: ['Estritamente Mole', 'Mole', 'Apenas Mole', 'Dura', 'Riada', 'Rio', 'Rio Zona'] },
      { key: 'verdes',  label: 'Grãos Verdes/Pretos', unidade: '%', tipo: 'number', min: 0, max: 100 },
    ],
  },
  cana: {
    label: 'Cana-de-açúcar',
    campos: [
      { key: 'atr',    label: 'ATR (Açúcar Total Recuperável)', unidade: 'kg/t', tipo: 'number', min: 0, max: 200 },
      { key: 'pol',    label: 'Pol',                            unidade: '%',    tipo: 'number', min: 0, max: 25  },
      { key: 'fibra',  label: 'Fibra',                          unidade: '%',    tipo: 'number', min: 0, max: 20  },
      { key: 'pureza', label: 'Pureza',                         unidade: '%',    tipo: 'number', min: 0, max: 100 },
    ],
  },
  algodao: {
    label: 'Algodão',
    campos: [
      { key: 'pluma',       label: 'Rendimento em Pluma', unidade: '%',     tipo: 'number', min: 0, max: 50  },
      { key: 'comprimento', label: 'Comprimento da Fibra', unidade: 'mm',   tipo: 'number', min: 0, max: 40  },
      { key: 'resistencia', label: 'Resistência',          unidade: 'g/tex',tipo: 'number', min: 0, max: 50  },
      { key: 'cor',         label: 'Grau de Cor',          unidade: '',     tipo: 'select',
        opcoes: ['Branca', 'Creme', 'Amarelada', 'Marrom'] },
    ],
  },
  outros: {
    label: 'Outros',
    campos: [],
  },
}

// ─────────────────────────────────────────────
// CULTURAS
// ─────────────────────────────────────────────
export const CULTURAS = [
  { nome: 'Soja',           icone: '🌱', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Milho',          icone: '🌽', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Arroz',          icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 50   },
  { nome: 'Feijão',         icone: '🫘', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Trigo',          icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Sorgo',          icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Girassol',       icone: '🌻', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 27   },
  { nome: 'Café',           icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Café Arábica',   icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Café Conilon',   icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Cana-de-açúcar', icone: '🎋', grupo: 'cana',   unidadePadrao: 't',  pesoSc: null },
  { nome: 'Algodão',        icone: '🌿', grupo: 'algodao', unidadePadrao: '@',  pesoSc: null },
  { nome: 'Mandioca',       icone: '🌿', grupo: 'outros',  unidadePadrao: 't',  pesoSc: null },
  { nome: 'Amendoim',       icone: '🥜', grupo: 'outros',  unidadePadrao: 'sc', pesoSc: 25   },
  { nome: 'Café (outro)',   icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60   },
  { nome: 'Outro',          icone: '🌿', grupo: 'outros',  unidadePadrao: 'sc', pesoSc: null },
]

// ─────────────────────────────────────────────
// UNIDADES de produção
// ─────────────────────────────────────────────
export const UNIDADES = [
  { value: 'sc', label: 'Sacas (sc)'       },
  { value: 'kg', label: 'Quilogramas (kg)' },
  { value: 't',  label: 'Toneladas (t)'    },
  { value: '@',  label: 'Arrobas (@)'      },
  { value: 'cx', label: 'Caixas (cx)'      },
  { value: 'l',  label: 'Litros (l)'       },
]

// ─────────────────────────────────────────────
// UNIDADES de insumos
// ─────────────────────────────────────────────
export const UNIDADES_INSUMOS = [
  { value: 'l',  label: 'Litros (L)'       },
  { value: 'ml', label: 'Mililitros (mL)'  },
  { value: 'kg', label: 'Quilogramas (kg)' },
  { value: 'g',  label: 'Gramas (g)'       },
  { value: 't',  label: 'Toneladas (t)'    },
  { value: 'sc', label: 'Sacas (sc)'       },
  { value: 'un', label: 'Unidades (un)'    },
  { value: 'cx', label: 'Caixas (cx)'      },
]

// ─────────────────────────────────────────────
// TIPOS DE INSUMOS
// Cada tipo define:
//   - categoriaFinanceiro / tipoFinanceiro: para lançamento automático na entrada
//   - vinculos: quais campos aparecem na saída e se são obrigatórios
//     * safra: 'obrigatorio' | 'opcional' | 'oculto'
//     * lavoura: 'obrigatorio' | 'opcional' | 'oculto'
//     * patrimonio: 'obrigatorio' | 'opcional' | 'oculto'
//   - tiposSaida: quais tipos de saída estão disponíveis
// ─────────────────────────────────────────────
export const TIPOS_INSUMOS = [
  {
    value: 'sementes',
    label: 'Sementes / Mudas',
    icone: '🌱',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Sementes / Mudas',
    vinculos: {
      safra:      'obrigatorio',
      lavoura:    'obrigatorio',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'venda', 'transferencia'],
  },
  {
    value: 'fertilizante',
    label: 'Fertilizante',
    icone: '🧪',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Adubos',
    vinculos: {
      safra:      'obrigatorio',
      lavoura:    'obrigatorio',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'venda', 'transferencia'],
  },
  {
    value: 'defensivo',
    label: 'Defensivo',
    icone: '🛡️',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Defensivos',
    vinculos: {
      safra:      'obrigatorio',
      lavoura:    'obrigatorio',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'venda', 'transferencia'],
  },
  {
    value: 'inoculante',
    label: 'Inoculante / Bioinsumo',
    icone: '🔬',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Outros',
    vinculos: {
      safra:      'obrigatorio',
      lavoura:    'obrigatorio',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'venda', 'transferencia'],
  },
  {
    value: 'corretivo',
    label: 'Corretivo de Solo',
    icone: '⚗️',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Fertilizantes',
    vinculos: {
      safra:      'obrigatorio',
      lavoura:    'obrigatorio',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'venda', 'transferencia'],
  },
  {
    value: 'combustivel',
    label: 'Combustível',
    icone: '⛽',
    categoriaFinanceiro: 'Máquinas e Equipamentos',
    // Corrigido: era 'Combustível', agora unificado com lubrificante
    tipoFinanceiro: 'Combustível e Lubrificantes',
    vinculos: {
      safra:      'opcional',
      lavoura:    'oculto',
      patrimonio: 'obrigatorio',
    },
    tiposSaida: ['consumo', 'transferencia'],
  },
  {
    value: 'lubrificante',
    label: 'Lubrificante',
    icone: '🔧',
    categoriaFinanceiro: 'Máquinas e Equipamentos',
    // Corrigido: era 'Manutenção', agora unificado com combustível
    tipoFinanceiro: 'Combustível e Lubrificantes',
    vinculos: {
      safra:      'opcional',
      lavoura:    'oculto',
      patrimonio: 'obrigatorio',
    },
    tiposSaida: ['consumo', 'transferencia'],
  },
  {
    value: 'outros',
    label: 'Outros',
    icone: '📦',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Outros',
    vinculos: {
      safra:      'opcional',
      lavoura:    'opcional',
      patrimonio: 'oculto',
    },
    tiposSaida: ['aplicacao', 'consumo', 'venda', 'transferencia'],
  },
]

// ─────────────────────────────────────────────
// TIPOS DE SAÍDA DE INSUMOS
// ─────────────────────────────────────────────
export const TIPOS_SAIDA_INSUMO = [
  {
    value: 'aplicacao',
    label: 'Aplicação',
    icone: '🌿',
    geraFinanceiro: false,
  },
  {
    value: 'consumo',
    label: 'Consumo',
    icone: '⚙️',
    geraFinanceiro: false,
  },
  {
    value: 'venda',
    label: 'Venda de excedente',
    icone: '💰',
    geraFinanceiro: true,
    tipoFinanceiro: 'receita',
  },
  {
    value: 'transferencia',
    label: 'Transferência entre propriedades',
    icone: '🔄',
    geraFinanceiro: false,
    geraEntradaDestino: true,
  },
]

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

export function getCultura(nome) {
  return CULTURAS.find(c => c.nome === nome) || null
}

export function getCamposQualidade(nomeCultura) {
  const cultura = getCultura(nomeCultura)
  if (!cultura) return []
  return GRUPOS_QUALIDADE[cultura.grupo]?.campos || []
}

export function getUnidadePadrao(nomeCultura) {
  const cultura = getCultura(nomeCultura)
  return cultura?.unidadePadrao || 'sc'
}

export function getLabelUnidade(value) {
  return UNIDADES.find(u => u.value === value)?.label || value
}

export function getLabelUnidadeInsumo(value) {
  return UNIDADES_INSUMOS.find(u => u.value === value)?.label || value
}

export function getTipoInsumo(value) {
  return TIPOS_INSUMOS.find(t => t.value === value) || null
}

export function getVinculosInsumo(tipoValue) {
  return getTipoInsumo(tipoValue)?.vinculos || {
    safra: 'opcional',
    lavoura: 'opcional',
    patrimonio: 'oculto',
  }
}

export function getTiposSaidaDisponiveis(tipoValue) {
  const tipo = getTipoInsumo(tipoValue)
  if (!tipo) return TIPOS_SAIDA_INSUMO
  return TIPOS_SAIDA_INSUMO.filter(ts => tipo.tiposSaida.includes(ts.value))
}

export function getTipoSaida(value) {
  return TIPOS_SAIDA_INSUMO.find(ts => ts.value === value) || null
}