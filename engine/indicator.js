// Modelo genérico de indicador: validación y normalización (funciones puras).

/** @typedef {'cumulative_target'|'window_average'|'coverage'} MeasurementType */
/** @typedef {'higher_is_better'|'lower_is_better'} Direction */
/** @typedef {'monthly'|'weekly'|'quarterly'} Frequency */
/** @typedef {'manual'|'automatic'} Source */
/** @typedef {{ green: number, yellow: number }} Thresholds */

/**
 * @typedef {Object} IndicatorConfig
 * @property {MeasurementType} measurementType
 * @property {Direction} direction
 * @property {number} [windowDays]
 * @property {Thresholds} thresholds
 * @property {Record<string, Thresholds>} [thresholdsByCategory]
 * @property {Frequency} [frequency]
 * @property {number} [minSample]
 * @property {Source} [source]
 */

export const MEASUREMENT_TYPES = Object.freeze(['cumulative_target', 'window_average', 'coverage']);
export const DIRECTIONS = Object.freeze(['higher_is_better', 'lower_is_better']);
export const FREQUENCIES = Object.freeze(['monthly', 'weekly', 'quarterly']);
export const SOURCES = Object.freeze(['manual', 'automatic']);

export const DEFAULTS = Object.freeze({
  windowDays: 30,
  frequency: 'monthly',
  minSample: 0,
  source: 'manual',
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {unknown} t
 * @param {string} label
 * @param {string|undefined} direction
 * @param {string[]} errors
 */
function checkThresholds(t, label, direction, errors) {
  if (!isPlainObject(t)) {
    errors.push(`${label}: debe ser un objeto { green, yellow }`);
    return;
  }
  const { green, yellow } = /** @type {any} */ (t);
  let numeric = true;
  if (!isFiniteNumber(green)) {
    errors.push(`${label}.green: debe ser un número finito`);
    numeric = false;
  }
  if (!isFiniteNumber(yellow)) {
    errors.push(`${label}.yellow: debe ser un número finito`);
    numeric = false;
  }
  if (!numeric) return;
  if (direction === 'higher_is_better' && green < yellow) {
    errors.push(`${label}: con "más es mejor" el umbral verde debe ser mayor o igual que el amarillo`);
  }
  if (direction === 'lower_is_better' && green > yellow) {
    errors.push(`${label}: con "menos es mejor" el umbral verde debe ser menor o igual que el amarillo`);
  }
}

/**
 * Valida la configuración de un indicador.
 * @param {unknown} cfg
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateIndicator(cfg) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(cfg)) {
    return { ok: false, errors: ['La configuración del indicador debe ser un objeto'] };
  }
  const c = /** @type {any} */ (cfg);

  if (!MEASUREMENT_TYPES.includes(c.measurementType)) {
    errors.push(`measurementType: debe ser uno de ${MEASUREMENT_TYPES.join(', ')}`);
  }
  const directionOk = DIRECTIONS.includes(c.direction);
  if (!directionOk) {
    errors.push(`direction: debe ser uno de ${DIRECTIONS.join(', ')}`);
  }
  if (c.windowDays !== undefined && !(Number.isInteger(c.windowDays) && c.windowDays > 0)) {
    errors.push('windowDays: debe ser un entero mayor que 0');
  }
  // M-08 (A4): una meta acumulada mide avance hacia un paquete; "menos es mejor" no tiene regla.
  if (c.measurementType === 'cumulative_target' && c.direction === 'lower_is_better') {
    errors.push('direction: una meta acumulada (cumulative_target) solo admite higher_is_better (más es mejor)');
  }
  checkThresholds(c.thresholds, 'thresholds', directionOk ? c.direction : undefined, errors);

  if (c.thresholdsByCategory !== undefined) {
    if (!isPlainObject(c.thresholdsByCategory)) {
      errors.push('thresholdsByCategory: debe ser un objeto { [categoría]: { green, yellow } }');
    } else {
      for (const [cat, t] of Object.entries(c.thresholdsByCategory)) {
        checkThresholds(t, `thresholdsByCategory.${cat}`, directionOk ? c.direction : undefined, errors);
      }
    }
  }
  if (c.frequency !== undefined && !FREQUENCIES.includes(c.frequency)) {
    errors.push(`frequency: debe ser uno de ${FREQUENCIES.join(', ')}`);
  }
  if (c.minSample !== undefined && !(Number.isInteger(c.minSample) && c.minSample >= 0)) {
    errors.push('minSample: debe ser un entero mayor o igual que 0');
  }
  if (c.source !== undefined && !SOURCES.includes(c.source)) {
    errors.push(`source: debe ser uno de ${SOURCES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Devuelve una copia de la configuración con los valores por defecto aplicados.
 * Lanza un Error (mensaje en español) si la configuración no es válida.
 * @param {IndicatorConfig} cfg
 * @returns {Required<Omit<IndicatorConfig, 'thresholdsByCategory'>> & { thresholdsByCategory: Record<string, Thresholds> }}
 */
export function normalizeIndicator(cfg) {
  const { ok, errors } = validateIndicator(cfg);
  if (!ok) {
    throw new Error(`Indicador inválido: ${errors.join('; ')}`);
  }
  // Objeto sin prototipo: claves como 'constructor' o 'toString' no chocan con Object.prototype.
  // '__proto__' (posible vía JSON.parse) se descarta de forma explícita: nunca se usa como categoría.
  /** @type {Record<string, Thresholds>} */
  const byCategory = Object.create(null);
  for (const [cat, t] of Object.entries(cfg.thresholdsByCategory ?? {})) {
    if (cat === '__proto__') continue;
    byCategory[cat] = { green: t.green, yellow: t.yellow };
  }
  return {
    measurementType: cfg.measurementType,
    direction: cfg.direction,
    windowDays: cfg.windowDays ?? DEFAULTS.windowDays,
    thresholds: { green: cfg.thresholds.green, yellow: cfg.thresholds.yellow },
    thresholdsByCategory: byCategory,
    frequency: cfg.frequency ?? DEFAULTS.frequency,
    minSample: cfg.minSample ?? DEFAULTS.minSample,
    source: cfg.source ?? DEFAULTS.source,
  };
}
