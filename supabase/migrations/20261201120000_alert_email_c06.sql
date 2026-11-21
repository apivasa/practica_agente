-- C-06 (aditiva): alertas cuyo correo se omite a propósito (H-C05-01, QA-C05-1).
-- Sin tablas nuevas. Una alerta se omite si su destinatario perdió el rol o la unidad,
-- está bloqueado en Auth o ya no existe (recipient_*), o si salió de la ventana de envío
-- sin haberse enviado (expired). Omitida no se reintenta; cada omisión queda en audit_log
-- (`alert_email_skipped`, actor system:alert-email). Solo el backend escribe estas columnas
-- (scripts/send-alert-emails.js, clave secreta).

alter table public.alerts
  add column email_skipped_at timestamptz,
  add column email_skip_reason text;

alter table public.alerts
  add constraint alerts_email_skip_reason_allowed
    check (email_skip_reason in ('expired', 'recipient_missing', 'recipient_banned', 'recipient_no_role')),
  add constraint alerts_email_skip_pair
    check ((email_skipped_at is null) = (email_skip_reason is null)),
  add constraint alerts_email_sent_or_skipped
    check (emailed_at is null or email_skipped_at is null);

-- RLS de alerts no cambia (sigue activado; se reafirma por claridad).
alter table public.alerts enable row level security;

-- authenticated sigue con UPDATE solo sobre read_at (grant por columna de rls_policies):
-- no recibe UPDATE en las columnas nuevas. Defensa explícita por si un default lo hubiera dado.
revoke update (email_skipped_at, email_skip_reason) on public.alerts from authenticated;
revoke all on public.alerts from anon;

-- Backend (lección de #52: el proyecto hospedado no concede privilegios por defecto).
-- El grant de tabla ya cubre las columnas nuevas; se repite explícito e idempotente.
grant select, update on public.alerts to service_role;
grant select on public.user_roles to service_role;
grant select, insert on public.audit_log to service_role;
