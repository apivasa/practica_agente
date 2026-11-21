// F-13 (QA): simulación en memoria de la RPC `mark_alerts_email_expired` (F-12) para las BD
// simuladas de las pruebas de correo. Reproduce la migración
// supabase/migrations/20261202120000_alert_email_expired_rpc_f12.sql:
// - marca `email_skipped_at`/`email_skip_reason = 'expired'` solo si la alerta sigue abierta
//   (emailed_at y email_skipped_at nulos), con intentos < p_max_attempts y sent_at < p_before;
// - en la misma "transacción" (síncrona, sin await intermedio) inserta una fila
//   `alert_email_skipped` por alerta marcada en audit_log, con los mismos `details`;
// - devuelve los ids marcados; parámetros nulos o fuera de rango lanzan como la RPC.
// Desde F-13 runEmailStep exige este método (fail-closed) y sendAlertEmails no tiene otra
// ruta para `expired`.

const ACTOR = 'system:alert-email';

/**
 * Añade `markAlertsEmailExpired` a una BD simulada con `alerts` y `audit_log` en `db.tables`
 * (fake-db.js) o en `db.t` (BD de email-c05/c06).
 * @param {any} db
 * @param {{ onCall?: (ids: string[], opts: any) => void, now?: () => string }} [opts]
 */
export function withExpiredRpc(db, { onCall, now = () => '2030-01-01T00:00:00.000Z' } = {}) {
  const t = db.tables ?? db.t;
  db.markAlertsEmailExpired = async (ids, { before, maxAttempts, skippedAt, lookbackDays } = {}) => {
    onCall?.(ids, { before, maxAttempts, skippedAt, lookbackDays });
    if (ids == null || before == null || maxAttempts == null || skippedAt == null || lookbackDays == null) {
      throw new Error('mark_alerts_email_expired: parámetros nulos');
    }
    if (ids.length > 1000) throw new Error('mark_alerts_email_expired: más de 1000 ids por llamada');
    if (maxAttempts < 1 || lookbackDays < 1 || lookbackDays > 365) {
      throw new Error('mark_alerts_email_expired: intentos o días fuera de rango');
    }
    const marked = [];
    for (const a of t.alerts) {
      if (!ids.includes(a.id)) continue;
      if ((a.emailed_at ?? null) !== null || (a.email_skipped_at ?? null) !== null) continue;
      if ((Number(a.email_attempts) || 0) >= maxAttempts) continue;
      if (!(Date.parse(a.sent_at) < Date.parse(before))) continue;
      a.email_skipped_at = skippedAt;
      a.email_skip_reason = 'expired';
      marked.push(a);
    }
    for (const a of marked) {
      t.audit_log.push({
        id: t.audit_log.length + 1,
        created_at: now(),
        actor: ACTOR,
        action: 'alert_email_skipped',
        entity: 'alerts',
        entity_id: a.id,
        details: {
          kind: a.kind,
          unit_id: a.unit_id,
          recipient_user_id: a.recipient_user_id,
          reason: 'expired',
          sent_at: a.sent_at,
          attempts: Number(a.email_attempts) || 0,
          lookback_days: lookbackDays,
        },
      });
    }
    return marked.map((a) => a.id);
  };
  return db;
}
