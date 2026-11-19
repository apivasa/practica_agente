// Fechas de negocio (America/Guayaquil) y utilidades de calendario.
// Funciones puras salvo `todayInGuayaquil`, que recibe el instante como argumento.
import { parseDay, quarterOf } from '../../engine/index.js';

export const BUSINESS_TZ = 'America/Guayaquil';
const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Fecha 'YYYY-MM-DD' del instante `now` en America/Guayaquil (sin librerías).
 * @param {Date} [now]
 */
export function todayInGuayaquil(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** @param {unknown} s */
export function isDate(s) {
  return parseDay(s) !== null;
}

/** @param {string} s */
function assertDate(s, name = 'fecha') {
  if (!isDate(s)) throw new TypeError(`${name} debe ser una fecha real YYYY-MM-DD: ${String(s)}`);
}

/** @param {string} date @param {number} n */
export function addDays(date, n) {
  assertDate(date);
  return new Date((parseDay(date) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** @param {string} month 'YYYY-MM' @param {number} n */
export function addMonths(month, n) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new TypeError(`Mes inválido: ${String(month)}`);
  const idx = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Último día 'YYYY-MM-DD' del mes 'YYYY-MM'. */
export function monthEnd(month) {
  const m = MONTH_RE.exec(month);
  if (!m) throw new TypeError(`Mes inválido: ${String(month)}`);
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/**
 * Límites del trimestre calendario de un mes.
 * @param {string} month 'YYYY-MM'
 * @returns {{ quarter: string, start: string, end: string, months: string[] }}
 */
export function quarterBounds(month) {
  const quarter = quarterOf(month);
  const first = `${quarter.slice(0, 4)}-${String((Number(quarter.slice(6)) - 1) * 3 + 1).padStart(2, '0')}`;
  const months = [first, addMonths(first, 1), addMonths(first, 2)];
  return { quarter, start: `${first}-01`, end: monthEnd(months[2]), months };
}

/**
 * Argumentos de la línea de comandos: --mode=monthly|daily [--as-of=YYYY-MM-DD].
 * @param {string[]} argv
 * @param {Date} [now]
 * @returns {{ mode: 'monthly' | 'daily', asOf: string }}
 */
export function parseArgs(argv, now = new Date()) {
  let mode;
  let asOf;
  for (const arg of argv) {
    const m = /^--(mode|as-of)=(.*)$/.exec(arg);
    if (!m) throw new TypeError(`Argumento desconocido: ${arg}`);
    if (m[1] === 'mode') mode = m[2];
    else asOf = m[2];
  }
  if (mode !== 'monthly' && mode !== 'daily') {
    throw new TypeError('Falta --mode=monthly o --mode=daily');
  }
  if (asOf === undefined || asOf === '') asOf = todayInGuayaquil(now);
  assertDate(asOf, '--as-of');
  return { mode, asOf };
}
