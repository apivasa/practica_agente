// Traducción de filas de la BD a contratos del motor (funciones puras). La usan las
// Actions (scripts/lib/build.js) y el front (V-01): una sola regla.
import { effectiveThresholds } from './commitment.js';
import { quarterOf } from './escalation.js';
import { quarterBounds, monthEnd } from './calendar.js';
import { packageStatus, categoryMonthColor } from './vulnerabilities.js';

/** Número finito o null (PostgREST devuelve numeric como número; se tolera texto). */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Compromiso aplicable a (unidad, indicador, mes): primero el del mes, luego el del trimestre.
 * @param {any[]} commitments
 * @param {string} unitId
 * @param {string} indicatorId
 * @param {string} month 'YYYY-MM'
 */
export function pickCommitment(commitments, unitId, indicatorId, month) {
  const mine = commitments.filter((c) => c.unit_id === unitId && c.indicator_id === indicatorId);
  return mine.find((c) => c.period === month) ?? mine.find((c) => c.period === quarterOf(month)) ?? null;
}

/**
 * Compromiso trimestral (periodo 'YYYY-Qn') de (unidad, indicador) para el trimestre del mes:
 * el que trae el paquete por criticidad, aunque exista además un compromiso mensual.
 * @param {any[]} commitments
 * @param {string} unitId
 * @param {string} indicatorId
 * @param {string} month 'YYYY-MM'
 */
export function quarterCommitment(commitments, unitId, indicatorId, month) {
  const q = quarterOf(month);
  return (commitments ?? []).find((c) => c.unit_id === unitId && c.indicator_id === indicatorId && c.period === q) ?? null;
}

/**
 * Configuración del motor desde una fila de `indicators`, con los umbrales
 * efectivos del compromiso. La regla (override completo y coherente con el
 * sentido; si no, los generales) es la de engine/effectiveThresholds: la misma
 * que muestra el front (M-03, H-1).
 * @param {any} row
 * @param {any} [commitment]
 * @returns {{ cfg: any, thresholdSource: 'commitment' | 'indicator', note?: string }}
 */
export function indicatorConfig(row, commitment = null) {
  const base = {
    measurementType: row.measurement_type,
    direction: row.direction,
    windowDays: row.window_days,
    thresholds: { green: num(row.green_threshold), yellow: num(row.yellow_threshold) },
    thresholdsByCategory: row.thresholds_by_category ?? {},
    frequency: row.frequency,
    minSample: row.min_sample,
    source: row.source,
  };
  let eff;
  try {
    eff = effectiveThresholds(base, commitment);
  } catch {
    // Umbrales generales inválidos y sin override aplicable: el motor lo rechazará al medir.
    return { cfg: base, thresholdSource: 'indicator' };
  }
  const cfg = { ...base, thresholds: { green: eff.green, yellow: eff.yellow } };
  if (eff.overridden) return { cfg, thresholdSource: 'commitment' };
  return eff.reason ? { cfg, thresholdSource: 'indicator', note: eff.reason } : { cfg, thresholdSource: 'indicator' };
}

/** Una medición es "resuelta" si kind es 'resolved' o null (filas anteriores a M-05). */
export const isResolved = (r) => r.kind === 'resolved' || r.kind === null || r.kind === undefined;

/**
 * Entrada de packageStatus (M-05) para una unidad desde el compromiso del trimestre y las
 * mediciones. Filtra fechas fuera del trimestre o posteriores a asOf (el motor las rechaza).
 * @param {{ indicator: any, commitment: any, measurements: any[], asOf: string }} input
 * @returns {{ ok: true, input: any } | { ok: false, reason: string }}
 */
export function buildPackageInput({ indicator, commitment, measurements, asOf }) {
  const { quarter, start, end } = quarterBounds(asOf.slice(0, 7));
  const pkg = commitment?.package_by_category;
  if (!pkg || typeof pkg !== 'object') {
    return { ok: false, reason: `Sin paquete por criticidad (package_by_category) para ${quarter}` };
  }
  const rows = measurements.filter((r) => r.measured_on >= start && r.measured_on <= asOf && r.measured_on <= end);
  const newCritical = rows
    .filter((r) => r.kind === 'detected' && r.category === 'P0P1')
    .map((r) => ({ detectedOn: r.measured_on, count: num(r.value) }));
  const resolved = rows
    .filter((r) => isResolved(r) && r.value !== null)
    .map((r) => ({ resolvedOn: r.measured_on, criticality: r.category, count: num(r.value) }));
  const tbc = indicator.thresholds_by_category ?? {};
  const thresholds = {};
  if (num(tbc.P0P1?.green) !== null) thresholds.p0p1 = num(tbc.P0P1.green);
  if (num(tbc.P2P3?.green) !== null) thresholds.p2p3 = num(tbc.P2P3.green);
  return {
    ok: true,
    input: {
      quarterStart: start,
      quarterEnd: end,
      asOf,
      initialPackage: { p0p1: num(pkg.P0P1) ?? 0, p2p3: num(pkg.P2P3) ?? 0 },
      newCritical,
      resolved,
      thresholds,
    },
  };
}

/**
 * M-06: true si el color mensual del indicador se calcula por criticidad (meta acumulada con
 * `thresholds_by_category` no vacío). Los demás de meta acumulada siguen con `targets`.
 * @param {any} indicator fila de `indicators`
 */
export function hasCategoryEvaluation(indicator) {
  const tbc = indicator?.thresholds_by_category;
  return (
    indicator?.measurement_type === 'cumulative_target' &&
    !!tbc && typeof tbc === 'object' && !Array.isArray(tbc) && Object.keys(tbc).length > 0
  );
}

/**
 * M-06: color de un mes por criticidad desde filas de la BD (compromiso trimestral y
 * mediciones). El paquete y las metas son los de packageStatus al último día del mes; la
 * regla de color es categoryMonthColor. Sin paquete o con datos que el motor rechaza, queda
 * sin evaluar con el motivo (no lanza). La usan la evaluación mensual y la vista del líder.
 * @param {{ indicator: any, commitment: any, measurements: any[], month: string }} input
 * @returns {{ color: string, value: number|null, sampleSize: number, reason: string, month: string,
 *   byCategory: Record<string, any> }}
 */
export function evaluateCategoryMonth({ indicator, commitment, measurements, month }) {
  const asOf = monthEnd(month);
  const notEvaluated = (reason) => ({ color: 'not_evaluated', value: null, sampleSize: 0, reason, month, byCategory: {} });
  const built = buildPackageInput({ indicator, commitment, measurements, asOf });
  if (!built.ok) return notEvaluated(built.reason);
  const pkg = commitment.package_by_category;
  const packageCategories = Object.keys(pkg).filter((k) => num(pkg[k]) !== null);
  /** @type {Record<string, number>} */
  const sampleSizes = {};
  for (const r of built.input.resolved) sampleSizes[r.criticality] = (sampleSizes[r.criticality] ?? 0) + 1;
  try {
    const status = packageStatus(built.input);
    const { cfg } = indicatorConfig(indicator, commitment);
    return categoryMonthColor(cfg, status, { packageCategories, sampleSizes });
  } catch (err) {
    return notEvaluated(`No se pudo calcular el cumplimiento por criticidad: ${err.message}`);
  }
}
