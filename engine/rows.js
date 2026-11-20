// Traducción de filas de la BD a contratos del motor (funciones puras). La usan las
// Actions (scripts/lib/build.js) y el front (V-01): una sola regla.
import { effectiveThresholds } from './commitment.js';
import { quarterOf } from './escalation.js';
import { quarterBounds, monthEnd } from './calendar.js';
import { packageStatus, categoryMonthColor, cumulativeThirds } from './vulnerabilities.js';
import { measure, parseDay } from './measure.js';
import { evaluateColor } from './color.js';

/** Número finito o null (PostgREST devuelve numeric como número; se tolera texto). */
export const num = (v) => {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
  else return null; // null, undefined, '', '  ', arreglos, booleanos u objetos (H-M06-02)
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
 * mediciones. Filtra fechas fuera del trimestre o posteriores a asOf (el motor las rechaza) y
 * descarta las filas malformadas (H-M06-01), que cuenta en `discarded` (M-08, A7).
 * @param {{ indicator: any, commitment: any, measurements: any[], asOf: string }} input
 * @returns {{ ok: true, input: any, discarded: number } | { ok: false, reason: string }}
 */
export function buildPackageInput({ indicator, commitment, measurements, asOf }) {
  const { quarter, start, end } = quarterBounds(asOf.slice(0, 7));
  const pkg = commitment?.package_by_category;
  if (!pkg || typeof pkg !== 'object') {
    return { ok: false, reason: `Sin paquete por criticidad (package_by_category) para ${quarter}` };
  }
  // H-M06-02: una clave presente con valor no numérico ([], false, ' ') no se toma como 0.
  for (const k of ['P0P1', 'P2P3']) {
    if (Object.hasOwn(pkg, k) && pkg[k] !== null && num(pkg[k]) === null) {
      return { ok: false, reason: `Paquete por criticidad inválido para ${quarter}: ${k} no es un número` };
    }
  }
  // M-08 (A7): el descarte por fila (H-M06-01) vive aquí para que la evaluación mensual, el
  // ritmo diario y el ritmo del front compartan el mismo filtro.
  const { kept, discarded } = splitMalformed(measurements ?? [], asOf);
  const rows = kept.filter((r) => r.measured_on >= start && r.measured_on <= asOf && r.measured_on <= end);
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
    discarded,
  };
}

/** Nota del motivo cuando buildPackageInput descartó filas malformadas. */
export function discardedNote(discarded) {
  return `${discarded} medición(es) descartada(s) por categoría o valor inválido`;
}

const CATEGORY_KEYS = Object.freeze(['P0P1', 'P2P3']);

/**
 * H-M06-01: separa las mediciones que el cálculo por criticidad no puede usar: resueltas con
 * categoría distinta de P0P1/P2P3 o valor no entero >= 0, y detectadas P0/P1 con valor no
 * entero >= 0. Solo cuenta como descartadas las del trimestre hasta asOf (las demás ya las
 * ignora buildPackageInput). Las resueltas sin valor se siguen ignorando sin contarlas.
 * @param {any[]} measurements
 * @param {string} asOf
 */
function splitMalformed(measurements, asOf) {
  const { start, end } = quarterBounds(asOf.slice(0, 7));
  const kept = [];
  let discarded = 0;
  for (const r of measurements) {
    const inScope = r.measured_on >= start && r.measured_on <= asOf && r.measured_on <= end;
    const n = num(r.value);
    const okCount = Number.isSafeInteger(n) && n >= 0;
    let bad = false;
    if (r.kind === 'detected') bad = r.category === 'P0P1' && !okCount;
    else if (isResolved(r) && r.value !== null && r.value !== undefined) {
      bad = !CATEGORY_KEYS.includes(r.category) || !okCount;
    }
    if (bad) {
      if (inScope) discarded += 1;
    } else kept.push(r);
  }
  return { kept, discarded };
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
  // H-M06-01: una fila malformada (cargada por API) se descarta sola en buildPackageInput y se
  // cuenta en el motivo; no anula el mes (un "sin evaluar" reiniciaría la racha de escalada).
  const built = buildPackageInput({ indicator, commitment, measurements: measurements ?? [], asOf });
  if (!built.ok) return notEvaluated(built.reason);
  const { discarded } = built;
  const pkg = commitment.package_by_category;
  const packageCategories = Object.keys(pkg).filter((k) => num(pkg[k]) !== null);
  /** @type {Record<string, number>} */
  const sampleSizes = {};
  for (const r of built.input.resolved) sampleSizes[r.criticality] = (sampleSizes[r.criticality] ?? 0) + 1;
  try {
    const status = packageStatus(built.input);
    const { cfg } = indicatorConfig(indicator, commitment);
    const r = categoryMonthColor(cfg, status, { packageCategories, sampleSizes });
    if (discarded === 0) return r;
    return { ...r, reason: `${r.reason}; ${discardedNote(discarded)}`, discarded };
  } catch (err) {
    return notEvaluated(`No se pudo calcular el cumplimiento por criticidad: ${err.message}`);
  }
}

// Movidas desde scripts/lib/build.js (M-07): la pantalla de metas muestra el color con la
// misma regla que la evaluación mensual.

/**
 * Mediciones del motor. Orden estable por fecha y creación (M-01: el desempate de
 * cobertura depende del orden).
 * @param {any[]} rows
 */
export function toEngineMeasurements(rows) {
  return [...rows]
    .sort((a, b) =>
      a.measured_on === b.measured_on
        ? String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
        : a.measured_on < b.measured_on
          ? -1
          : 1,
    )
    .map((r) => ({
      date: r.measured_on,
      value: num(r.value) ?? undefined,
      appId: r.app_id ?? undefined,
      compliant: r.compliant ?? undefined,
      category: r.category ?? undefined,
    }));
}

/** Días de a hasta b ('YYYY-MM-DD'). */
const daysBetween = (a, b) => parseDay(b) - parseDay(a);

/**
 * Color de un indicador para una unidad en el mes evaluado (cierre del mes).
 * - `cumulative_target` con categorías (M-06): por criticidad con el paquete del compromiso
 *   trimestral (`packageCommitment`) y los umbrales de cada categoría; no usa `targets`.
 * - `cumulative_target` sin categorías: solo lo resuelto dentro del trimestre del mes, contra
 *   la meta acumulada del mes (`targets`).
 * - resto: ventana del indicador terminada el último día del mes.
 * @param {{ indicator: any, commitment?: any, packageCommitment?: any, measurements: any[], target?: any,
 *   evalMonth: string }} input
 * @returns {{ color: string, value: number|null, sampleSize: number, reason: string }}
 */
export function evaluateIndicatorMonth({
  indicator,
  commitment = null,
  packageCommitment = commitment,
  measurements,
  target = null,
  evalMonth,
}) {
  if (hasCategoryEvaluation(indicator)) {
    const r = evaluateCategoryMonth({ indicator, commitment: packageCommitment, measurements, month: evalMonth });
    return { color: r.color, value: r.value, sampleSize: r.sampleSize, reason: r.reason };
  }
  const { cfg, thresholdSource, note } = indicatorConfig(indicator, commitment);
  const asOf = monthEnd(evalMonth);
  let rows = measurements.filter((r) => r.measured_on <= asOf);
  /** @type {{ asOf: string, target?: number|null }} */
  const opts = { asOf };
  if (cfg.measurementType === 'cumulative_target') {
    const { start } = quarterBounds(evalMonth);
    rows = rows.filter((r) => r.measured_on >= start && isResolved(r));
    // El acumulado es del trimestre: la ventana debe cubrir desde su día 1 (Q3 y Q4 tienen
    // 92 días; con window_days = 90 el motor descartaría el 1 de julio o de octubre).
    const quarterDays = daysBetween(start, asOf) + 1;
    if (quarterDays > cfg.windowDays) cfg.windowDays = quarterDays;
    opts.target = num(target?.target_value);
  }
  const measured = measure(cfg, toEngineMeasurements(rows), opts);
  const { color, reason } = evaluateColor(cfg, measured);
  const parts = [reason];
  if (thresholdSource === 'commitment') parts.push('umbral del compromiso');
  if (note) parts.push(note);
  return { color, value: measured.value, sampleSize: measured.sampleSize, reason: parts.join('; ') };
}

/**
 * M-07: true si el color mensual del indicador se mide contra `targets` (meta acumulada sin
 * categorías). Los de meta acumulada con categorías (VULN) usan el paquete por criticidad.
 * @param {any} indicator fila de `indicators`
 */
export function usesMonthlyTargets(indicator) {
  return indicator?.measurement_type === 'cumulative_target' && !hasCategoryEvaluation(indicator);
}

/**
 * M-07, "Proponer un tercio": meta ACUMULADA del mes desde el paquete del compromiso
 * trimestral (`package_total`) con la regla del motor (cumulativeThirds: un tercio, dos
 * tercios y el total; redondeo hacia arriba en los meses 1 y 2). Es la misma serie que
 * packageStatus.monthlyTargets y la de la semilla. No lanza: sin compromiso trimestral o sin
 * paquete devuelve el motivo.
 * @param {{ commitments: any[], unitId: string, indicatorId: string, month: string }} input
 * @returns {{ ok: true, value: number, quarter: string, monthIndex: number, packageTotal: number, explanation: string }
 *   | { ok: false, reason: string }}
 */
export function proposeThirdTarget({ commitments, unitId, indicatorId, month }) {
  let bounds;
  try {
    bounds = quarterBounds(month);
  } catch {
    return { ok: false, reason: `Mes inválido: ${String(month)} (usa AAAA-MM)` };
  }
  const { quarter, months } = bounds;
  const c = quarterCommitment(commitments, unitId, indicatorId, month);
  if (!c) return { ok: false, reason: `Sin compromiso trimestral (${quarter}) para proponer la meta` };
  const total = num(c.package_total);
  if (total === null || total < 0) {
    return { ok: false, reason: `El compromiso de ${quarter} no tiene paquete total para proponer la meta` };
  }
  const i = months.indexOf(month);
  const value = cumulativeThirds(total)[i];
  const share = ['un tercio', 'dos tercios', 'el total'][i];
  return {
    ok: true,
    value,
    quarter,
    monthIndex: i + 1,
    packageTotal: total,
    explanation: `Propuesta para ${month} (mes ${i + 1} de ${quarter}): ${share} del paquete de ${total}, acumulado: ${value}.`,
  };
}
