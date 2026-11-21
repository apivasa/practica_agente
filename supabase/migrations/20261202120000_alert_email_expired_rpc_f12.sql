-- F-12 (H-ARQ-C06-04, aditiva): marcado `expired` y su auditoría en una sola transacción.
--
-- Antes, scripts/lib/email.js marcaba las alertas fuera de la ventana con un UPDATE y luego
-- insertaba sus filas `alert_email_skipped` en audit_log con otra petición: si la segunda
-- fallaba, quedaban alertas marcadas sin auditoría. Esta función hace las dos cosas en una
-- sola sentencia (CTE con UPDATE ... RETURNING e INSERT), así que o quedan las dos o
-- ninguna.
--
-- Sin tablas nuevas, sin cambios de columnas: no es destructiva.
--
-- Seguridad:
--   * SECURITY INVOKER (por defecto): el único invocador es el backend (service_role), que
--     ya tiene UPDATE en alerts e INSERT en audit_log (20261130120000, 20261201120000) y
--     se salta RLS. No hace falta elevar privilegios.
--   * search_path vacío y nombres calificados.
--   * EXECUTE solo para service_role: se revoca de PUBLIC, anon y authenticated (el
--     default de Postgres concede EXECUTE a PUBLIC) y se concede explícito a service_role
--     (lección de P-05: el proyecto hospedado no concede privilegios por defecto).
--   * La función repite las condiciones de la consulta de vencidas (sin correo, sin
--     omisión, sent_at < p_before, intentos < p_max_attempts): aunque reciba ids de más,
--     solo marca alertas realmente vencidas y abiertas. Es idempotente: una segunda
--     llamada no marca ni audita nada.
--
-- Devuelve los ids que esta llamada marcó (y auditó).

create or replace function public.mark_alerts_email_expired(
  p_ids uuid[],
  p_before timestamptz,
  p_max_attempts integer,
  p_skipped_at timestamptz,
  p_lookback_days integer
)
returns table (alert_id uuid)
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_ids is null or p_before is null or p_max_attempts is null
     or p_skipped_at is null or p_lookback_days is null then
    raise exception 'mark_alerts_email_expired: parámetros nulos' using errcode = '22004';
  end if;
  if cardinality(p_ids) > 1000 then
    raise exception 'mark_alerts_email_expired: más de 1000 ids por llamada' using errcode = '22023';
  end if;
  if p_max_attempts < 1 or p_lookback_days < 1 or p_lookback_days > 365 then
    raise exception 'mark_alerts_email_expired: intentos o días fuera de rango' using errcode = '22023';
  end if;

  return query
  with marked as (
    update public.alerts as a
       set email_skipped_at = p_skipped_at,
           email_skip_reason = 'expired'
     where a.id = any (p_ids)
       and a.emailed_at is null
       and a.email_skipped_at is null
       and a.email_attempts < p_max_attempts
       and a.sent_at < p_before
    returning a.id as m_id, a.kind as m_kind, a.unit_id as m_unit_id,
              a.recipient_user_id as m_recipient, a.sent_at as m_sent_at,
              a.email_attempts as m_attempts
  ),
  audited as (
    insert into public.audit_log (actor, action, entity, entity_id, details)
    select 'system:alert-email', 'alert_email_skipped', 'alerts', m.m_id::text,
           jsonb_build_object(
             'kind', m.m_kind,
             'unit_id', m.m_unit_id,
             'recipient_user_id', m.m_recipient,
             'reason', 'expired',
             'sent_at', m.m_sent_at,
             'attempts', coalesce(m.m_attempts, 0),
             'lookback_days', p_lookback_days
           )
      from marked as m
    returning entity_id
  )
  select au.entity_id::uuid from audited as au;
end;
$$;

comment on function public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer) is
  'F-12: marca como omitidas (expired) las alertas vencidas y abiertas, y audita cada una en la misma transacción. Solo service_role.';

revoke all on function public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)
  to service_role;
