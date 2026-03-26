// src/config/culturasConfig.js
// Configuração central de culturas do Cultivoo
// Para adicionar uma nova cultura: inclua no array CULTURAS com seu grupo correspondente
// Para adicionar um novo grupo: inclua em GRUPOS_QUALIDADE com seus campos

// ─────────────────────────────────────────────
// GRUPOS DE QUALIDADE
// Define quais campos de qualidade aparecem por grupo
// ─────────────────────────────────────────────
export const GRUPOS_QUALIDADE = {
  graos: {
    label: 'Grãos',
    campos: [
      { key: 'umidade',   label: 'Umidade',          unidade: '%',   tipo: 'number', min: 0, max: 40  },
      { key: 'impureza',  label: 'Impureza',          unidade: '%',   tipo: 'number', min: 0, max: 20  },
      { key: 'avariados', label: 'Grãos Avariados',   unidade: '%',   tipo: 'number', min: 0, max: 100 },
      { key: 'quebrados', label: 'Grãos Quebrados',   unidade: '%',   tipo: 'number', min: 0, max: 100 },
    ],
  },

  cafe: {
    label: 'Café',
    campos: [
      { key: 'tipo',      label: 'Tipo',  unidade: '',    tipo: 'select',
        opcoes: ['2', '3', '4', '5', '6', '7', '8'] },
      { key: 'peneira',   label: 'Peneira',               unidade: '',    tipo: 'select',
        opcoes: ['13', '14', '15', '16', '17', '18', '19', '20'] },
      { key: 'bebida',    label: 'Bebida',                unidade: '',    tipo: 'select',
        opcoes: ['Estritamente Mole', 'Mole', 'Apenas Mole', 'Dura', 'Riada', 'Rio', 'Rio Zona'] },
      { key: 'verdes',    label: 'Grãos Verdes/Pretos',   unidade: '%',   tipo: 'number', min: 0, max: 100 },
    ],
  },

  cana: {
    label: 'Cana-de-açúcar',
    campos: [
      { key: 'atr',     label: 'ATR (Açúcar Total Recuperável)', unidade: 'kg/t', tipo: 'number', min: 0, max: 200 },
      { key: 'pol',     label: 'Pol',                            unidade: '%',    tipo: 'number', min: 0, max: 25  },
      { key: 'fibra',   label: 'Fibra',                          unidade: '%',    tipo: 'number', min: 0, max: 20  },
      { key: 'pureza',  label: 'Pureza',                         unidade: '%',    tipo: 'number', min: 0, max: 100 },
    ],
  },

  algodao: {
    label: 'Algodão',
    campos: [
      { key: 'pluma',        label: 'Rendimento em Pluma', unidade: '%',  tipo: 'number', min: 0, max: 50  },
      { key: 'comprimento',  label: 'Comprimento da Fibra',unidade: 'mm', tipo: 'number', min: 0, max: 40  },
      { key: 'resistencia',  label: 'Resistência',         unidade: 'g/tex', tipo: 'number', min: 0, max: 50 },
      { key: 'cor',          label: 'Grau de Cor',         unidade: '',   tipo: 'select',
        opcoes: ['Branca', 'Creme', 'Amarelada', 'Marrom'] },
    ],
  },

  outros: {
    label: 'Outros',
    campos: [
      // Sem campos específicos — usa apenas o campo livre de observações
    ],
  },
};

// ─────────────────────────────────────────────
// CULTURAS
// Cada cultura tem: nome, ícone, grupo, unidade padrão, peso por saca (se aplicável)
// ─────────────────────────────────────────────
export const CULTURAS = [
  // ── Grãos ──
  { nome: 'Soja',          icone: '🌱', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Milho',         icone: '🌽', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Arroz',         icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 50  },
  { nome: 'Feijão',        icone: '🫘', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Trigo',         icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Sorgo',         icone: '🌾', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Girassol',      icone: '🌻', grupo: 'graos',   unidadePadrao: 'sc', pesoSc: 27  },

  // ── Café ──
  { nome: 'Café',          icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Café Arábica',  icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Café Conilon',  icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60  },

  // ── Cana ──
  { nome: 'Cana-de-açúcar',icone: '🎋', grupo: 'cana',   unidadePadrao: 't',  pesoSc: null },

  // ── Algodão ──
  { nome: 'Algodão',       icone: '🌿', grupo: 'algodao', unidadePadrao: '@',  pesoSc: null },

  // ── Outros ──
  { nome: 'Mandioca',      icone: '🌿', grupo: 'outros',  unidadePadrao: 't',  pesoSc: null },
  { nome: 'Amendoim',      icone: '🥜', grupo: 'outros',  unidadePadrao: 'sc', pesoSc: 25  },
  { nome: 'Café (outro)',  icone: '☕', grupo: 'cafe',    unidadePadrao: 'sc', pesoSc: 60  },
  { nome: 'Outro',         icone: '🌿', grupo: 'outros',  unidadePadrao: 'sc', pesoSc: null },
];

// ─────────────────────────────────────────────
// UNIDADES de produção — para colheitas e safras
// ─────────────────────────────────────────────
export const UNIDADES = [
  { value: 'sc',  label: 'Sacas (sc)'       },
  { value: 'kg',  label: 'Quilogramas (kg)' },
  { value: 't',   label: 'Toneladas (t)'    },
  { value: '@',   label: 'Arrobas (@)'      },
  { value: 'cx',  label: 'Caixas (cx)'      },
  { value: 'l',   label: 'Litros (l)'       },
];

// ─────────────────────────────────────────────
// UNIDADES de insumos — lista específica para
// defensivos, fertilizantes, sementes, combustíveis
// ─────────────────────────────────────────────
export const UNIDADES_INSUMOS = [
  { value: 'l',   label: 'Litros (L)'          },
  { value: 'ml',  label: 'Mililitros (mL)'      },
  { value: 'kg',  label: 'Quilogramas (kg)'     },
  { value: 'g',   label: 'Gramas (g)'           },
  { value: 't',   label: 'Toneladas (t)'        },
  { value: 'sc',  label: 'Sacas (sc)'           },
  { value: 'un',  label: 'Unidades (un)'        },
  { value: 'cx',  label: 'Caixas (cx)'          },
]

// ─────────────────────────────────────────────
// TIPOS de insumos
// Cada tipo tem: valor (key), label, ícone e
// categoria correspondente no Financeiro
// ─────────────────────────────────────────────
export const TIPOS_INSUMOS = [
  {
    value: 'sementes',
    label: 'Sementes / Mudas',
    icone: '🌱',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Sementes / Mudas',
  },
  {
    value: 'fertilizante',
    label: 'Fertilizante',
    icone: '🧪',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Adubos',
  },
  {
    value: 'defensivo',
    label: 'Defensivo',
    icone: '🛡️',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Defensivos',
  },
  {
    value: 'inoculante',
    label: 'Inoculante / Bioinsumo',
    icone: '🔬',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Outros',
  },
  {
    value: 'corretivo',
    label: 'Corretivo de Solo',
    icone: '⚗️',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Fertilizantes',
  },
  {
    value: 'combustivel',
    label: 'Combustível',
    icone: '⛽',
    categoriaFinanceiro: 'Máquinas e Equipamentos',
    tipoFinanceiro: 'Combustível',
  },
  {
    value: 'lubrificante',
    label: 'Lubrificante',
    icone: '🔧',
    categoriaFinanceiro: 'Máquinas e Equipamentos',
    tipoFinanceiro: 'Manutenção',
  },
  {
    value: 'outros',
    label: 'Outros',
    icone: '📦',
    categoriaFinanceiro: 'Insumos',
    tipoFinanceiro: 'Outros',
  },
]

// ─────────────────────────────────────────────
// HELPERS — funções utilitárias
// ─────────────────────────────────────────────

/** Retorna o objeto de uma cultura pelo nome */
export function getCultura(nome) {
  return CULTURAS.find(c => c.nome === nome) || null;
}

/** Retorna os campos de qualidade para uma cultura pelo nome */
export function getCamposQualidade(nomeCultura) {
  const cultura = getCultura(nomeCultura);
  if (!cultura) return [];
  return GRUPOS_QUALIDADE[cultura.grupo]?.campos || [];
}

/** Retorna a unidade padrão de uma cultura pelo nome */
export function getUnidadePadrao(nomeCultura) {
  const cultura = getCultura(nomeCultura);
  return cultura?.unidadePadrao || 'sc';
}

/** Retorna o label amigável de uma unidade de produção */
export function getLabelUnidade(value) {
  return UNIDADES.find(u => u.value === value)?.label || value;
}

/** Retorna o label amigável de uma unidade de insumo */
export function getLabelUnidadeInsumo(value) {
  return UNIDADES_INSUMOS.find(u => u.value === value)?.label || value;
}

/** Retorna o objeto de um tipo de insumo pelo value */
export function getTipoInsumo(value) {
  return TIPOS_INSUMOS.find(t => t.value === value) || null;
}