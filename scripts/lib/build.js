// Armado de entradas del motor desde filas de la BD (funciones puras).
// La lógica de color, escalada y ritmo vive en engine/; aquí solo se traducen
// filas a los contratos del motor y se filtran fechas (ADR 0006, punto 5).
import { unitColor, evaluateEscalation, exceptionFromRow } from '../../engine/index.js';
import { addDays, addMonths, quarterBounds } from './dates.js';
import {
  pickCommitment,
  indicatorConfig,
  buildPackageInput,
  toEngineMeasurements,
  evaluateIndicatorMonth,
} from '../../engine/rows.js';

// Movidas a engine/rows.js (V-01 y M-07: las usa también el front); se reexportan por compatibilidad.
export { pickCommitment, indicatorConfig, buildPackageInput, toEngineMeasurements, evaluateIndicatorMonth };

/** Q-03 (ADR 0003, punto 4): por defecto amarillo en mes 2 no congela. */
export const YELLOW_MONTH2_ESCALATES_LIKE_RED = false;

/**
 * Historial del trimestre para M-05/C-01: meses desde el inicio del trimestre de `evalMonth`
 * hasta `evalMonth`, consecutivos; un mes sin evaluación guardada cuenta como 'not_evaluated'.
 * Solo meses del mismo trimestre (filtra lo de trimestres anteriores).
 * @param {string} evalMonth
 * @param {Record<string, string>} storedColors color global guardado por mes
 * @param {string} currentColor color recién calculado para evalMonth
 */
export function buildHistory(evalMonth, storedColors, currentColor) {
  const { months } = quarterBounds(evalMonth);
  return months
    .filter((m) => m <= evalMonth)
    .map((m) => ({ month: m, color: m === evalMonth ? currentColor : (storedColors[m] ?? 'not_evaluated') }));
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
 * Evaluación global de la unidad en el mes: peor color y candado.
 * @param {{ evalMonth: string, asOf: string, indicatorColors: string[], storedColors: Record<string,string>,
 *   exceptions: any[], yellowLikeRed?: boolean }} input
 */
export function evaluateUnitMonth({
  evalMonth,
  asOf,
  indicatorColors,
  storedColors,
  exceptions,
  yellowLikeRed = YELLOW_MONTH2_ESCALATES_LIKE_RED,
}) {
  const color = unitColor(indicatorColors);
  const history = buildHistory(evalMonth, storedColors, color);
  assertHistoryFresh(history, asOf);
  const escalation = evaluateEscalation(history, {
    asOf,
    yellowMonth2EscalatesLikeRed: yellowLikeRed,
    // C-02: revokedOn (fecha de Guayaquil) y changeRef llegan al motor.
    activeExceptions: exceptions.map(exceptionFromRow),
  });
  return { color, history, escalation };
}

/**
 * Mes que cierra la evaluación mensual: el mes calendario anterior al de asOf
 * (el cron del día 1 cierra el mes que terminó).
 * @param {string} asOf
 */
export const monthToClose = (asOf) => addMonths(asOf.slice(0, 7), -1);

/**
 * Estado del paquete "sin ingresos": el paquete inicial a la misma fecha. Sirve como estado
 * previo cuando no hay snapshot anterior en el trimestre.
 * @param {any} packageInput
 */
export const baselineInput = (packageInput) => ({ ...packageInput, newCritical: [] });

/** Fecha mínima de vencimiento a considerar para alertas de excepción vencida. */
export const EXPIRED_LOOKBACK_DAYS = 7;
export const expiredSince = (asOf) => addDays(asOf, -EXPIRED_LOOKBACK_DAYS);
