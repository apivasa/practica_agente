// Caso vulnerabilidades (M-05): paquete trimestral, ritmo, metas mensuales y cumplimiento.
// Funciones puras, sin dependencias de red. Reglas: docs/diseno.md, "Caso: vulnerabilidades",
// "Principio de control" y "Alertas".
import { parseDay } from './measure.js';
import { tolerance } from './color.js';
import { carryOver } from './escalation.js';

/** @typedef {{ p0p1: number, p2p3: number }} PackageCounts */
/** @typedef {{ p0p1: number, p2p3: number, total: number }} Counts */
/** @typedef {{ detectedOn: string, count: number }} NewCritical */
/** @typedef {{ resolvedOn: string, criticality: 'P0P1' | 'P2P3', count: number }} Resolved */
/** @typedef {{ month: string, cumulativeTarget: number }} MonthlyTarget */

/**
 * @typedef {Object} PackageInput
 * @property {string} quarterStart 'YYYY-MM-DD', primer día del trimestre.
 * @property {string} quarterEnd 'YYYY-MM-DD', último día; debe caer en el tercer mes calendario.
 * @property {string} asOf 'YYYY-MM-DD' en America/Guayaquil (lo calcula quien llama). No antes de quarterStart.
 * @property {PackageCounts} initialPackage Paquete asignado por Seguridad.
 * @property {NewCritical[]} [newCritical=[]] P0/P1 nuevas detectadas por escaneo.
 * @property {Resolved[]} [resolved=[]] Resueltas por criticidad.
 * @property {{ p0p1?: number, p2p3?: number }} [thresholds] Cumplimiento exigido en %; por defecto 96 y 85.
 */

/**
 * @typedef {Object} PackageStatus
 * @property {string} asOf
 * @property {string} quarterStart
 * @property {string} quarterEnd
 * @property {number|null} currentMonthIndex 1, 2 o 3; null si asOf es posterior al trimestre.
 * @property {Counts} effectiveTotal Paquete inicial + P0/P1 de los meses 1 y 2.
 * @property {Counts} resolvedToDate
 * @property {Counts} pending max(efectivo - resuelto, 0) por criticidad.
 * @property {number} carryToNextQuarter P0/P1 detectadas en el mes 3 (pasan al paquete siguiente).
 * @property {number} pendingCarry Pendiente + carryToNextQuarter: lo que se arrastra si se cerrara hoy.
 * @property {number} weeksRemaining Días desde asOf (excluido) hasta quarterEnd (incluido) / 7; >= 0.
 * @property {number} expectedWeeklyPace pendiente.total / semanas restantes; con 0 semanas, el pendiente.
 * @property {MonthlyTarget[]} monthlyTargets Meta acumulada por mes (≈ 1/3, redondeo hacia arriba).
 * @property {{ p0p1Pct: number, p2p3Pct: number, meetsP0P1: boolean, meetsP2P3: boolean,
 *   thresholds: { p0p1: number, p2p3: number } }} compliance
 */

/** Umbrales de cumplimiento por defecto (%), configurables por llamada. */
export const DEFAULT_COMPLIANCE_THRESHOLDS = Object.freeze({ p0p1: 96, p2p3: 85 });

const CRITICALITIES = Object.freeze(['P0P1', 'P2P3']);

/**
 * @param {unknown} s
 * @param {string} name
 * @returns {number} día UTC
 */
function day(s, name) {
  const d = parseDay(s);
  if (d === null) throw new TypeError(`${name} debe ser una fecha real YYYY-MM-DD`);
  return d;
}

/** @param {unknown} n @param {string} name */
function count(n, name) {
  if (!Number.isInteger(n) || /** @type {number} */ (n) < 0) {
    throw new TypeError(`${name} debe ser un entero >= 0`);
  }
  return /** @type {number} */ (n);
}

/** @param {unknown} n @param {string} name */
function pct(n, name) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new TypeError(`${name} debe ser un porcentaje entre 0 y 100`);
  }
  return n;
}

/** Meses desde 'YYYY-MM' a 'YYYY-MM' (b - a). */
const monthDiff = (a, b) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** 'YYYY-MM' desplazado n meses. */
function addMonths(month, n) {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Días del mes 'YYYY-MM'. */
const daysInMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** ceil tolerante a errores de coma flotante (p. ej. 666.0000000001 → 666). */
const ceilTol = (x) => Math.ceil(x - tolerance(x));

/** % de cumplimiento; sin nada que resolver → 100. */
const compliancePct = (resolved, total) => (total === 0 ? 100 : (Math.min(resolved, total) * 100) / total);

/**
 * Estado del paquete trimestral de vulnerabilidades de una unidad.
 * - P0/P1 nuevas de los meses 1 y 2 suman al paquete (efectivo); las del mes 3 van a
 *   `carryToNextQuarter`. Los meses son calendario: el mes 1 es el de `quarterStart`.
 * - Solo cuentan detecciones y resoluciones con fecha <= asOf; fechas fuera del trimestre
 *   o posteriores a asOf lanzan error (las filtra quien llama).
 * @param {PackageInput} input
 * @returns {PackageStatus}
 */
export function packageStatus(input) {
  if (!input || typeof input !== 'object') throw new TypeError('packageStatus requiere un objeto de entrada');
  const { quarterStart, quarterEnd, asOf, initialPackage, newCritical = [], resolved = [], thresholds = {} } = input;
  const start = day(quarterStart, 'quarterStart');
  const end = day(quarterEnd, 'quarterEnd');
  const now = day(asOf, 'asOf');
  if (end < start) throw new RangeError('quarterEnd no puede ser anterior a quarterStart');
  const firstMonth = quarterStart.slice(0, 7);
  if (monthDiff(firstMonth, quarterEnd.slice(0, 7)) !== 2) {
    throw new RangeError('El trimestre debe abarcar exactamente tres meses calendario');
  }
  if (now < start) throw new RangeError('asOf no puede ser anterior al inicio del trimestre');

  if (!initialPackage || typeof initialPackage !== 'object') {
    throw new TypeError('initialPackage es obligatorio: { p0p1, p2p3 }');
  }
  const initP0 = count(initialPackage.p0p1, 'initialPackage.p0p1');
  const initP2 = count(initialPackage.p2p3, 'initialPackage.p2p3');
  if (thresholds === null || typeof thresholds !== 'object') throw new TypeError('thresholds debe ser un objeto');
  const th = {
    p0p1: pct(thresholds.p0p1 ?? DEFAULT_COMPLIANCE_THRESHOLDS.p0p1, 'thresholds.p0p1'),
    p2p3: pct(thresholds.p2p3 ?? DEFAULT_COMPLIANCE_THRESHOLDS.p2p3, 'thresholds.p2p3'),
  };

  /** @param {unknown} s @param {string} name */
  const inQuarter = (s, name) => {
    const d = day(s, name);
    if (d < start || d > end) throw new RangeError(`${name} (${String(s)}) está fuera del trimestre`);
    if (d > now) throw new RangeError(`${name} (${String(s)}) es posterior a asOf`);
    return /** @type {string} */ (s);
  };

  if (!Array.isArray(newCritical)) throw new TypeError('newCritical debe ser un arreglo');
  /** @type {[number, number, number]} */
  const byMonth = [0, 0, 0];
  newCritical.forEach((e, i) => {
    if (!e || typeof e !== 'object') throw new TypeError(`newCritical[${i}] inválido`);
    const d = inQuarter(e.detectedOn, `newCritical[${i}].detectedOn`);
    byMonth[monthDiff(firstMonth, d.slice(0, 7))] += count(e.count, `newCritical[${i}].count`);
  });

  if (!Array.isArray(resolved)) throw new TypeError('resolved debe ser un arreglo');
  let resP0 = 0;
  let resP2 = 0;
  resolved.forEach((e, i) => {
    if (!e || typeof e !== 'object') throw new TypeError(`resolved[${i}] inválido`);
    inQuarter(e.resolvedOn, `resolved[${i}].resolvedOn`);
    if (!CRITICALITIES.includes(e.criticality)) {
      throw new TypeError(`resolved[${i}].criticality debe ser 'P0P1' o 'P2P3'`);
    }
    const c = count(e.count, `resolved[${i}].count`);
    if (e.criticality === 'P0P1') resP0 += c;
    else resP2 += c;
  });

  // Reutiliza la regla de arrastre de C-01, por criticidad para no mezclar excedentes.
  const p0 = carryOver({ packageTotal: initP0, resolved: resP0, newCriticalByMonth: byMonth });
  const p2 = carryOver({ packageTotal: initP2, resolved: resP2, newCriticalByMonth: [0, 0, 0] });

  const effectiveTotal = { p0p1: p0.effectiveTotal, p2p3: p2.effectiveTotal, total: p0.effectiveTotal + p2.effectiveTotal };
  const resolvedToDate = { p0p1: resP0, p2p3: resP2, total: resP0 + resP2 };
  const pendP0 = Math.max(effectiveTotal.p0p1 - resP0, 0);
  const pendP2 = Math.max(effectiveTotal.p2p3 - resP2, 0);
  const pending = { p0p1: pendP0, p2p3: pendP2, total: pendP0 + pendP2 };

  const weeksRemaining = Math.max(end - now, 0) / 7;
  const expectedWeeklyPace = weeksRemaining === 0 ? pending.total : pending.total / weeksRemaining;

  const monthlyTargets = [1, 2, 3].map((i) => ({
    month: addMonths(firstMonth, i - 1),
    cumulativeTarget: i === 3 ? effectiveTotal.total : ceilTol((effectiveTotal.total * i) / 3),
  }));

  const p0p1Pct = compliancePct(resP0, effectiveTotal.p0p1);
  const p2p3Pct = compliancePct(resP2, effectiveTotal.p2p3);
  const currentMonthIndex = now > end ? null : monthDiff(firstMonth, asOf.slice(0, 7)) + 1;

  return {
    asOf,
    quarterStart,
    quarterEnd,
    currentMonthIndex,
    effectiveTotal,
    resolvedToDate,
    pending,
    carryToNextQuarter: byMonth[2],
    pendingCarry: p0.pendingCarry + p2.pendingCarry,
    weeksRemaining,
    expectedWeeklyPace,
    monthlyTargets,
    compliance: {
      p0p1Pct,
      p2p3Pct,
      meetsP0P1: p0p1Pct >= th.p0p1 - tolerance(th.p0p1),
      meetsP2P3: p2p3Pct >= th.p2p3 - tolerance(th.p2p3),
      thresholds: th,
    },
  };
}

/** @param {unknown} s */
function assertStatus(s, name = 'status') {
  if (
    !s ||
    typeof s !== 'object' ||
    !Array.isArray(/** @type {any} */ (s).monthlyTargets) ||
    /** @type {any} */ (s).monthlyTargets.length !== 3 ||
    !(/** @type {any} */ (s).effectiveTotal) ||
    !(/** @type {any} */ (s).resolvedToDate) ||
    parseDay(/** @type {any} */ (s).asOf) === null
  ) {
    throw new TypeError(`${name} debe ser el resultado de packageStatus`);
  }
}

/**
 * Atraso frente al ritmo esperado (alerta "atraso frente al ritmo esperado").
 * Compara lo resuelto (total) con la meta acumulada del mes en curso.
 * - `monthToDate: true` (por defecto): la meta del mes se prorratea por días transcurridos
 *   (asOf cuenta como transcurrido), redondeando hacia arriba.
 * - `monthToDate: false`: se exige la meta acumulada completa del mes en curso.
 * - asOf posterior al trimestre: se exige el total efectivo.
 * @param {PackageStatus} status
 * @param {{ monthToDate?: boolean }} [options]
 * @returns {{ behind: boolean, gap: number, expected: number, resolved: number, reason: string }}
 */
export function paceStatus(status, { monthToDate = true } = {}) {
  assertStatus(status);
  const resolved = status.resolvedToDate.total;
  const idx = status.currentMonthIndex;
  let expected;
  let scope;
  if (idx === null) {
    expected = status.effectiveTotal.total;
    scope = 'cierre del trimestre';
  } else {
    const target = status.monthlyTargets[idx - 1];
    const prev = idx === 1 ? 0 : status.monthlyTargets[idx - 2].cumulativeTarget;
    if (monthToDate) {
      const frac = Number(status.asOf.slice(8, 10)) / daysInMonth(target.month);
      expected = ceilTol(prev + (target.cumulativeTarget - prev) * frac);
      scope = `avance esperado a ${status.asOf} (mes ${target.month})`;
    } else {
      expected = target.cumulativeTarget;
      scope = `meta acumulada de ${target.month}`;
    }
  }
  const gap = Math.max(expected - resolved, 0);
  const behind = gap > 0;
  const reason = behind
    ? `Atraso: ${resolved} resueltas frente a ${expected} de la ${scope}; faltan ${gap}`
    : `Al día: ${resolved} resueltas frente a ${expected} de la ${scope}`;
  return { behind, gap, expected, resolved, reason };
}

/**
 * Alerta "ingreso de P0/P1 que recalcula la meta": compara dos estados del mismo paquete.
 * @param {PackageStatus} prevStatus
 * @param {PackageStatus} newStatus
 * @returns {{ targetChanged: boolean, delta: number, previousTotal: number, newTotal: number,
 *   previousPace: number, newPace: number, carryDelta: number, reason: string }}
 */
export function recalculateOnNewCritical(prevStatus, newStatus) {
  assertStatus(prevStatus, 'prevStatus');
  assertStatus(newStatus, 'newStatus');
  const previousTotal = prevStatus.effectiveTotal.total;
  const newTotal = newStatus.effectiveTotal.total;
  const delta = newTotal - previousTotal;
  const carryDelta = newStatus.carryToNextQuarter - prevStatus.carryToNextQuarter;
  const previousPace = prevStatus.expectedWeeklyPace;
  const newPace = newStatus.expectedWeeklyPace;
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  const targetChanged = delta !== 0;
  let reason;
  if (targetChanged) {
    reason =
      `${delta > 0 ? 'Ingresaron' : 'Se retiraron'} ${Math.abs(delta)} P0/P1: la meta del trimestre pasa de ` +
      `${previousTotal} a ${newTotal}; ritmo esperado de ${fmt(previousPace)} a ${fmt(newPace)} por semana`;
  } else if (carryDelta > 0) {
    reason = `Ingresaron ${carryDelta} P0/P1 en el mes 3: pasan al paquete del siguiente trimestre; la meta no cambia`;
  } else {
    reason = 'Sin cambios en la meta del trimestre';
  }
  return { targetChanged, delta, previousTotal, newTotal, previousPace, newPace, carryDelta, reason };
}
