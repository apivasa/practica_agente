-- C-05 (aditiva): registro de envío por correo de cada alerta (Resend, desde Actions).
-- Sin tablas nuevas: RLS de alerts no cambia. authenticated sigue con UPDATE solo sobre
-- read_at (grant por columna): no puede marcar ni desmarcar un correo como enviado.
-- Estas columnas las escribe solo el backend (scripts/send-alert-emails.js, clave secreta).

-- emailed_at: momento en que Resend aceptó el correo. Nula = pendiente. El envío la fija
-- con `where emailed_at is null`, así correr dos veces no reenvía.
-- email_attempts: intentos (éxitos y fallos). Con 3 fallos deja de reintentarse.
alter table public.alerts
  add column emailed_at timestamptz,
  add column email_attempts smallint not null default 0
    check (email_attempts between 0 and 100);

-- Lectura de pendientes (scripts/lib/db.js, pendingEmailAlerts).
create index alerts_email_pending_idx on public.alerts (sent_at)
  where emailed_at is null;
