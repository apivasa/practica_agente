// Traducción de filas de la BD a contratos del motor (funciones puras). La usan las
// Actions (scripts/lib/build.js) y el front (V-01): una sola regla.
import { effectiveThresholds } from './commitment.js';
import { quarterOf } from './escalation.js';
import { quarterBounds } from './calendar.js';

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
