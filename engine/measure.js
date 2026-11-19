// Cálculo del valor medido de un indicador en su ventana (funciones puras).
import { normalizeIndicator } from './indicator.js';

/**
 * @typedef {Object} Measurement
 * @property {string} date        Fecha 'YYYY-MM-DD' (UTC, sin hora)
 * @property {number} [value]
 * @property {string} [appId]
 * @property {boolean} [compliant]
 * @property {string} [category]
 */

/**
 * Resultado de una medición. `reason` solo aparece cuando `value` es null por una causa
 * distinta de la ventana vacía (meta ausente, desbordamiento).
 * @typedef {{ value: number|null, sampleSize: number, reason?: string }} Measured
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Convierte 'YYYY-MM-DD' a número de día UTC (días desde epoch). null si no es válida.
 * @param {unknown} s
 * @returns {number|null}
 */
export function parseDay(s) {
  if (typeof s !== 'string') return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/**
 * Calcula el valor del indicador en la ventana [asOf - windowDays + 1, asOf] (inclusiva).
 * Mediciones con fecha inválida o fuera de la ventana se ignoran. En `window_average` y
 * `cumulative_target` también se ignoran valores no finitos o negativos.
 * Si se pasa `category`, solo se consideran mediciones de esa categoría.
 *
 * @param {import('./indicator.js').IndicatorConfig} cfg
 * @param {Measurement[]} measurements
 * @param {{ asOf: string, target?: number, category?: string }} options
 * @returns {Measured}
 */
export function measure(cfg, measurements, options) {
  const ind = normalizeIndicator(cfg);
  const { asOf, target, category } = options ?? /** @type {any} */ ({});
  const end = parseDay(asOf);
  if (end === null) {
    throw new Error('asOf: debe ser una fecha válida con formato YYYY-MM-DD');
  }
  if (!Array.isArray(measurements)) {
    throw new Error('measurements: debe ser un arreglo');
  }
  const start = end - ind.windowDays + 1;

  /** @type {{ m: Measurement, day: number }[]} */
  const inWindow = [];
  for (const m of measurements) {
    if (m === null || typeof m !== 'object') continue;
    const day = parseDay(m.date);
    if (day === null || day < start || day > end) continue;
    if (category !== undefined && m.category !== category) continue;
    inWindow.push({ m, day });
  }

  switch (ind.measurementType) {
    case 'window_average':
      return windowAverage(inWindow);
    case 'coverage':
      return coverage(inWindow);
    default:
      return cumulativeTarget(inWindow, target);
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
// Para promedio en ventana y meta acumulada solo cuentan valores finitos y >= 0.
const isValidAmount = (v) => isFiniteNumber(v) && v >= 0;

export const REASON_OUT_OF_RANGE = 'Valor calculado fuera de rango numérico';
export const REASON_MISSING_TARGET = 'Falta la meta (target) del periodo: no se puede evaluar';

/**
 * Si el resultado no es finito (desbordamiento), el indicador queda sin valor.
 * @param {number} value @param {number} sampleSize @returns {Measured}
 */
function finite(value, sampleSize) {
  if (!Number.isFinite(value)) return { value: null, sampleSize, reason: REASON_OUT_OF_RANGE };
  return { value, sampleSize };
}

/** @param {{ m: Measurement }[]} rows @returns {Measured} */
function windowAverage(rows) {
  const values = rows.map((r) => r.m.value).filter(isValidAmount);
  if (values.length === 0) return { value: null, sampleSize: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return finite(sum / values.length, values.length);
}

/** @param {{ m: Measurement, day: number }[]} rows @returns {Measured} */
function coverage(rows) {
  /** @type {Map<string, { day: number, compliant: boolean }>} */
  const latest = new Map();
  for (const { m, day } of rows) {
    if (typeof m.appId !== 'string' || m.appId === '') continue;
    const prev = latest.get(m.appId);
    // A igual fecha, gana la que aparece después en el arreglo.
    if (prev === undefined || day >= prev.day) {
      latest.set(m.appId, { day, compliant: m.compliant === true });
    }
  }
  if (latest.size === 0) return { value: null, sampleSize: 0 };
  let ok = 0;
  for (const v of latest.values()) if (v.compliant) ok += 1;
  // ok * 100 / n (y no (ok / n) * 100) evita errores binarios como 57/100*100 = 56.99999999999999.
  return { value: (ok * 100) / latest.size, sampleSize: latest.size };
}

/** @param {{ m: Measurement }[]} rows @param {number|undefined|null} target @returns {Measured} */
function cumulativeTarget(rows, target) {
  if (target !== undefined && target !== null && !(isFiniteNumber(target) && target >= 0)) {
    throw new Error('target: debe ser un número mayor o igual que 0');
  }
  const values = rows.map((r) => r.m.value).filter(isValidAmount);
  if (target === undefined || target === null) {
    return { value: null, sampleSize: values.length, reason: REASON_MISSING_TARGET };
  }
  if (values.length === 0) return { value: null, sampleSize: 0 };
  // target 0: no hay nada que resolver → 100 %.
  if (target === 0) return { value: 100, sampleSize: values.length };
  const resolved = values.reduce((a, b) => a + b, 0);
  return finite((resolved * 100) / target, values.length);
}
