// V-01, V-02, V-03: lógica pura de los tableros (sin DOM ni red). El cálculo de
// negocio (color, ritmo, umbrales efectivos) es del motor; aquí solo se agregan
// filas para mostrarlas. El armado de entradas del motor desde filas de la BD es el de
// engine/rows.js, el mismo que usan las Actions: no se duplica.
import {
  packageStatus, paceStatus, exceptionFromRow, exceptionStatus,
  buildPackageInput, indicatorConfig, pickCommitment, addMonths, monthEnd,
  hasCategoryEvaluation, evaluateCategoryMonth, quarterCommitment, discardedNote, lockToday,
} from '../../engine/index.js';

export const COLOR_LABELS = Object.freeze({
  green: 'Verde', yellow: 'Amarillo', red: 'Rojo', not_evaluated: 'Sin evaluar',
});
export const LEVEL_LABELS = Object.freeze({
  normal: 'Operación normal', restricted: 'Restringida', frozen: 'Congelada', exception: 'En excepción',
});
export const RESTRICTION_LABELS = Object.freeze({
  no_new_change: 'No se inicia change nuevo',
  no_backlog_additions: 'No se agrega al backlog',
  prioritize_run: 'Capacidad dedicada al RUN',
  freeze_all_change: 'Se frena todo el change',
  all_capacity_to_run: 'Toda la capacidad va al RUN',
});
export const ALERT_KIND_LABELS = Object.freeze({
  color_change: 'Cambio de color',
  pace_behind: 'Atraso frente al ritmo',
  critical_intake: 'Ingreso de P0/P1',
  exception_expired: 'Vencimiento de excepción',
});
// V-09: las etiquetas de alcance son las de la pantalla de excepciones (una sola fuente).
export { SCOPE_LABELS, scopeLabel } from './exceptions-logic.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const label = (map, key) => (typeof key === 'string' && own(map, key) ? map[key] : String(key ?? '—'));

export const colorLabel = (c) => label(COLOR_LABELS, c ?? 'not_evaluated');
export const levelLabel = (l) => (l ? label(LEVEL_LABELS, l) : '—');
export const restrictionLabel = (r) => label(RESTRICTION_LABELS, r);
export const alertKindLabel = (k) => label(ALERT_KIND_LABELS, k);
/** Clave de color segura para usar como clase CSS. */
export const colorKey = (c) => (typeof c === 'string' && own(COLOR_LABELS, c) ? c : 'not_evaluated');

/** true si el texto es un mes 'YYYY-MM'. */
export const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);

/** Número con hasta 2 decimales (coma decimal, sin separador de miles), o '—'. */
export function formatNumber(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-EC', { maximumFractionDigits: 2, useGrouping: false });
}

/** Meses con evaluación, del más reciente al más antiguo, sin repetir. */
export function evaluatedMonths(evaluations) {
  return [...new Set((evaluations ?? []).map((e) => e?.month).filter(isMonth))].sort().reverse();
}

/** Mes más reciente con evaluación, o null. */
export const latestMonth = (evaluations) => evaluatedMonths(evaluations)[0] ?? null;

/**
 * Mes a mostrar: el pedido si es un mes evaluado o el mes en curso; si no, el más reciente
 * evaluado; si no hay evaluaciones, el mes anterior a hoy (el que cierra la mensual).
 * @param {string|null} requested
 * @param {string[]} evaluated meses evaluados (más reciente primero)
 * @param {string} today 'YYYY-MM-DD'
 */
export function pickMonth(requested, evaluated, today) {
  const current = today.slice(0, 7);
  if (isMonth(requested) && (evaluated.includes(requested) || requested === current)) return requested;
  return evaluated[0] ?? addMonths(current, -1);
}

/** Opciones del filtro de mes: los evaluados y el mes en curso, del más reciente al más antiguo. */
export function monthOptions(evaluated, today) {
  return [...new Set([...evaluated, today.slice(0, 7)])].filter(isMonth).sort().reverse();
}

/**
 * Fecha de referencia del ritmo para un mes: hoy si es el mes en curso; si no, el cierre del
 * mes (avance al último día del mes mostrado).
 */
export function paceAsOf(month, today) {
  return month === today.slice(0, 7) ? today : monthEnd(month);
}

/**
 * Excepciones vigentes a `today` según el motor (exceptionStatus: no vencidas ni revocadas),
 * las más próximas a vencer primero. Filas inválidas se descartan.
 * @param {any[]} exceptions filas de public.exceptions
 * @param {string} today 'YYYY-MM-DD'
 */
export function activeExceptions(exceptions, today) {
  const active = (row) => {
    try {
      return exceptionStatus(exceptionFromRow(row), today) === 'active';
    } catch {
      return false;
    }
  };
  return (exceptions ?? [])
    .filter(active)
    .sort((a, b) => (a.expires_on === b.expires_on ? 0 : a.expires_on < b.expires_on ? -1 : 1));
}

/**
 * V-08: candado vigente hoy de la unidad con el motor (engine/lock.js#lockToday): historial
 * del trimestre desde las evaluaciones guardadas y excepciones tal como están hoy. Añade el
 * texto "Inicio autorizado: REF" por cada inicio puntual con la unidad congelada (ADR 0003).
 * @param {{ unitId: string, evaluations: any[], exceptions: any[], today: string }} input
 */
export function unitLockToday({ unitId, evaluations, exceptions, today }) {
  let lock;
  try {
    lock = lockToday({ unitId, evaluations, exceptions, today });
  } catch {
    return { ok: false, status: 'invalid', closureMonth: null, reason: 'No se pudo calcular el candado de hoy' };
  }
  if (!lock.ok) return lock;
  const authorizedLabels = lock.authorizedStarts.map((a) => `Inicio autorizado: ${a.change_ref ?? 'sin referencia'}`);
  return { ...lock, authorizedLabels, basis: `Según el cierre de ${lock.closureMonth} y las excepciones vigentes al ${lock.asOf}` };
}

/** Evaluación global (indicator_id null) de una unidad en un mes, o null. */
export function unitEvaluation(evaluations, unitId, month) {
  return (evaluations ?? []).find((e) => e.unit_id === unitId && e.indicator_id === null && e.month === month) ?? null;
}

/** Indicadores a mostrar: los activos más los que tienen evaluación en el mes, por código. */
function shownIndicators(indicators, evaluations, month) {
  const evaluated = new Set((evaluations ?? []).filter((e) => e.month === month && e.indicator_id).map((e) => e.indicator_id));
  return (indicators ?? [])
    .filter((i) => i.active !== false || evaluated.has(i.id))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

/**
 * V-02: matriz unidad × indicador del mes.
 * @param {{ units: any[], indicators: any[], evaluations: any[], month: string }} input
 * @returns {{ columns: any[], rows: { unit: any, global: any, cells: (any|null)[] }[] }}
 */
export function committeeMatrix({ units, indicators, evaluations, month }) {
  const columns = shownIndicators(indicators, evaluations, month);
  const byKey = new Map();
  for (const e of evaluations ?? []) {
    if (e.month === month) byKey.set(`${e.unit_id}|${e.indicator_id ?? ''}`, e);
  }
  const rows = [...(units ?? [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((unit) => ({
      unit,
      global: byKey.get(`${unit.id}|`) ?? null,
      cells: columns.map((ind) => byKey.get(`${unit.id}|${ind.id}`) ?? null),
    }));
  return { columns, rows };
}

/** Texto de la meta de un indicador no acumulado según sus umbrales efectivos. */
function thresholdGoal(indicator, commitment) {
  const { cfg, thresholdSource } = indicatorConfig(indicator, commitment);
  const { green, yellow } = cfg.thresholds;
  if (green === null || green === undefined) return null;
  const op = cfg.direction === 'lower_is_better' ? '≤' : '≥';
  const src = thresholdSource === 'commitment' ? ' (compromiso)' : '';
  return `Verde ${op} ${formatNumber(green)}; amarillo ${op} ${formatNumber(yellow)}${src}`;
}

/**
 * M-06: meta acumulada del mes por criticidad, con el mismo cálculo que la evaluación mensual
 * (engine/evaluateCategoryMonth). Sin paquete: 'Sin meta mensual para <mes>'.
 */
export function categoryGoal({ indicator, commitment, measurements, month }) {
  const r = evaluateCategoryMonth({ indicator, commitment, measurements, month });
  const lines = Object.values(r.byCategory);
  if (!lines.some((l) => l.target !== null)) return `Sin meta mensual para ${month}`;
  const parts = lines.map((l) => (l.target === null ? `${l.label} sin paquete` : `${l.label} ${formatNumber(l.target)}`));
  return `Meta acumulada de ${month}: ${parts.join(' · ')}`;
}

/**
 * Ritmo del paquete trimestral (cumulative_target) a `asOf` con el motor.
 * @returns {null | { ok: true, behindAny: boolean, expected: number, resolved: number, gap: number,
 *   effectiveTotal: number, reason: string } | { ok: false, reason: string }}
 */
export function packagePace({ indicator, commitment, measurements, asOf }) {
  if (indicator.measurement_type !== 'cumulative_target') return null;
  const built = buildPackageInput({ indicator, commitment, measurements, asOf });
  if (!built.ok) return { ok: false, reason: built.reason };
  try {
    const status = packageStatus(built.input);
    const pace = paceStatus(status);
    return {
      ok: true,
      behindAny: pace.behindAny,
      expected: pace.expected,
      resolved: pace.resolved,
      gap: pace.gap,
      effectiveTotal: status.effectiveTotal.total,
      reason: built.discarded > 0 ? `${pace.reason}; ${discardedNote(built.discarded)}` : pace.reason,
      ...(built.discarded > 0 ? { discarded: built.discarded } : {}),
    };
  } catch (err) {
    return { ok: false, reason: `No se pudo calcular el ritmo: ${err.message}` };
  }
}

/**
 * V-01: filas del líder para una unidad y un mes.
 * @param {{ unitId: string, indicators: any[], evaluations: any[], targets: any[], commitments: any[],
 *   measurements: any[], month: string, today: string }} input
 */
export function leaderIndicatorRows({ unitId, indicators, evaluations, targets, commitments, measurements, month, today }) {
  const mineEval = (evaluations ?? []).filter((e) => e.unit_id === unitId && e.month === month);
  const asOf = paceAsOf(month, today);
  return shownIndicators(indicators, mineEval, month).map((indicator) => {
    const ev = mineEval.find((e) => e.indicator_id === indicator.id) ?? null;
    const target = (targets ?? []).find((t) => t.unit_id === unitId && t.indicator_id === indicator.id && t.month === month);
    const commitment = pickCommitment(commitments ?? [], unitId, indicator.id, month);
    const rows = (measurements ?? []).filter((m) => m.unit_id === unitId && m.indicator_id === indicator.id);
    // Paquete, ritmo y meta por criticidad salen del compromiso trimestral, igual que en las
    // Actions (M-06, A1); el compromiso mensual solo aporta umbrales.
    const pkg = quarterCommitment(commitments ?? [], unitId, indicator.id, month);
    let goal;
    if (hasCategoryEvaluation(indicator)) {
      goal = categoryGoal({ indicator, commitment: pkg, measurements: rows, month });
    } else if (indicator.measurement_type === 'cumulative_target') {
      goal = target ? `Meta acumulada de ${month}: ${formatNumber(target.target_value)}` : `Sin meta mensual para ${month}`;
    } else {
      goal = thresholdGoal(indicator, commitment);
    }
    return {
      indicator,
      color: ev?.color ?? 'not_evaluated',
      value: ev?.value ?? null,
      reason: ev?.reason ?? 'Sin evaluación para este mes',
      goal,
      pace: packagePace({ indicator, commitment: pkg, measurements: rows, asOf }),
    };
  });
}

/**
 * Rango de fechas que necesita el líder para el ritmo: desde el inicio del trimestre del mes
 * hasta la fecha de referencia.
 */
export function leaderMeasurementsRange(month, today) {
  const q = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
  const from = `${month.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  return { from, to: paceAsOf(month, today) };
}

/** Texto de un porcentaje de completitud ('Sin unidades' si no aplica). */
export const pctLabel = (pct) => (pct === null || pct === undefined ? 'Sin unidades' : `${pct} %`);

/** Mes mínimo del historial que leen los tableros: 12 meses antes del mes en curso. */
export const HISTORY_MONTHS = 12;
export function historySince(today, months = HISTORY_MONTHS) {
  return addMonths(today.slice(0, 7), -months);
}

/** Meses del tablero de completitud: el actual y el anterior. */
export function completenessMonths(today) {
  const current = today.slice(0, 7);
  return [current, addMonths(current, -1)];
}

/**
 * V-03: completitud por custodio y KPI. Una unidad cuenta como cargada para un indicador si
 * tiene al menos una medición con fecha dentro del mes.
 * @param {{ indicators: any[], units: any[], measurements: any[], month: string,
 *   custodians?: { userId: string, label: string }[] }} input
 * @returns {{ custodianId: string|null, custodian: string, loaded: number, total: number, pct: number|null,
 *   items: { indicator: any, loaded: number, total: number, pct: number|null, missing: string[] }[] }[]}
 */
export function completeness({ indicators, units, measurements, month, custodians = [] }) {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const loaded = new Set();
  for (const m of measurements ?? []) {
    if (typeof m.measured_on === 'string' && m.measured_on >= start && m.measured_on <= end) {
      loaded.add(`${m.indicator_id}|${m.unit_id}`);
    }
  }
  const sortedUnits = [...(units ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const total = sortedUnits.length;
  // Sin unidades no hay nada que medir: pct null (la vista muestra "Sin unidades"), no 100 %.
  const pct = (n, d) => (d === 0 ? null : Math.round((n * 100) / d));
  const labelOf = (id) => (id ? custodians.find((c) => c.userId === id)?.label ?? `usuario ${id.slice(0, 8)}…` : 'Sin custodio');

  const groups = new Map();
  const active = (indicators ?? []).filter((i) => i.active !== false)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  for (const indicator of active) {
    const key = indicator.custodian_user_id ?? null;
    if (!groups.has(key)) groups.set(key, []);
    const missing = sortedUnits.filter((u) => !loaded.has(`${indicator.id}|${u.id}`)).map((u) => u.name);
    const n = total - missing.length;
    groups.get(key).push({ indicator, loaded: n, total, pct: pct(n, total), missing });
  }
  return [...groups.entries()]
    .map(([custodianId, items]) => {
      const sumLoaded = items.reduce((s, i) => s + i.loaded, 0);
      const sumTotal = items.reduce((s, i) => s + i.total, 0);
      return { custodianId, custodian: labelOf(custodianId), loaded: sumLoaded, total: sumTotal, pct: pct(sumLoaded, sumTotal), items };
    })
    .sort((a, b) => a.custodian.localeCompare(b.custodian));
}

/**
 * Alerta para mostrar: tipo, mensaje del payload (texto plano) y fecha.
 * @param {any} a fila de alerts
 */
export function describeAlert(a) {
  const payload = a?.payload && typeof a.payload === 'object' ? a.payload : {};
  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : alertKindLabel(a?.kind);
  return {
    id: a?.id,
    kind: alertKindLabel(a?.kind),
    message,
    sentAt: typeof a?.sent_at === 'string' ? a.sent_at.slice(0, 16).replace('T', ' ') : '',
    read: Boolean(a?.read_at),
    high: payload.severity === 'high',
  };
}
