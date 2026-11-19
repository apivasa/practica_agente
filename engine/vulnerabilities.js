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
 * @property {Counts} resolvedToDate Resueltas por criticidad, recortadas a lo resoluble (P0/P1: efectivo + mes 3; P2/P3: efectivo).
 * @property {Counts} resolvedReported Resueltas tal como se reportaron (sin recortar).
 * @property {Counts} pending max(efectivo - resuelto, 0) por criticidad.
 * @property {number} carryToNextQuarter P0/P1 detectadas en el mes 3 (pasan al paquete siguiente).
 * @property {number} pendingCarry Por criticidad max(efectivo + mes 3 - resuelto, 0), sumado: lo que se arrastra si se cerrara hoy.
 * @property {number} weeksRemaining Días desde asOf (excluido) hasta quarterEnd (incluido) / 7; >= 0.
 * @property {number} expectedWeeklyPace pendiente.total / semanas restantes; con 0 semanas, el pendiente.
 * @property {{ p0p1: number, p2p3: number }} expectedWeeklyPaceByCriticality
 * @property {MonthlyTarget[]} monthlyTargets Meta acumulada por mes (≈ 1/3, redondeo hacia arriba).
 * @property {{ p0p1: MonthlyTarget[], p2p3: MonthlyTarget[] }} monthlyTargetsByCriticality
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
  if (!Number.isSafeInteger(n) || /** @type {number} */ (n) < 0) {
    throw new TypeError(`${name} debe ser un entero seguro >= 0`);
  }
  return /** @type {number} */ (n);
}

/** Suma de conteos: lanza si el total deja de ser un entero seguro (falla cerrada). */
function safeSum(name, ...xs) {
  const total = xs.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError(`${name} excede el rango numérico seguro`);
  return total;
}

/** Propiedad propia (no heredada del prototipo) o undefined. */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

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

/** @param {Counts} c */
const finiteCounts = (c) => !!c && [c.p0p1, c.p2p3, c.total].every((n) => Number.isFinite(n));

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
  const initP0 = count(own(initialPackage, 'p0p1'), 'initialPackage.p0p1');
  const initP2 = count(own(initialPackage, 'p2p3'), 'initialPackage.p2p3');
  if (thresholds === null || typeof thresholds !== 'object') throw new TypeError('thresholds debe ser un objeto');
  const th = {
    p0p1: pct(own(thresholds, 'p0p1') ?? DEFAULT_COMPLIANCE_THRESHOLDS.p0p1, 'thresholds.p0p1'),
    p2p3: pct(own(thresholds, 'p2p3') ?? DEFAULT_COMPLIANCE_THRESHOLDS.p2p3, 'thresholds.p2p3'),
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
    const m = monthDiff(firstMonth, d.slice(0, 7));
    byMonth[m] = safeSum('newCritical', byMonth[m], count(e.count, `newCritical[${i}].count`));
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
    if (e.criticality === 'P0P1') resP0 = safeSum('resolved P0/P1', resP0, c);
    else resP2 = safeSum('resolved P2/P3', resP2, c);
  });

  // carryOver (C-01) da el total efectivo: paquete + P0/P1 de los meses 1 y 2.
  const effP0 = carryOver({ packageTotal: initP0, resolved: 0, newCriticalByMonth: byMonth }).effectiveTotal;
  const effP2 = initP2;
  const m3 = byMonth[2];
  const effectiveTotal = { p0p1: effP0, p2p3: effP2, total: safeSum('effectiveTotal', effP0, effP2) };
  safeSum('effectiveTotal + mes 3', effectiveTotal.total, m3);

  // Lo resuelto de una criticidad no compensa la otra: se recorta a lo que se puede resolver
  // en esa criticidad (P0/P1: efectivo + mes 3, que cuenta para el cumplimiento, Q-06).
  const resolvedReported = { p0p1: resP0, p2p3: resP2, total: safeSum('resolved', resP0, resP2) };
  const rP0 = Math.min(resP0, effP0 + m3);
  const rP2 = Math.min(resP2, effP2);
  const resolvedToDate = { p0p1: rP0, p2p3: rP2, total: rP0 + rP2 };
  const pendP0 = Math.max(effP0 - rP0, 0);
  const pendP2 = effP2 - rP2;
  const pending = { p0p1: pendP0, p2p3: pendP2, total: pendP0 + pendP2 };
  // Arrastre al cierre: lo no resuelto, incluidas las P0/P1 del mes 3 aún abiertas.
  // No usa carryOver: allí el exceso de resueltos no descuenta las del mes 3 (doble conteo, QA H-01).
  const pendingCarry = effP0 + m3 - rP0 + pendP2;

  const weeksRemaining = Math.max(end - now, 0) / 7;
  const expectedWeeklyPace = weeksRemaining === 0 ? pending.total : pending.total / weeksRemaining;

  /** @param {number} total @returns {MonthlyTarget[]} */
  const targets = (total) =>
    [1, 2, 3].map((i) => ({
      month: addMonths(firstMonth, i - 1),
      cumulativeTarget: i === 3 ? total : ceilTol((total * i) / 3),
    }));
  const monthlyTargets = targets(effectiveTotal.total);
  const monthlyTargetsByCriticality = { p0p1: targets(effP0), p2p3: targets(effP2) };
  const expectedWeeklyPaceByCriticality = {
    p0p1: weeksRemaining === 0 ? pendP0 : pendP0 / weeksRemaining,
    p2p3: weeksRemaining === 0 ? pendP2 : pendP2 / weeksRemaining,
  };

  const p0p1Pct = compliancePct(rP0, effP0);
  const p2p3Pct = compliancePct(rP2, effP2);
  const currentMonthIndex = now > end ? null : monthDiff(firstMonth, asOf.slice(0, 7)) + 1;

  return {
    asOf,
    quarterStart,
    quarterEnd,
    currentMonthIndex,
    effectiveTotal,
    resolvedToDate,
    resolvedReported,
    pending,
    carryToNextQuarter: m3,
    pendingCarry,
    weeksRemaining,
    expectedWeeklyPace,
    expectedWeeklyPaceByCriticality,
    monthlyTargets,
    monthlyTargetsByCriticality,
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
    !(/** @type {any} */ (s).monthlyTargetsByCriticality) ||
    /** @type {any} */ (s).monthlyTargets.length !== 3 ||
    !(/** @type {any} */ (s).effectiveTotal) ||
    !(/** @type {any} */ (s).resolvedToDate) ||
    parseDay(/** @type {any} */ (s).asOf) === null ||
    !finiteCounts(/** @type {any} */ (s).effectiveTotal) ||
    !finiteCounts(/** @type {any} */ (s).resolvedToDate)
  ) {
    throw new TypeError(`${name} debe ser el resultado de packageStatus`);
  }
}

/**
 * Esperado a la fecha según una serie de metas acumuladas.
 * @param {PackageStatus} status
 * @param {MonthlyTarget[]} targets
 * @param {number} total
 * @param {boolean} monthToDate
 */
function expectedAt(status, targets, total, monthToDate) {
  const idx = status.currentMonthIndex;
  if (idx === null) return { expected: total, scope: 'cierre del trimestre' };
  const target = targets[idx - 1];
  if (!monthToDate) return { expected: target.cumulativeTarget, scope: `meta acumulada de ${target.month}` };
  const prev = idx === 1 ? 0 : targets[idx - 2].cumulativeTarget;
  const frac = Number(status.asOf.slice(8, 10)) / daysInMonth(target.month);
  return {
    expected: ceilTol(prev + (target.cumulativeTarget - prev) * frac),
    scope: `avance esperado a ${status.asOf}, mes ${target.month}`,
  };
}

/**
 * @typedef {{ behind: boolean, gap: number, expected: number, resolved: number }} PaceLine
 */

/**
 * Atraso frente al ritmo esperado (alerta "atraso frente al ritmo esperado").
 * Compara lo resuelto con la meta acumulada del mes en curso, en total y por criticidad.
 * - `monthToDate: true` (por defecto): la meta del mes se prorratea por días transcurridos
 *   (asOf cuenta como transcurrido), redondeando hacia arriba.
 * - `monthToDate: false`: se exige la meta acumulada completa del mes en curso.
 * - asOf posterior al trimestre: se exige el total efectivo.
 * - `behind`/`gap`/`expected`/`resolved` son del total; `byCriticality` evalúa P0/P1 y P2/P3
 *   por separado (lo resuelto de una no compensa la otra) y `behindAny` es true si alguna va atrasada.
 * @param {PackageStatus} status
 * @param {{ monthToDate?: boolean }} [options]
 * @returns {PaceLine & { behindAny: boolean, byCriticality: { p0p1: PaceLine, p2p3: PaceLine }, reason: string }}
 */
export function paceStatus(status, { monthToDate = true } = {}) {
  assertStatus(status);
  /** @returns {PaceLine} */
  const line = (expected, resolved) => {
    const gap = Math.max(expected - resolved, 0);
    return { behind: gap > 0, gap, expected, resolved };
  };
  const tot = expectedAt(status, status.monthlyTargets, status.effectiveTotal.total, monthToDate);
  const total = line(tot.expected, status.resolvedToDate.total);
  /** @param {'p0p1' | 'p2p3'} k */
  const crit = (k) => {
    const eff = status.effectiveTotal[k];
    const e = expectedAt(status, status.monthlyTargetsByCriticality[k], eff, monthToDate);
    return line(e.expected, Math.min(status.resolvedToDate[k], eff));
  };
  const byCriticality = { p0p1: crit('p0p1'), p2p3: crit('p2p3') };
  // Si el total va atrasado, alguna criticidad también: las metas por criticidad se redondean
  // hacia arriba por separado (suman >= las del total) y lo resuelto por criticidad está recortado.
  const behindAny = byCriticality.p0p1.behind || byCriticality.p2p3.behind;
  const lagging = [
    byCriticality.p0p1.behind ? `P0/P1 faltan ${byCriticality.p0p1.gap}` : '',
    byCriticality.p2p3.behind ? `P2/P3 faltan ${byCriticality.p2p3.gap}` : '',
  ].filter(Boolean);
  const head = total.behind
    ? `Atraso: ${total.resolved} resueltas frente a ${total.expected} esperadas (${tot.scope}); faltan ${total.gap}`
    : `Al día: ${total.resolved} resueltas frente a ${total.expected} esperadas (${tot.scope})`;
  const reason = lagging.length > 0 ? `${head}. Atraso por criticidad: ${lagging.join('; ')}` : head;
  return { ...total, behindAny, byCriticality, reason };
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
