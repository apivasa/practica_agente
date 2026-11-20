// Armado de entradas del motor desde filas de la BD (funciones puras).
// La lógica de color, escalada y ritmo vive en engine/; aquí solo se traducen
// filas a los contratos del motor y se filtran fechas (ADR 0006, punto 5).
import { unitColor, evaluateEscalation, exceptionFromRow } from '../../engine/index.js';
import { addDays, addMonths } from './dates.js';
import {
  pickCommitment,
  indicatorConfig,
  buildPackageInput,
  toEngineMeasurements,
  evaluateIndicatorMonth,
} from '../../engine/rows.js';
import { YELLOW_MONTH2_ESCALATES_LIKE_RED, buildHistory, assertHistoryFresh } from '../../engine/lock.js';

// Movidas a engine/rows.js (V-01 y M-07: las usa también el front); se reexportan por compatibilidad.
export { pickCommitment, indicatorConfig, buildPackageInput, toEngineMeasurements, evaluateIndicatorMonth };

// Movidas a engine/lock.js (V-08: el front calcula el candado de hoy con el mismo historial);
// se reexportan por compatibilidad.
export { YELLOW_MONTH2_ESCALATES_LIKE_RED, buildHistory, assertHistoryFresh };

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
