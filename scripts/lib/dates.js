// Fechas de negocio (America/Guayaquil) y utilidades de calendario.
// Funciones puras salvo `todayInGuayaquil`, que recibe el instante como argumento.
import { parseDay, businessDate, BUSINESS_TZ } from '../../engine/index.js';
import { addMonths, monthEnd, quarterBounds } from '../../engine/calendar.js';

// Calendario puro movido a engine/calendar.js (V-01: lo usa también el front).
export { addMonths, monthEnd, quarterBounds };

export { BUSINESS_TZ };
const DAY_MS = 86_400_000;

/**
 * Fecha 'YYYY-MM-DD' del instante `now` en America/Guayaquil (engine/dates.js).
 * @param {Date} [now]
 */
export function todayInGuayaquil(now = new Date()) {
  return businessDate(now);
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

/**
 * Argumentos de la línea de comandos: --mode=monthly|daily [--as-of=YYYY-MM-DD] [--reprocess].
 * `--reprocess` solo aplica a la mensual: permite volver a cerrar un mes ya evaluado.
 * @param {string[]} argv
 * @param {Date} [now]
 * @returns {{ mode: 'monthly' | 'daily', asOf: string, reprocess: boolean }}
 */
export function parseArgs(argv, now = new Date()) {
  let mode;
  let asOf;
  let reprocess = false;
  for (const arg of argv) {
    if (arg === '--reprocess') {
      reprocess = true;
      continue;
    }
    const m = /^--(mode|as-of)=(.*)$/.exec(arg);
    if (!m) throw new TypeError(`Argumento desconocido: ${arg}`);
    if (m[1] === 'mode') mode = m[2];
    else asOf = m[2];
  }
  if (mode !== 'monthly' && mode !== 'daily') {
    throw new TypeError('Falta --mode=monthly o --mode=daily');
  }
  if (reprocess && mode !== 'monthly') throw new TypeError('--reprocess solo aplica a --mode=monthly');
  if (asOf === undefined || asOf === '') asOf = todayInGuayaquil(now);
  assertDate(asOf, '--as-of');
  return { mode, asOf, reprocess };
}

/**
 * H-C03-01: la fecha de evaluación no puede ser posterior a hoy en America/Guayaquil (una
 * fecha futura consumiría las claves de dedupe y silenciaría las alertas reales).
 * `allowFuture` solo lo usa la integración de CI contra Supabase local.
 * @param {string} asOf
 * @param {{ now?: Date, allowFuture?: boolean }} [options]
 */
export function assertNotFuture(asOf, { now = new Date(), allowFuture = false } = {}) {
  const today = todayInGuayaquil(now);
  if (!allowFuture && asOf > today) {
    throw new RangeError(`--as-of ${asOf} es posterior a hoy (${today}, America/Guayaquil)`);
  }
}

/**
 * EVALUATE_ALLOW_FUTURE=1 solo vale contra Supabase local (127.0.0.1 o localhost):
 * en producción nunca se aceptan fechas futuras aunque la variable exista.
 * @param {Record<string, string | undefined>} env
 * @param {string} url SUPABASE_URL ya validada
 */
export function allowFutureFromEnv(env, url) {
  if (env.EVALUATE_ALLOW_FUTURE !== '1') return false;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('EVALUATE_ALLOW_FUTURE solo se admite contra Supabase local');
  }
  return true;
}
