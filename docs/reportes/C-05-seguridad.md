# C-05 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: workflow `correo-alertas.yml` (schedule + `workflow_dispatch` sin inputs, `environment: produccion`, `contents: read`) con `SUPABASE_SECRET_KEY` y el secreto nuevo `RESEND_API_KEY`; `scripts/send-alert-emails.js` + `scripts/lib/email.js` (envío a `api.resend.com`, `Idempotency-Key` por alerta, auditoría `alert_emailed` / `alert_email_failed`); `auth.admin.getUserById` en `scripts/lib/db.js` (correos de usuarios, solo backend); `engine/alert-email.js` (asunto, texto y HTML del correo); columnas `alerts.emailed_at` y `alerts.email_attempts` (migración `20261129120000_alert_email_c05.sql`). Modelo de amenazas: sección "Superficie nueva (C-05)", T-C05-01..07.

Pruebas de seguridad añadidas:
- `tests/security/automation-c05.test.js` — 35 casos.
  - Cat. 5 (workflow): 6. Solo schedule/dispatch sin inputs ni datos del evento; `contents: read` sin permisos por job; `environment: produccion`; solo los secretos `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `RESEND_API_KEY`, siempre en `env:`; `RESEND_API_KEY` solo en el paso que envía; `npm ci --ignore-scripts --omit=dev` sin secretos; todos los pasos con la guarda; sin `echo` de secretos ni xtrace; `persist-credentials: false`.
  - Cat. 2/6 (API admin y Resend solo en backend): 3. `src/`, `engine/`, `index.html` y `dist/` sin `auth.admin`, `getUserById`, `/auth/v1/admin`, Resend ni claves `re_`. `getUserById` solo en `scripts/lib/db.js` y en la integración local, esta con guarda de host antes de crear el cliente y sin llamadas a Resend.
  - Cat. 3 (inyección): 15. 8 cargas XSS en tipo, unidad y mensaje (solo quedan las etiquetas de la plantilla y ningún `on*=` dentro de una etiqueta); CR/LF, `Bcc:`, U+2028, bidi, NUL y U+0085 en el asunto; enlace solo https sin credenciales y escapado en el atributo; campos ajenos del payload que no salen; `isEmailAddress`, `isValidFrom` y `readEmailConfig` contra separadores y saltos.
  - Cat. 1/8 (aislamiento): 4. Dos unidades, cada correo a su líder con solo su unidad, un único `to`, sin `cc`/`bcc`/`reply_to`; destinatario tomado de `recipient_user_id`, nunca del payload; `recipient_user_id` no UUID (`&or=`, `../admin/users`) sin consulta a Auth ni envío; correo de Auth con `\r\nBcc:` sin envío.
  - Cat. 2/8 (fugas): 7. Resend devuelve la clave y el correo en el error (422 y 500), errores de red y de Auth con la clave o el correo: nada llega a logs ni a `audit_log`; `provider_id` de una línea y acotado; `sanitizeError`; `runEmailStep` con configuración inválida; proceso hijo real de `send-alert-emails.js` contra `127.0.0.1:9` y sin `RESEND_API_KEY`.
- `tests/security/api/alert-email-c05.test.js` — 5 casos contra PostgREST y GoTrue locales.
  - Cat. 1: los 7 usuarios de rol × 6 cuerpos PATCH sobre su propia alerta (`emailed_at` = now/null, `email_attempts` = 0/99, `read_at` + columna de correo) → 401/403, y el backend confirma que nada cambió. Anónimo sin lectura ni escritura. El líder de Alfa no ve ni filtra (`eq`, `or=`, `is.null`) el estado de correo de Beta.
  - Cat. 2/8: `/auth/v1/admin/users/<id>` (lo que usa `getUserById`) con cada token de usuario y con la clave publicable → denegado y sin correos en la respuesta. `auth.users` no se expone por PostgREST y `user_roles` no trae correos.
- `supabase/tests/security/052_security_alert_email_c05.test.sql` — 20 casos pgTAP.
  - Cat. 1/8, catálogo: el UPDATE de `authenticated` en `alerts` sigue siendo exactamente `{read_at}`; sin UPDATE de tabla, INSERT ni DELETE; anon sin nada; `alerts` conserva 2 políticas y RLS; `auth.users` sin SELECT para `authenticated` ni `anon`; ninguna función ejecutable por usuarios en `public`/`private` lee `auth.users`.
  - Cat. 1/8, comportamiento: `read_at` + `emailed_at`/`email_attempts` → 42501; el líder A no silencia el correo de B, no crea alertas para B, no ve ni filtra el estado de correo de B y no lee `auth.users`; sí marca `read_at`; el estado de correo queda intacto.

Resultados del pipeline (commit c4544c4, que incluye estas pruebas):
- Seguridad [run 44856679716](https://github.com/apivasa/practica_agente/actions/runs/44856679716): todo verde.
  - gitleaks (historial completo) ✔, semgrep ✔, npm audit (producción) ✔, CodeQL javascript y actions ✔.
  - Pruebas de seguridad ✔: 709 pass, 0 fail, 0 skipped.
  - Pentest API ✔ (5/5 casos C-05).
  - DAST (e2e de seguridad + ZAP baseline) ✔.
- CI [run 44856679812](https://github.com/apivasa/practica_agente/actions/runs/44856679812): `052_security_alert_email_c05` ok y la integración ✔. Dos fallos que no son de la app:
  - `build`: `no-control-regex` en la línea 209 de `tests/security/automation-c05.test.js`. Era de esta revisión y está corregido en el commit del informe con un `eslint-disable-next-line` justificado: la prueba busca justamente caracteres de control, igual que `engine/alert-email.js`.
  - `db`: `supabase/tests/121_qa_c05.test.sql:49` ("WITH clause containing a data-modifying statement must be at the top level"). Es una prueba del tester y queda para él.

Hallazgos (ninguno crítico, alto ni medio):
- H-C05-01 · Baja · 8 · Datos personales.
  - Dónde: `scripts/lib/email.js` `sendAlertEmails`, `scripts/lib/db.js` `userEmail`.
  - Qué pasa: el correo sale aunque el destinatario haya perdido su rol o su unidad dentro de la ventana de 7 días, o esté bloqueado en Auth (`banned_until`). Hoy ya ve esa alerta en la bandeja (`alerts_select` por `recipient_user_id`); el correo saca el dato fuera de la app.
  - Cómo reproducir: crear una alerta de Alfa para `lider1`, borrar su fila de `user_roles` y correr el envío: el correo sale.
  - Corrección: antes de enviar, comprobar que el rol sigue vigente y que la cuenta no está bloqueada; si no, auditar `alert_email_skipped` y no reintentar.
  - Estado: registrado en `docs/seguridad/hallazgos.md` y propuesto como ítem.
- H-C05-02 · Info · 2/8.
  - Qué pasa: `sanitizeError` no redacta `sb_secret_…` ni JWT. Sin impacto hoy: GitHub enmascara el log y supabase-js no repite la clave.
  - Corrección: añadir esos patrones al saneo.
- H-C05-03 · Info · 5.
  - Qué pasa: `environment: produccion` (regla de ramas `main`) solo protege `RESEND_API_KEY` si el secreto se crea en el environment y no en el repositorio.
  - Corrección: al crearlo (compuerta de la usuaria, Q-04), usar *Environments → produccion* y una clave de Resend de solo envío.

Verificado sin hallazgos:
- 1 (RLS y grants de `emailed_at`/`email_attempts`; IDOR entre unidades en `alerts`).
- 2 (claves solo en backend y en `env:`; API admin de Auth inaccesible con tokens de usuario y con la clave publicable; sin claves legadas).
- 3 (HTML escapado; sin inyección de cabeceras en asunto, remitente ni destinatario; URL solo https; Resend recibe JSON).
- 4 (front y `dist/` sin API admin ni Resend).
- 5 (permisos mínimos, acciones por SHA, sin inputs ni datos del evento, guarda `EVALUATION_ENABLED`, sin `pull_request_target`; las pruebas genéricas de `workflows.test.js` y las de despliegue ya cubren el workflow nuevo).
- 6 (gitleaks, semgrep, CodeQL, npm audit; sin dependencias nuevas).
- 8 (auditoría de cada envío y fallo, solo con ids y sin correos; idempotencia por `emailed_at` e `Idempotency-Key`).
- 7: ZAP baseline sin cambios, porque el front no cambia salvo una reexportación de etiquetas.
