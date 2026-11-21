-- Privilegios explícitos del backend (service_role, clave secreta sb_secret_...).
--
-- La CLI de Supabase local concede ALL a service_role por privilegios por
-- defecto; el proyecto hospedado (Data API sin grants automáticos) no, y en
-- producción `ritmo-diario` falló con "permission denied for table commitments".
-- Esta migración es aditiva e idempotente: concede solo lo que usan
--   * scripts/evaluate.js y scripts/lib/db.js (lectura de catálogo y datos,
--     upsert de evaluations, upsert de alerts, insert/select de audit_log),
--   * scripts/send-alert-emails.js (C-05: select/update de alerts.emailed_at y
--     email_attempts),
--   * scripts/health y el pentest S-05 / pentest-api (fixtures: alta, cambio y
--     borrado de filas de prueba en las tablas de negocio).
-- No toca anon ni authenticated. Sin TRUNCATE en ninguna tabla (se revoca:
-- ignora RLS y ningún script lo necesita). audit_log sigue append-only: solo SELECT e INSERT.
-- No se conceden funciones: el backend no invoca RPC; las funciones de trigger
-- no exigen EXECUTE al invocador en tiempo de ejecución, y las de private que
-- usan las políticas ya tienen EXECUTE para service_role (rls_policies, c02).

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.units, public.user_roles, public.indicators, public.commitments,
  public.measurements, public.targets, public.evaluations, public.exceptions,
  public.alerts
to service_role;

-- La CLI local concede TRUNCATE por defecto; se quita para que local y
-- producción coincidan (TRUNCATE ignora RLS y triggers de fila).
revoke truncate, references, trigger on
  public.units, public.user_roles, public.indicators, public.commitments,
  public.measurements, public.targets, public.evaluations, public.exceptions,
  public.alerts
from service_role;

grant select, insert on public.audit_log to service_role;
-- Defensa: aunque algún default los hubiera concedido, audit_log es inmutable.
revoke update, delete, truncate on public.audit_log from service_role;

-- Secuencia del id bigserial de audit_log (los demás ids son uuid).
grant usage, select on sequence public.audit_log_id_seq to service_role;
