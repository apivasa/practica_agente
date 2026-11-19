// C-03/C-04: orquestación de la evaluación mensual y del ritmo diario.
// Recibe la capa de datos (`db`) por parámetro: las pruebas usan una BD en memoria.
import { packageStatus, paceStatus, recalculateOnNewCritical } from '../../engine/index.js';
import { addMonths, monthEnd, quarterBounds, addDays } from './dates.js';
import {
  pickCommitment,
  evaluateIndicatorMonth,
  evaluateUnitMonth,
  monthToClose,
  buildPackageInput,
  baselineInput,
  expiredSince,
} from './build.js';
import { recipientsFor, colorChangeAlerts, paceAlerts, intakeAlerts, exceptionAlerts } from './alerts.js';

export const ACTOR = 'system:evaluate';

/**
 * @typedef {Object} Db
 * @property {() => Promise<any[]>} units
 * @property {() => Promise<any[]>} indicators Solo activos.
 * @property {() => Promise<any[]>} userRoles
 * @property {(periods: string[]) => Promise<any[]>} commitments
 * @property {(month: string) => Promise<any[]>} targets
 * @property {(q: { indicatorIds: string[], from: string, to: string }) => Promise<any[]>} measurements
 * @property {(months: string[]) => Promise<any[]>} evaluations
 * @property {(q: { expiresFrom: string }) => Promise<any[]>} exceptions
 * @property {(rows: any[]) => Promise<any[]>} upsertEvaluations Devuelve filas con id.
 * @property {(rows: any[]) => Promise<any[]>} insertAlerts Ignora duplicados por dedupe_key; devuelve solo las nuevas.
 * @property {(rows: any[]) => Promise<void>} insertAudit
 * @property {(entityIds: string[], quarter: string) => Promise<any[]>} paceSnapshots Filas de audit_log action='pace_snapshot'.
 */

const evalKey = (unitId, indicatorId, month) => `${unitId}|${indicatorId ?? ''}|${month}`;

/** JSON con claves ordenadas: jsonb no conserva el orden de las claves. */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const sameArray = (a, b) => JSON.stringify([...(a ?? [])]) === JSON.stringify([...(b ?? [])]);

/** ¿La fila nueva difiere de la guardada? (para no reescribir ni auditar lo mismo). */
function evaluationChanged(prev, next) {
  if (!prev) return true;
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return (
    prev.color !== next.color ||
    n(prev.value) !== n(next.value) ||
    Number(prev.sample_size) !== Number(next.sample_size) ||
    (prev.reason ?? null) !== (next.reason ?? null) ||
    (prev.escalation_level ?? null) !== (next.escalation_level ?? null) ||
    !sameArray(prev.restrictions, next.restrictions)
  );
}

/** Inserta alertas y audita las que realmente se crearon (incluido el vencimiento de excepciones). */
async function sendAlerts(db, alerts, context) {
  if (alerts.length === 0) return [];
  const inserted = await db.insertAlerts(alerts);
  const audit = inserted.map((a) => ({
    actor: ACTOR,
    action: 'alert_sent',
    entity: 'alerts',
    entity_id: a.id,
    details: { ...context, kind: a.kind, unit_id: a.unit_id, recipient_user_id: a.recipient_user_id, dedupe_key: a.dedupe_key },
  }));
  const expired = new Map();
  for (const a of inserted) {
    if (a.kind === 'exception_expired' && a.payload?.state === 'expired') expired.set(a.payload.exception_id, a);
  }
  for (const [id, a] of expired) {
    audit.push({
      actor: ACTOR,
      action: 'exception_expired',
      entity: 'exceptions',
      entity_id: id,
      details: { ...context, unit_id: a.unit_id, expires_on: a.payload.expires_on, scope: a.payload.scope },
    });
  }
  if (audit.length > 0) await db.insertAudit(audit);
  return inserted;
}

/**
 * Evaluación mensual: cierra el mes anterior al de asOf.
 * @param {Db} db
 * @param {{ asOf: string, log?: (msg: string) => void }} options
 */
export async function runMonthly(db, { asOf, log = () => {} }) {
  const evalMonth = monthToClose(asOf);
  const prevMonth = addMonths(evalMonth, -1);
  const { quarter, months: quarterMonths } = quarterBounds(evalMonth);
  const context = { mode: 'monthly', as_of: asOf, month: evalMonth };

  const [units, indicators, roles, commitments, targets, stored, exceptions] = await Promise.all([
    db.units(),
    db.indicators(),
    db.userRoles(),
    db.commitments([evalMonth, quarter]),
    db.targets(evalMonth),
    db.evaluations([...new Set([...quarterMonths.filter((m) => m <= evalMonth), prevMonth])]),
    db.exceptions({ expiresFrom: addDays(asOf, -40) }),
  ]);
  const maxWindow = Math.max(90, ...indicators.map((i) => Number(i.window_days) || 0));
  const to = monthEnd(evalMonth);
  const measurements = indicators.length
    ? await db.measurements({ indicatorIds: indicators.map((i) => i.id), from: addDays(to, -maxWindow), to })
    : [];

  const storedByKey = new Map(stored.map((e) => [evalKey(e.unit_id, e.indicator_id, e.month), e]));
  const rows = [];
  const pending = [];
  const errors = [];

  for (const unit of units) {
    try {
      const indicatorRows = [];
      for (const ind of indicators) {
        const r = evaluateIndicatorMonth({
          indicator: ind,
          commitment: pickCommitment(commitments, unit.id, ind.id, evalMonth),
          measurements: measurements.filter((m) => m.unit_id === unit.id && m.indicator_id === ind.id),
          target: targets.find((t) => t.unit_id === unit.id && t.indicator_id === ind.id) ?? null,
          evalMonth,
        });
        indicatorRows.push({
          unit_id: unit.id,
          indicator_id: ind.id,
          month: evalMonth,
          color: r.color,
          value: r.value,
          sample_size: r.sampleSize,
          reason: r.reason,
          escalation_level: null,
          restrictions: [],
        });
      }
      const storedColors = {};
      for (const m of quarterMonths) {
        const e = storedByKey.get(evalKey(unit.id, null, m));
        if (e && m < evalMonth) storedColors[m] = e.color;
      }
      const { color, escalation } = evaluateUnitMonth({
        evalMonth,
        asOf,
        indicatorColors: indicatorRows.map((r) => r.color),
        storedColors,
        exceptions: exceptions.filter((e) => e.unit_id === unit.id),
      });
      const unitRow = {
        unit_id: unit.id,
        indicator_id: null,
        month: evalMonth,
        color,
        value: null,
        sample_size: indicatorRows.filter((r) => r.color !== 'not_evaluated').length,
        reason: escalation.reason,
        escalation_level: escalation.level,
        restrictions: escalation.restrictions,
      };
      const prevUnit = storedByKey.get(evalKey(unit.id, null, prevMonth)) ?? null;
      const indicatorChanges = indicatorRows
        .map((r) => ({ r, p: storedByKey.get(evalKey(unit.id, r.indicator_id, prevMonth)) }))
        .filter(({ r, p }) => p && p.color !== r.color)
        .map(({ r, p }) => ({ indicator_id: r.indicator_id, previous_color: p.color, color: r.color }));
      rows.push(...indicatorRows, unitRow);
      pending.push(
        ...colorChangeAlerts({
          unit,
          evalMonth,
          current: { color, level: escalation.level, restrictions: escalation.restrictions, reason: escalation.reason },
          previous: prevUnit ? { color: prevUnit.color, level: prevUnit.escalation_level } : null,
          indicatorChanges,
          recipients: recipientsFor(unit.id, roles),
        }),
      );
      log(`${unit.name}: ${color} (${escalation.level})`);
    } catch (err) {
      errors.push(`${unit.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const changed = rows.filter((r) => evaluationChanged(storedByKey.get(evalKey(r.unit_id, r.indicator_id, r.month)), r));
  let written = [];
  if (changed.length > 0) {
    written = await db.upsertEvaluations(changed);
    await db.insertAudit(
      written.map((w) => {
        const prev = storedByKey.get(evalKey(w.unit_id, w.indicator_id, w.month));
        return {
          actor: ACTOR,
          action: w.indicator_id === null ? 'escalation_applied' : 'evaluation_upsert',
          entity: 'evaluations',
          entity_id: w.id,
          details: {
            ...context,
            unit_id: w.unit_id,
            indicator_id: w.indicator_id,
            previous_color: prev?.color ?? null,
            color: w.color,
            previous_level: prev?.escalation_level ?? null,
            level: w.escalation_level,
            restrictions: w.restrictions,
          },
        };
      }),
    );
  }
  const alerts = await sendAlerts(db, pending, context);
  return { mode: 'monthly', asOf, month: evalMonth, evaluations: rows.length, written: written.length, alerts: alerts.length, errors };
}

/**
 * Ritmo diario: atraso frente al ritmo, ingreso de P0/P1 y vencimiento de excepciones.
 * @param {Db} db
 * @param {{ asOf: string, log?: (msg: string) => void }} options
 */
export async function runDaily(db, { asOf, log = () => {} }) {
  const { quarter, start } = quarterBounds(asOf.slice(0, 7));
  const context = { mode: 'daily', as_of: asOf };
  const [units, allIndicators, roles, commitments, exceptions] = await Promise.all([
    db.units(),
    db.indicators(),
    db.userRoles(),
    db.commitments([quarter]),
    db.exceptions({ expiresFrom: expiredSince(asOf) }),
  ]);
  const indicators = allIndicators.filter((i) => i.measurement_type === 'cumulative_target');
  const measurements = indicators.length
    ? await db.measurements({ indicatorIds: indicators.map((i) => i.id), from: start, to: asOf })
    : [];
  const entityIds = units.flatMap((u) => indicators.map((i) => `${u.id}:${i.id}`));
  const snapshots = entityIds.length ? await db.paceSnapshots(entityIds, quarter) : [];
  const unitsById = new Map(units.map((u) => [u.id, u]));

  const pending = [];
  const audit = [];
  const errors = [];

  for (const unit of units) {
    for (const ind of indicators) {
      const commitment = commitments.find(
        (c) => c.unit_id === unit.id && c.indicator_id === ind.id && c.period === quarter,
      );
      if (!commitment) continue;
      try {
        const built = buildPackageInput({
          indicator: ind,
          commitment,
          measurements: measurements.filter((m) => m.unit_id === unit.id && m.indicator_id === ind.id),
          asOf,
        });
        if (!built.ok) {
          log(`${unit.name}/${ind.code}: ${built.reason}`);
          continue;
        }
        const status = packageStatus(built.input);
        const pace = paceStatus(status);
        const entityId = `${unit.id}:${ind.id}`;
        const prev = latestSnapshot(snapshots, entityId, quarter, asOf);
        const prevStatus = prev?.details?.status ?? packageStatus(baselineInput(built.input));
        const recalc = recalculateOnNewCritical(prevStatus, status);
        const recipients = recipientsFor(unit.id, roles);
        pending.push(
          ...paceAlerts({ unit, indicator: ind, asOf, quarter, pace, previousBehind: prev ? prev.details.behind_any : null, recipients }),
          ...intakeAlerts({ unit, indicator: ind, asOf, quarter, recalc, recipients }),
        );
        const sameDay = snapshots.filter(
          (s) => s.entity_id === entityId && s.details?.as_of === asOf && s.details?.quarter === quarter,
        );
        const snapshot = { ...context, quarter, behind_any: pace.behindAny, status };
        const fingerprint = stableStringify(status);
        if (!sameDay.some((s) => stableStringify(s.details?.status) === fingerprint && s.details?.behind_any === pace.behindAny)) {
          audit.push({ actor: ACTOR, action: 'pace_snapshot', entity: 'pace', entity_id: entityId, details: snapshot });
        }
        log(`${unit.name}/${ind.code}: ${pace.reason}`);
      } catch (err) {
        errors.push(`${unit.name}/${ind.code}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  pending.push(
    ...exceptionAlerts({
      exceptions,
      asOf,
      units: unitsById,
      recipientsByUnit: (unitId) => recipientsFor(unitId, roles),
    }),
  );
  if (audit.length > 0) await db.insertAudit(audit);
  const alerts = await sendAlerts(db, pending, context);
  return { mode: 'daily', asOf, snapshots: audit.length, alerts: alerts.length, errors };
}

/**
 * Último snapshot del mismo trimestre con fecha anterior a asOf (el del mismo día no cuenta:
 * así correr dos veces el mismo día compara contra el mismo estado previo).
 * @param {any[]} snapshots
 * @param {string} entityId
 * @param {string} quarter
 * @param {string} asOf
 */
export function latestSnapshot(snapshots, entityId, quarter, asOf) {
  let best = null;
  for (const s of snapshots) {
    const d = s.details;
    if (s.entity_id !== entityId || !d || d.quarter !== quarter || typeof d.as_of !== 'string' || d.as_of >= asOf) continue;
    if (!best || d.as_of > best.details.as_of || (d.as_of === best.details.as_of && String(s.created_at) > String(best.created_at))) {
      best = s;
    }
  }
  return best;
}
