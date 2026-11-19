-- C-04 (aditiva): idempotencia de alertas y tipos cerrados (ADR 0005, pendientes C-03/C-04).
-- Sin tablas nuevas: RLS y privilegios de alerts no cambian. authenticated sigue sin INSERT
-- y solo puede actualizar read_at; dedupe_key la escribe el backend.

-- Una alerta por disparador y destinatario: la clave la arma scripts/lib/alerts.js
-- (<kind>:<disparador>:<destinatario>). Nula en filas anteriores a C-04.
alter table public.alerts
  add column dedupe_key text
    check (dedupe_key is null or length(trim(dedupe_key)) > 0);

alter table public.alerts
  add constraint alerts_dedupe_key_unique unique (dedupe_key);

-- Disparadores del diseño (sección Alertas).
alter table public.alerts
  add constraint alerts_kind_allowed
    check (kind in ('color_change', 'pace_behind', 'critical_intake', 'exception_expired'));

-- Lectura de snapshots diarios del ritmo (scripts/lib/db.js, paceSnapshots).
create index audit_log_action_entity_idx on public.audit_log (action, entity, entity_id);
