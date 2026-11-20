// M-07: lógica pura de la pantalla de metas mensuales (`targets`). Sin DOM ni red. La regla
// de la propuesta (un tercio) y el color son del motor (engine/rows.js): aquí solo se valida
// el formulario y se arman las filas de la tabla.
import {
  evaluateIndicatorMonth, pickCommitment, proposeThirdTarget, quarterBounds, quarterCommitment,
  monthEnd, usesMonthlyTargets,
} from '../../engine/index.js';
import { parseNumberField } from './indicator-form.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Tope de la meta: evita valores absurdos (la BD solo exige >= 0). */
export const TARGET_MAX = 1e12;

/** Indicadores activos que se miden contra `targets`, por código. */
export function targetIndicators(indicators) {
  return (indicators ?? [])
    .filter((i) => i.active !== false && usesMonthlyTargets(i))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

/** Normaliza y valida el mes 'AAAA-MM'. */
export function parseMonth(text) {
  const month = String(text ?? '').trim();
  return MONTH_RE.test(month) ? { ok: true, month } : { ok: false, error: 'Mes: usa el formato AAAA-MM (ej. 2026-10)' };
}

/** Rango de mediciones que necesita el color del mes: del día 1 del trimestre al cierre del mes. */
export function measurementsRange(month) {
  return { from: quarterBounds(month).start, to: monthEnd(month) };
}

/**
 * Valida el formulario y arma los campos de la meta.
 * @param {{ month: string, value: string }} values
 * @returns {{ ok: true, fields: { month: string, target_value: number } } | { ok: false, errors: string[] }}
 */
export function buildTargetFields(values) {
  const errors = [];
  const m = parseMonth(values?.month);
  if (!m.ok) errors.push(m.error);
  const n = parseNumberField(values?.value);
  if (n === null) errors.push('Meta acumulada del mes: es obligatoria');
  else if (Number.isNaN(n) || n < 0) errors.push('Meta acumulada del mes: debe ser un número mayor o igual que 0');
  else if (n > TARGET_MAX) errors.push('Meta acumulada del mes: el valor es demasiado grande');
  if (errors.length) return { ok: false, errors };
  return { ok: true, fields: { month: m.month, target_value: n } };
}

/**
 * Filas de la tabla del mes: por unidad, la meta guardada, el paquete del trimestre, la
 * propuesta de un tercio y el color del mes con la meta (misma regla que la evaluación
 * mensual: engine/evaluateIndicatorMonth). Es una vista previa: el color oficial lo guarda
 * la evaluación programada.
 * @param {{ indicator: any, units: any[], targets: any[], commitments: any[], measurements: any[], month: string }} input
 */
export function targetRows({ indicator, units, targets, commitments, measurements, month }) {
  return [...(units ?? [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((unit) => {
      const target = (targets ?? []).find((t) => t.unit_id === unit.id && t.indicator_id === indicator.id && t.month === month) ?? null;
      const pkg = quarterCommitment(commitments ?? [], unit.id, indicator.id, month);
      const proposal = proposeThirdTarget({ commitments: commitments ?? [], unitId: unit.id, indicatorId: indicator.id, month });
      let evaluation;
      try {
        evaluation = evaluateIndicatorMonth({
          indicator,
          commitment: pickCommitment(commitments ?? [], unit.id, indicator.id, month),
          packageCommitment: pkg,
          measurements: (measurements ?? []).filter((r) => r.unit_id === unit.id && r.indicator_id === indicator.id),
          target,
          evalMonth: month,
        });
      } catch (err) {
        evaluation = { color: 'not_evaluated', value: null, sampleSize: 0, reason: `No se pudo calcular: ${err.message}` };
      }
      return { unit, target, packageTotal: pkg?.package_total ?? null, proposal, evaluation };
    });
}
