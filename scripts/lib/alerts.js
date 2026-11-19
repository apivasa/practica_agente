// C-04: decisión de alertas (funciones puras). Cada alerta lleva una `dedupe_key`
// única por disparador y destinatario: insertar dos veces la misma alerta no la duplica.
import { exceptionFromRow, exceptionStatus } from '../../engine/index.js';

export const ALERT_KINDS = Object.freeze(['color_change', 'pace_behind', 'critical_intake', 'exception_expired']);

const COLOR_ES = { green: 'verde', yellow: 'amarillo', red: 'rojo', not_evaluated: 'sin evaluar' };
const LEVEL_ES = { normal: 'normal', restricted: 'restringida', frozen: 'congelada', exception: 'en excepción' };

/**
 * Destinatarios de una unidad: sus líderes (user_roles) y todo el comité, sin repetidos.
 * @param {string} unitId
 * @param {{ user_id: string, role: string, unit_id: string|null }[]} roles
 * @returns {string[]}
 */
export function recipientsFor(unitId, roles) {
  const ids = new Set();
  for (const r of roles) {
    if ((r.role === 'unit_leader' && r.unit_id === unitId) || r.role === 'committee') ids.add(r.user_id);
  }
  return [...ids].sort();
}

/**
 * Una alerta por destinatario.
 * @param {{ kind: string, unitId: string, key: string, payload: object, recipients: string[] }} a
 */
function fanOut({ kind, unitId, key, payload, recipients }) {
  if (!ALERT_KINDS.includes(kind)) throw new TypeError(`Tipo de alerta desconocido: ${kind}`);
  return recipients.map((recipient) => ({
    unit_id: unitId,
    recipient_user_id: recipient,
    kind,
    payload,
    dedupe_key: `${kind}:${key}:${recipient}`,
  }));
}

/**
 * Cambio de color mensual de la unidad (o del nivel de candado con el mismo color, p. ej.
 * rojo en mes 2 que congela). Sin evaluación previa, un verde no alerta.
 * @param {{ unit: { id: string, name: string }, evalMonth: string,
 *   current: { color: string, level: string, restrictions: string[], reason: string },
 *   previous: { color: string, level: string|null } | null,
 *   indicatorChanges?: object[], recipients: string[] }} input
 */
export function colorChangeAlerts({ unit, evalMonth, current, previous, indicatorChanges = [], recipients }) {
  const prevColor = previous?.color ?? 'not_evaluated';
  const prevLevel = previous?.level ?? null;
  const colorChanged = prevColor !== current.color;
  const levelChanged = previous !== null && prevLevel !== current.level;
  if (!colorChanged && !levelChanged) return [];
  if (previous === null && current.color === 'green') return [];
  const message = colorChanged
    ? `${unit.name}: el color pasó de ${COLOR_ES[prevColor]} a ${COLOR_ES[current.color]} en ${evalMonth}. Unidad ${LEVEL_ES[current.level]}.`
    : `${unit.name}: sigue en ${COLOR_ES[current.color]} en ${evalMonth} y la unidad pasa de ${LEVEL_ES[prevLevel] ?? prevLevel} a ${LEVEL_ES[current.level]}.`;
  return fanOut({
    kind: 'color_change',
    unitId: unit.id,
    key: `${unit.id}:${evalMonth}:${current.color}:${current.level}`,
    recipients,
    payload: {
      month: evalMonth,
      unit_name: unit.name,
      previous_color: prevColor,
      color: current.color,
      previous_level: prevLevel,
      level: current.level,
      restrictions: current.restrictions,
      reason: current.reason,
      indicator_changes: indicatorChanges,
      severity: current.color === 'red' || current.level === 'frozen' ? 'high' : 'normal',
      message,
    },
  });
}

/**
 * Atraso frente al ritmo esperado (usa `behindAny`, decisión de M-05). Solo alerta al pasar
 * de "al día" a "atrasada" (o la primera vez en el trimestre): no repite cada día.
 * @param {{ unit: { id: string, name: string }, indicator: { id: string, code: string }, asOf: string,
 *   quarter: string, pace: any, previousBehind: boolean | null, recipients: string[] }} input
 */
export function paceAlerts({ unit, indicator, asOf, quarter, pace, previousBehind, recipients }) {
  if (!pace.behindAny || previousBehind === true) return [];
  return fanOut({
    kind: 'pace_behind',
    unitId: unit.id,
    key: `${unit.id}:${indicator.id}:${asOf}`,
    recipients,
    payload: {
      as_of: asOf,
      quarter,
      unit_name: unit.name,
      indicator_code: indicator.code,
      gap: pace.gap,
      expected: pace.expected,
      resolved: pace.resolved,
      by_criticality: pace.byCriticality,
      reason: pace.reason,
      severity: 'normal',
      message: `${unit.name}: ${indicator.code} va atrasado frente al ritmo esperado. ${pace.reason}.`,
    },
  });
}

/**
 * Ingreso de P0/P1 que recalcula la meta. La clave incluye el nuevo total efectivo: el mismo
 * recálculo nunca alerta dos veces, aunque el estado previo se pierda.
 * @param {{ unit: { id: string, name: string }, indicator: { id: string, code: string }, asOf: string,
 *   quarter: string, recalc: any, recipients: string[] }} input
 */
export function intakeAlerts({ unit, indicator, asOf, quarter, recalc, recipients }) {
  if (!recalc.targetChanged || recalc.delta <= 0) return [];
  return fanOut({
    kind: 'critical_intake',
    unitId: unit.id,
    key: `${unit.id}:${indicator.id}:${quarter}:${recalc.newTotal}`,
    recipients,
    payload: {
      as_of: asOf,
      quarter,
      unit_name: unit.name,
      indicator_code: indicator.code,
      delta: recalc.delta,
      previous_total: recalc.previousTotal,
      new_total: recalc.newTotal,
      previous_pace: recalc.previousPace,
      new_pace: recalc.newPace,
      reason: recalc.reason,
      severity: 'normal',
      message: `${unit.name}: ${recalc.reason}.`,
    },
  });
}

/**
 * Excepciones que vencen hoy (último día vigente) o ya vencieron.
 * @param {{ exceptions: any[], asOf: string, units: Map<string, { id: string, name: string }>,
 *   recipientsByUnit: (unitId: string) => string[] }} input
 */
export function exceptionAlerts({ exceptions, asOf, units, recipientsByUnit }) {
  return exceptions.flatMap((ex) => {
    if (ex.expires_on > asOf) return [];
    // C-02: una revocada ya no rige; no se avisa su vencimiento.
    if (exceptionStatus(exceptionFromRow(ex), asOf) === 'revoked') return [];
    const state = ex.expires_on === asOf ? 'expires_today' : 'expired';
    const unit = units.get(ex.unit_id) ?? { id: ex.unit_id, name: ex.unit_id };
    const message =
      state === 'expires_today'
        ? `${unit.name}: la excepción del comité vence hoy (${ex.expires_on}).`
        : `${unit.name}: la excepción del comité venció el ${ex.expires_on}; vuelven a regir los candados.`;
    return fanOut({
      kind: 'exception_expired',
      unitId: ex.unit_id,
      key: `${ex.id}:${state}`,
      recipients: recipientsByUnit(ex.unit_id),
      payload: {
        as_of: asOf,
        exception_id: ex.id,
        unit_name: unit.name,
        scope: ex.scope,
        expires_on: ex.expires_on,
        state,
        severity: 'normal',
        message,
      },
    });
  });
}
