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

/** @typedef {{ value: number|null, sampleSize: number }} Measured */

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
 * Mediciones con fecha inválida o fuera de la ventana se ignoran.
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

/** @param {{ m: Measurement }[]} rows @returns {Measured} */
function windowAverage(rows) {
  const values = rows.map((r) => r.m.value).filter(isFiniteNumber);
  if (values.length === 0) return { value: null, sampleSize: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { value: sum / values.length, sampleSize: values.length };
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
  return { value: (ok / latest.size) * 100, sampleSize: latest.size };
}

/** @param {{ m: Measurement }[]} rows @param {number|undefined} target @returns {Measured} */
function cumulativeTarget(rows, target) {
  if (target !== undefined && target !== null && !(isFiniteNumber(target) && target >= 0)) {
    throw new Error('target: debe ser un número mayor o igual que 0');
  }
  const values = rows.map((r) => r.m.value).filter(isFiniteNumber);
  if (values.length === 0) return { value: null, sampleSize: 0 };
  const resolved = values.reduce((a, b) => a + b, 0);
  if (!target) return { value: 100, sampleSize: values.length };
  return { value: (resolved / target) * 100, sampleSize: values.length };
}
