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
          .select('id, unit_id, scope, expires_on')
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
