# C-06 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: columnas `alerts.email_skipped_at` / `email_skip_reason` (migración aditiva `20261201120000_alert_email_c06.sql`) que solo escribe el backend; en `scripts/lib/db.js`, `recipientAccess` (API admin de Auth y `user_roles` del destinatario, clave secreta), `expiredEmailAlerts` y `markAlertsEmailSkipped`; auditoría `alert_email_skipped`; `sanitizeError` redacta también `sb_secret_...` y JWT; `APP_URL` con valor por defecto https; check `correo-alertas` en salud. No hay endpoints, vistas ni RPC nuevos para usuarios. Modelo de amenazas: sección "Superficie nueva (C-06)", T-C06-01..05.

Pruebas de seguridad añadidas:
- `tests/security/automation-c06.test.js`: 26 casos. Cat. 1 (autorización, IDOR a nivel de datos): 15, con la ruta real fail-closed (`createDb` implementa los 3 métodos, `send-alert-emails.js` usa `createDb`, el `recipientAccess` real con un líder sin rol no envía, la consulta de roles se limita a `eq user_id`, un 404 se trata como "no existe" y cualquier otro error se propaga, las marcas son condicionales), además de líder de otra unidad, gestora, custodio, bloqueado, inexistente, alerta sin unidad, roles con forma inesperada, lectura fallida sin envío ni omisión, y una alerta enviada que no se puede omitir. Cat. 2/6 (secretos): 9, con 8 entradas para `sanitizeError` (`sb_secret_` en query, en JSON y en cabeceras, JWT legado `service_role`, secretos cerca del corte de 300, repetidos, mezcla con `re_` y correo) y `runEmailStep` con un error de BD que trae la clave sin que llegue al log ni a la auditoría. Cat. 8 (auditoría y datos personales): 2, con las alertas vencidas auditadas por `system:alert-email` sin correos, y las auditorías de omisión sin correos (comprobado también en cada caso de cat. 1).
- `supabase/tests/security/053_security_alert_email_c06.test.sql`: 22 casos pgTAP. Cat. 1: 19. Son el catálogo (UPDATE de `authenticated` solo en `read_at`, sin INSERT de las columnas nuevas, anon sin acceso, solo 2 políticas, ninguna función de usuario que escriba la omisión, ninguna tabla de `public` sin RLS) y, por rol, que líder A no puede usar `read_at` junto con la omisión, ni tocar la alerta de B, ni verla, ni filtrar por `email_skip_reason`, ni hacerse líder de B o comité. Además, líder B no desmarca su omisión, comité y gestora no marcan ni desmarcan, anon no toca nada, el estado queda intacto después y `service_role` no puede omitir una alerta ya enviada. Cat. 8: 3, con `audit_log` sin INSERT de usuarios, append-only para `service_role`, y la falsificación de `alert_email_skipped` por un líder rechazada.
- `.gitleaksignore`: se revisó la entrada del desarrollador `50d96c2…:tests/scripts/email-c06.test.js:jwt:310`. El JWT decodifica a `{"alg":"HS256","typ":"JWT"}.{"sub":"1234"}` con una firma inventada, ya se reemplazó en 847cf6e por uno armado en ejecución, y la huella tiene el formato correcto (commit:archivo:regla:línea). Se añadió `632991f…:tests/scripts/qa-c06.test.js:jwt:309`, el JWT ficticio de las pruebas de QA: decodifica a `{"role":"service_role"}` y la firma es `signatura-ficticia`. Ninguno de los dos es una credencial.

Resultados del pipeline:
- Rama en e58b754 (mis pruebas sobre 847cf6e + informe de arquitectura): Seguridad VERDE, con gitleaks, semgrep, npm audit, CodeQL JS/Actions, tests/security, pentest API (Supabase local) y DAST/ZAP baseline — https://github.com/apivasa/practica_agente/actions/runs/44870189860. En CI, `db (pgTAP)` VERDE (incluye 053 y 122) — https://github.com/apivasa/practica_agente/actions/runs/44870189862. En ese run, `build` sale ROJO solo por pruebas de QA anteriores (`qa-v04`, que no contaba `correo-alertas.yml` en salud ni el runbook, y el TODO `qa-c03`). No es un hallazgo de seguridad y QA lo actualiza en 632991f.
- En 1083d09 (merge de QA), gitleaks salió ROJO por el JWT ficticio de `qa-c06.test.js:309` (https://github.com/apivasa/practica_agente/actions/runs/44870633714). Lo corrige la huella añadida en este commit. Los resultados del push de este informe se ven en `actions/runs?branch=item/C-06`.

Hallazgos:
- H-C06-01 · Baja · cat. 1/8 (fail-open latente) · `scripts/lib/email.js` `sendAlertEmails`, `const useAccess = typeof db.recipientAccess === 'function' && canSkip`. Si la BD que se pasa no tiene `recipientAccess` o `markAlertsEmailSkipped`, el código vuelve sin avisar a C-05 (`userEmail`, sin comprobar rol ni bloqueo) y envía.
  - Cómo reproducir: llamar a `sendAlertEmails` con una BD que tenga `recipientAccess` pero no `markAlertsEmailSkipped` y una alerta de la unidad A dirigida al líder de B. El correo sale.
  - Hoy no es explotable: la ruta real (`send-alert-emails.js` → `createDb`) implementa los tres métodos y `automation-c06.test.js` › "ruta real fail-closed" falla si alguno desaparece.
  - Corrección sugerida: en `runEmailStep` (producción), si falta alguno de los tres métodos, terminar con error de configuración (código 2) sin enviar. Queda registrado en `docs/seguridad/hallazgos.md` y se propone como ítem.
- Recomendación al tester (no es un hallazgo): armar el JWT de `tests/scripts/qa-c06.test.js:309` en ejecución, como hizo el desarrollador en 847cf6e, para no acumular huellas en `.gitleaksignore`.

Cerrados por C-06 (verificados): H-C05-01, el correo a un destinatario sin rol vigente o bloqueado, y H-C05-02, el saneo de `sb_secret_` y JWT.

Verificado sin hallazgos:
- Cat. 1, RLS y privilegios por rol: líder, comité, gestora, anon y `service_role` sobre las columnas de omisión, más IDOR entre unidades.
- Cat. 2, secretos y tokens en errores: la clave legada `service_role` se redacta.
- Cat. 3: no hay entradas nuevas de usuario. Los motivos de omisión los limita un CHECK.
- Cat. 5: `correo-alertas.yml` no cambia. El check de salud solo lee metadatos de runs.
- Cat. 6: gitleaks queda limpio con las huellas revisadas. semgrep, CodeQL y npm audit, verdes.
- Cat. 7: ZAP baseline verde. No hay superficie web nueva.
- Cat. 8: cada omisión y cada vencida queda en `audit_log` (append-only) por `system:alert-email`, con ids y sin correos.

No se probó nada contra producción.
