// Calendario de negocio (funciones puras, sin dependencias de red). Lo usan las Actions
// (scripts/lib/) y el front (V-01..V-03).
import { quarterOf } from './escalation.js';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

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
