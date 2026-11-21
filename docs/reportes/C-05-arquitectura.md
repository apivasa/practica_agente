# C-05 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. `docs/diseno.md` § Alertas (Q-04, 2026-11-20) pide "bandeja en la app y correo vía Resend a cada destinatario (las mismas alertas de su bandeja)". El ítem envía un correo por fila de `alerts` a su destinatario, desde GitHub Actions y con un secreto. La bandeja sigue siendo la fuente. No hay servidor propio y no cambia el stack.
Requiere decisión del usuario: no. Lo que falta es compuerta ya registrada: P-09 (`RESEND_API_KEY`, dominio y remitente).
ADR creados o actualizados:
- `docs/adr/0017-correo-de-alertas.md` (nuevo, Aceptado): workflow propio, guarda de producción, formato en el motor, columnas `emailed_at` y `email_attempts`, idempotencia, 3 intentos, ventana de 7 días, remitente por defecto, auditoría y salud.
- `docs/adr/0008-evaluacion-y-alertas.md` punto 7: enmienda C-05, que remite a ADR 0017. Aplica una decisión de la usuaria (Q-04), no es un cambio propio.
- `docs/operacion.md`: fila en la tabla de tiempos y sección «Correo de alertas» (variables y secretos, activación, reintentos, vigilancia con SQL, qué hacer por código HTTP, reencolar, desactivar, restaurar), además de una entrada en «Pendiente de completar».

Salud:
- CI run 44855313117 en 29dc6e0: `success`. Tiempos: build 32 s, db 76 s, integración 95 s (base 69–87 s; el paso nuevo `email-integration.js` añade pocos segundos), e2e 122 s. Todo dentro de la base y por debajo del umbral.
- Seguridad run 44855313076: `success`.
- Los runs cancelados en 2c520ba los canceló la concurrencia al llegar el commit siguiente. No hay intermitencia.
- Workflows programados: sin cambios en `ritmo-diario` ni en `evaluacion-mensual`. `correo-alertas.yml` es nuevo, con guarda de producción: sin `EVALUATION_ENABLED=true` termina en verde sin enviar nada.
- Monitoreo: `correo-alertas.yml` **debe** entrar en la vigilancia de salud (ADR 0017, punto 10). Todavía no está (H-ARQ-C05-01).

## Juicio de las decisiones
1. **Workflow propio en vez de un paso dentro de la evaluación: correcto.** `tests/security/automation-c03.test.js` fija que los dos workflows de evaluación solo ven `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. Además, un fallo de Resend no puede dejar a medias un cierre mensual. El grupo de concurrencia propio sin cancelar es seguro, porque la marca es condicional y lleva `Idempotency-Key`. El horario (30 min después del diario, con una segunda pasada a las 14:53 UTC) cubre los retrasos de cron observados, de unas 3 h. Mejora posible, no bloqueante (H-ARQ-C05-03): disparar también con `workflow_run` al terminar la evaluación.
2. **Formato en `engine/alert-email.js` y `ALERT_KIND_LABELS` en el motor: correcto.** Son funciones puras sin red ni DOM, usadas por el front (las etiquetas) y por Actions (el correo). Quitan la copia de las etiquetas que tenía `src/lib/dashboard.js`, que ahora las reexporta (CLAUDE.md §6).
3. **Migración aditiva `emailed_at` / `email_attempts`: justificada.** Sin tabla nueva (ADR 0005). RLS y grants intactos: `authenticated` solo tiene UPDATE en `read_at` (`20261119120100_rls_policies.sql`), y pgTAP `120_alert_email_c05.test.sql` lo verifica por rol. El check 0..100 y el índice parcial son razonables.
4. **Ventana de 7 días: correcta.** Evita mandar todo el historial al activar el correo, es la misma ventana que `exception_expired` y se puede configurar solo en ejecución local.
5. **Remitente por defecto `onboarding@resend.dev`: aceptable como valor por defecto, con riesgo documentado.** Resend solo entrega al dueño de la cuenta. A los demás destinatarios responde 403 y la alerta gasta sus 3 intentos sin poner el run en rojo. P-09 ya lo explica. El runbook añade el diagnóstico (HTTP 403) y cómo reencolar tras verificar el dominio.
6. **Auditoría:** `alert_emailed` y `alert_email_failed` con actor `system:alert-email`, sin correos ni clave (CLAUDE.md §4).

## Hallazgos
- **H-ARQ-C05-01 (medio, no bloqueante ahora; obligatorio antes de completar P-09).** `correo-alertas.yml` no está en `WORKFLOW_RULES` de `scripts/health/lib.js`. Así, un cron desactivado por inactividad, un run fallido (BD o configuración) o un paso omitido con producción activa no abrirían issue `salud`. Fila propuesta (código del desarrollador, con su prueba en `tests/scripts/health.test.js`):
  `{ file: 'correo-alertas.yml', check: 'correo-alertas', requiresProduction: true, event: null, maxAgeHours: 30, requiredStep: 'Enviar correos', maxDurationMin: 10 }`.
  No bloquea el merge: sin `EVALUATION_ENABLED` ni `RESEND_API_KEY` no hay nada que vigilar, salvo el `state` del workflow. Si el ítem vuelve al desarrollador por otro revisor, conviene incluirla en esa ronda. Si no, el orquestador la registra como ítem de seguimiento (por ejemplo V-04c) con dependencia antes de P-09.
- **H-ARQ-C05-02 (bajo).** Los fallos de Resend por alerta salen con exit 0 y solo dejan `::warning::`. Si todos los envíos fallan (clave revocada con 401, o remitente de pruebas con 403), el run queda verde y `salud.yml` no lo ve, porque no tiene la clave secreta (ADR 0014). Propuesta, no bloqueante: salir con exit 1 cuando haya `pending > 0`, `sent = 0` y todos los fallos sean 401 o 403 (un fallo de configuración, no un fallo puntual). Mientras tanto, el runbook incluye la consulta de `audit_log`.
- **H-ARQ-C05-03 (bajo, mejora).** El correo depende del cron. Si el diario se retrasa más de ~3,5 h, la alerta sale al día siguiente. Opcional: añadir `workflow_run` (`types: [completed]`, sobre `Ritmo diario` y `Evaluación mensual`, en `main`) y conservar el cron como respaldo. No cambia ningún ADR.
- **H-ARQ-C05-04 (bajo).** `APP_URL: ${{ vars.PAGES_URL }}` no tiene valor por defecto, mientras que `salud.yml` sí (`DEFAULT_PAGES_URL`). Si la variable no existe, el correo sale sin enlace a la app. Ese comportamiento está documentado. Opcional: usar el mismo valor por defecto.
- **H-ARQ-C05-05 (operación).** La migración `20261129120000_alert_email_c05.sql` debe estar desplegada en producción (`deploy.yml`) antes de que el workflow corra con `EVALUATION_ENABLED=true`. Si no, el paso falla con exit 1. Hoy no aplica, porque P-05 está pendiente. Queda en el runbook, «Activación», paso 1.
- **Cuotas de Resend:** el plan gratuito limita los correos diarios y mensuales. El cierre del día 1 genera una fila por líder y por miembro del comité en cada cambio de color. Un 429 se reintenta, y el runbook explica cómo reencolar. Con el volumen académico no se espera que llegue al límite.
