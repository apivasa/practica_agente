// V-08: candado vigente hoy de una unidad — funciones puras, sin dependencias de red.
// Lo usan las Actions (scripts/lib/build.js: historial del trimestre y frescura) y el front
// (tableros del líder y del comité). Reglas: docs/diseno.md "Reglas de escalada" y
// "Excepciones"; ADR 0003 (change_start no levanta el congelamiento) y ADR 0012.
import { evaluateEscalation, COLORS } from './escalation.js';
import { exceptionFromRow, isDate } from './exceptions.js';
import { addMonths, quarterBounds } from './calendar.js';

/** Q-03 (ADR 0003, punto 4): por defecto amarillo en mes 2 no congela. */
export const YELLOW_MONTH2_ESCALATES_LIKE_RED = false;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Historial del trimestre: meses desde el inicio del trimestre de `evalMonth` hasta
 * `evalMonth`, consecutivos; un mes sin evaluación guardada cuenta como 'not_evaluated'.
 * Solo meses del mismo trimestre (filtra lo de trimestres anteriores).
 * @param {string} evalMonth
 * @param {Record<string, string>} storedColors color global guardado por mes
 * @param {string} currentColor color de evalMonth
 */
export function buildHistory(evalMonth, storedColors, currentColor) {
  const { months } = quarterBounds(evalMonth);
  return months
    .filter((m) => m <= evalMonth)
    .map((m) => ({
      month: m,
      color: m === evalMonth ? currentColor : (Object.hasOwn(storedColors, m) ? storedColors[m] : 'not_evaluated'),
    }));
}

/**
 * H-C01-02: el último mes del historial debe ser el mes de asOf o el anterior. Evita aplicar
 * candados con un trimestre viejo (p. ej. Q1 evaluado el 2026-09-01).
 * @param {{ month: string }[]} history
 * @param {string} asOf
 */
export function assertHistoryFresh(history, asOf) {
  const last = history.at(-1)?.month;
  const current = asOf.slice(0, 7);
  if (!last || (last !== current && last !== addMonths(current, -1))) {
    throw new RangeError(
      `El historial termina en ${String(last)}: debe ser el mes de ${asOf} o el anterior (H-C01-02)`,
    );
  }
}

/**
 * Candado vigente hoy de una unidad: el historial del trimestre sale de las evaluaciones
 * globales guardadas (el cierre mensual) y las excepciones se toman tal como están hoy
 * (vigentes, vencidas o revocadas según exceptionStatus). Así una excepción aprobada hoy
 * se ve hoy, sin esperar al siguiente cierre. El candado guardado sigue siendo el oficial
 * del cierre.
 *
 * El cierre vigente es la evaluación global más reciente del mes de `today` o del anterior
 * (la misma frescura que exige la evaluación mensual). Si no hay, no se calcula candado.
 *
 * @param {{ unitId: string, evaluations: any[], exceptions: any[], today: string,
 *   yellowLikeRed?: boolean }} input filas de public.evaluations y public.exceptions
 * @returns {{ ok: true, closureMonth: string, asOf: string, level: string, restrictions: string[],
 *   reason: string, appliedExceptions: string[], suppressedRestrictions: string[],
 *   authorizedStarts: { id: string, change_ref: string | null }[] }
 *   | { ok: false, status: 'no_closure' | 'invalid', closureMonth: string | null, reason: string }}
 */
export function lockToday({ unitId, evaluations, exceptions, today, yellowLikeRed = YELLOW_MONTH2_ESCALATES_LIKE_RED }) {
  if (!isDate(today)) throw new TypeError('today debe ser una fecha real YYYY-MM-DD');
  if (typeof unitId !== 'string' || unitId === '') throw new TypeError('unitId debe ser un texto no vacío');
  const current = today.slice(0, 7);
  const previous = addMonths(current, -1);

  /** @type {Record<string, string>} */
  const storedColors = Object.create(null);
  for (const e of Array.isArray(evaluations) ? evaluations : []) {
    if (!e || typeof e !== 'object' || e.unit_id !== unitId) continue;
    if (e.indicator_id !== null && e.indicator_id !== undefined) continue;
    if (typeof e.month !== 'string' || !MONTH_RE.test(e.month) || e.month > current) continue;
    storedColors[e.month] = e.color;
  }
  const months = Object.keys(storedColors).sort();
  const closureMonth = months.at(-1) ?? null;
  if (closureMonth === null || closureMonth < previous) {
    return {
      ok: false,
      status: 'no_closure',
      closureMonth,
      reason: `Sin cierre vigente: no hay evaluación mensual de ${previous} ni de ${current}`,
    };
  }

  try {
    if (!COLORS.includes(storedColors[closureMonth])) throw new TypeError('color inválido');
    const history = buildHistory(closureMonth, storedColors, storedColors[closureMonth]);
    assertHistoryFresh(history, today);
    const own = (Array.isArray(exceptions) ? exceptions : []).filter((x) => x && x.unit_id === unitId);
    const r = evaluateEscalation(history, {
      asOf: today,
      yellowMonth2EscalatesLikeRed: yellowLikeRed === true,
      activeExceptions: own.map(exceptionFromRow),
    });
    return {
      ok: true,
      closureMonth,
      asOf: today,
      level: r.level,
      restrictions: r.restrictions,
      reason: r.reason,
      appliedExceptions: r.appliedExceptions,
      suppressedRestrictions: r.suppressedRestrictions,
      authorizedStarts: r.authorizedStarts,
    };
  } catch {
    return {
      ok: false,
      status: 'invalid',
      closureMonth,
      reason: 'No se pudo calcular el candado de hoy con los datos guardados',
    };
  }
}
