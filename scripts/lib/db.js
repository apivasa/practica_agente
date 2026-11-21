// Capa delgada de acceso a datos (supabase-js con la clave secreta del backend).
// Solo consultas y escrituras; ninguna regla de negocio.

const PAGE = 1000;

/** Error legible sin detalles de conexión ni claves. */
function fail(what, error) {
  const e = new Error(`${what}: ${error.message ?? String(error)}`);
  e.cause = error;
  return e;
}

/**
 * Lee todas las páginas de una consulta (PostgREST limita filas por respuesta).
 * @param {string} what
 * @param {(from: number, to: number) => PromiseLike<{ data: any[] | null, error: any }>} query
 */
async function fetchAll(what, query) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw fail(what, error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Divide un arreglo en trozos (evita URLs demasiado largas en filtros `in`). */
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @returns {import('./run.js').Db}
 */
export function createDb(sb) {
  return {
    units: () => fetchAll('units', (a, b) => sb.from('units').select('id, name').order('name').order('id').range(a, b)),
    indicators: () =>
      fetchAll('indicators', (a, b) =>
        sb
          .from('indicators')
          .select(
            'id, code, measurement_type, direction, window_days, green_threshold, yellow_threshold, thresholds_by_category, frequency, min_sample, source',
          )
          .eq('active', true)
          .order('code')
          .range(a, b),
      ),
    userRoles: () =>
      fetchAll('user_roles', (a, b) =>
        sb.from('user_roles').select('user_id, role, unit_id').in('role', ['unit_leader', 'committee']).order('id').range(a, b),
      ),
    commitments: (periods) =>
      fetchAll('commitments', (a, b) =>
        sb
          .from('commitments')
          .select('unit_id, indicator_id, period, green_override, yellow_override, package_total, package_by_category')
          .in('period', periods)
          .order('id')
          .range(a, b),
      ),
    targets: (month) =>
      fetchAll('targets', (a, b) =>
        sb.from('targets').select('unit_id, indicator_id, month, target_value').eq('month', month).order('id').range(a, b),
      ),
    measurements: ({ indicatorIds, from, to }) =>
      fetchAll('measurements', (a, b) =>
        sb
          .from('measurements')
          .select('unit_id, indicator_id, measured_on, value, app_id, compliant, category, kind, created_at')
          .in('indicator_id', indicatorIds)
          .gte('measured_on', from)
          .lte('measured_on', to)
          .order('measured_on')
          .order('created_at')
          .order('id')
          .range(a, b),
      ),
    evaluations: (months) =>
      fetchAll('evaluations', (a, b) =>
        sb
          .from('evaluations')
          .select('id, unit_id, indicator_id, month, color, value, sample_size, reason, escalation_level, restrictions')
          .in('month', months)
          .order('id')
          .range(a, b),
      ),
    exceptions: ({ expiresFrom }) =>
      fetchAll('exceptions', (a, b) =>
        sb
          .from('exceptions')
          .select('id, unit_id, scope, change_ref, expires_on, revoked_at')
          .gte('expires_on', expiresFrom)
          .order('expires_on')
          .order('id')
          .range(a, b),
      ),
    async upsertEvaluations(rows) {
      const out = [];
      for (const part of chunks(rows, 500)) {
        const { data, error } = await sb
          .from('evaluations')
          .upsert(
            part.map((r) => ({ ...r, evaluated_at: new Date().toISOString() })),
            { onConflict: 'unit_id,indicator_id,month' },
          )
          .select('id, unit_id, indicator_id, month, color, escalation_level, restrictions');
        if (error) throw fail('evaluations upsert', error);
        out.push(...(data ?? []));
      }
      return out;
    },
    async insertAlerts(rows) {
      const out = [];
      for (const part of chunks(rows, 500)) {
        const { data, error } = await sb
          .from('alerts')
          .upsert(part, { onConflict: 'dedupe_key', ignoreDuplicates: true })
          .select('id, unit_id, recipient_user_id, kind, payload, dedupe_key');
        if (error) throw fail('alerts insert', error);
        out.push(...(data ?? []));
      }
      return out;
    },
    async insertAudit(rows) {
      for (const part of chunks(rows, 500)) {
        const { error } = await sb.from('audit_log').insert(part);
        if (error) throw fail('audit_log insert', error);
      }
    },
    // C-05: alertas aún sin correo, recientes y con intentos disponibles.
    pendingEmailAlerts: ({ since, maxAttempts }) =>
      fetchAll('alerts pendientes de correo', (a, b) =>
        sb
          .from('alerts')
          .select('id, unit_id, recipient_user_id, kind, payload, sent_at, email_attempts')
          .is('emailed_at', null)
          .is('email_skipped_at', null)
          .lt('email_attempts', maxAttempts)
          .gte('sent_at', since)
          .order('sent_at')
          .order('id')
          .range(a, b),
      ),
    // C-05: correo del destinatario con la API admin de Auth (solo backend, clave secreta).
    async userEmail(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw fail('auth.admin.getUserById', error);
      return data?.user?.email ?? null;
    },
    // C-06: correo, bloqueo y roles vigentes del destinatario. null si el usuario no existe.
    async recipientAccess(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) {
        if (error.status === 404) return null;
        throw fail('auth.admin.getUserById', error);
      }
      const user = data?.user;
      if (!user) return null;
      const { data: roles, error: e2 } = await sb.from('user_roles').select('role, unit_id').eq('user_id', userId);
      if (e2) throw fail('user_roles del destinatario', e2);
      return {
        email: user.email ?? null,
        bannedUntil: user.banned_until ?? null,
        deletedAt: user.deleted_at ?? null,
        roles: roles ?? [],
      };
    },
    // C-06: alertas sin correo ni omisión cuyo sent_at quedó fuera de la ventana (un lote).
    async expiredEmailAlerts({ before, maxAttempts, limit }) {
      const { data, error } = await sb
        .from('alerts')
        .select('id, unit_id, recipient_user_id, kind, sent_at, email_attempts')
        .is('emailed_at', null)
        .is('email_skipped_at', null)
        .lt('email_attempts', maxAttempts)
        .lt('sent_at', before)
        .order('sent_at')
        .order('id')
        .limit(limit);
      if (error) throw fail('alerts fuera de la ventana', error);
      return data ?? [];
    },
    // C-06: marca condicional de omisión; devuelve los ids que esta corrida marcó.
    async markAlertsEmailSkipped(ids, { skippedAt, reason }) {
      const out = [];
      for (const part of chunks(ids, 100)) {
        const { data, error } = await sb
          .from('alerts')
          .update({ email_skipped_at: skippedAt, email_skip_reason: reason })
          .in('id', part)
          .is('emailed_at', null)
          .is('email_skipped_at', null)
          .select('id');
        if (error) throw fail('alerts email_skipped_at', error);
        out.push(...(data ?? []).map((r) => r.id));
      }
      return out;
    },
    // F-12 (H-ARQ-C06-04): marca `expired` y audita en una sola transacción (RPC
    // public.mark_alerts_email_expired, solo service_role). Devuelve los ids marcados.
    async markAlertsEmailExpired(ids, { before, maxAttempts, skippedAt, lookbackDays }) {
      const { data, error } = await sb.rpc('mark_alerts_email_expired', {
        p_ids: ids,
        p_before: before,
        p_max_attempts: maxAttempts,
        p_skipped_at: skippedAt,
        p_lookback_days: lookbackDays,
      });
      if (error) throw fail('mark_alerts_email_expired', error);
      return (data ?? []).map((r) => r?.alert_id).filter((id) => typeof id === 'string');
    },
    // C-05: marca condicional (emailed_at is null). Devuelve true si esta corrida la marcó.
    async markAlertEmailed(id, { emailedAt, attempts }) {
      const { data, error } = await sb
        .from('alerts')
        .update({ emailed_at: emailedAt, email_attempts: attempts })
        .eq('id', id)
        .is('emailed_at', null)
        .is('email_skipped_at', null)
        .select('id');
      if (error) throw fail('alerts emailed_at', error);
      return (data ?? []).length > 0;
    },
    async recordAlertEmailFailure(id, { attempts }) {
      const { error } = await sb
        .from('alerts')
        .update({ email_attempts: attempts })
        .eq('id', id)
        .is('emailed_at', null);
      if (error) throw fail('alerts email_attempts', error);
    },
    async paceSnapshots(entityIds, quarter) {
      const out = [];
      for (const ids of chunks(entityIds, 50)) {
        out.push(
          ...(await fetchAll('audit_log pace_snapshot', (a, b) =>
            sb
              .from('audit_log')
              .select('entity_id, details, created_at')
              .eq('action', 'pace_snapshot')
              .eq('entity', 'pace')
              .eq('actor', 'system:evaluate')
              .eq('details->>quarter', quarter)
              .in('entity_id', ids)
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(a, b),
          )),
        );
      }
      return out;
    },
  };
}
