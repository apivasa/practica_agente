# C-06 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0017-correo-de-alertas.md` (adenda C-06; sin cambio de decisiones, estado Aceptado)
Salud: CI de `item/C-06` en 847cf6e en rojo por 2 pruebas de `tests/scripts/qa-v04.test.js`. `[E]` (falta `correo-alertas` en el runbook) queda corregida con este commit. `[C]` (lista fija de 4 workflows) es del tester y debe actualizarse para incluir `correo-alertas.yml` (H-ARQ-C06-01). Las demás suites pasan en local (health, email-c06, qa-c05: 101/101). pgTAP e integración están en verde en Actions. Producción está activa (`EVALUATION_ENABLED=true` desde P-05). `correo-alertas.yml` está `active`, se creó el 2026-11-21 a las 03:04 UTC y aún no tiene runs. P-09 (`RESEND_API_KEY`) sigue pendiente.

## Revisión contra el diseño
- **Stack:** sin cambios. Node en Actions, Supabase con clave secreta solo en el environment `produccion`, y Resend como ya se decidió en Q-04 y ADR 0017.
- **Modelo de datos:** la migración `20261201120000_alert_email_c06.sql` es aditiva. Añade dos columnas nullable a `alerts` y tres CHECK. Las filas existentes cumplen los CHECK (todo es NULL), así que no hay riesgo de fallo al validar. No crea tablas: se mantienen las 9 tablas más `audit_log`. RLS sigue activado. `authenticated` no gana `UPDATE` sobre las columnas nuevas. Los grants a `service_role` son explícitos (lección de #52). Las columnas se justifican como estado operativo, igual que `emailed_at`. Queda registrado en la adenda de ADR 0017.
- **engine/:** `recipientSkipReason` vive en `scripts/lib/email.js` y no en `engine/`. Es aceptable: lo usa solo la Action y depende de datos de Auth admin que el front no ve. Reproduce el criterio de `recipientsFor` (`scripts/lib/alerts.js`): líder de la unidad o comité. No duplica lógica de cálculo (colores, ritmo, escalada). Si en el futuro el front necesita ese criterio, conviene moverlo a `engine/` (anotado, no bloquea).
- **ADR 0017, punto 10 (H-ARQ-C05-01):** cumplido. La fila es `correo-alertas` con `requiresProduction: true`, `maxAgeHours: 30`, `requiredStep: 'Enviar correos'` (coincide con el nombre del paso en `correo-alertas.yml`) y `maxDurationMin: 10` (el timeout del job es 15).
- **H-ARQ-C05-02 (401/403 → exit 1):** cumplido con `allAuthFailures`. Solo se activa si no salió ningún correo y todos los fallos fueron 401/403. Un 403 aislado con el remitente de pruebas, cuando otros correos sí salen, sigue en exit 0 con `::warning::`. Es el criterio correcto.
- **H-ARQ-C05-04 (APP_URL por defecto):** cumplido, con el mismo valor que `DEFAULT_PAGES_URL` de salud.
- **Auditoría (CLAUDE.md §4):** cada omisión deja `alert_email_skipped` con actor `system:alert-email`.

## Valoraciones pedidas
1. **Primera corrida con `RESEND_API_KEY`.** Sin la clave, `runEmailStep` termina antes de tocar la BD. Hoy no se procesa nada y las alertas generadas desde P-05 se acumulan. En la primera corrida tras P-09, todas las que tengan más de 7 días se marcan `expired` y se auditan, hasta 500 por corrida (`EXPIRED_BATCH`, ordenadas por `sent_at, id`). El resto sale en las corridas siguientes, dos al día. Con el volumen académico (pocas unidades, una fila por destinatario) se espera menos de 500 en total. El tamaño del lote es adecuado: un solo `insert` de 500 filas en `audit_log` y `update` en trozos de 100. Es el comportamiento pedido por QA-C05-1, no una falla, y queda documentado en el runbook y en la adenda del ADR para que el pico de `alert_email_skipped` no se lea como incidente.
2. **Orden migración frente a `correo-alertas.yml`.** El cron corre desde `main` y la migración solo se aplica al lanzar `deploy.yml`, que es manual (ADR 0015). Entre el merge y el despliegue el código ya filtra por `email_skipped_at`. Ese intervalo es seguro mientras no exista `RESEND_API_KEY`, porque el script sale antes de consultar `alerts`. Si P-09 se completa antes de desplegar la migración, el paso falla con exit 1 (columna inexistente) y `salud.yml` lo detecta con el check `correo-alertas`. **Orden obligatorio: merge de C-06 → `deploy.yml` (migración) → P-09.** Queda en el paso 1 de «Activación» del runbook y en el ADR. El orquestador debería lanzar (o pedir al usuario) el despliegue de la migración antes de avisar de P-09. El orden inverso (migración aplicada con código viejo) no causa problemas, porque la migración es aditiva.

## Cambios de este informe (dueño arquitecto-SRE)
- `docs/operacion.md`:
  - Entrada `correo-alertas` en «Qué hacer ante cada alerta». Cubre: exit 1 con 401/403 (revisar `RESEND_API_KEY` o el dominio de `ALERT_EMAIL_FROM`), failure por BD o por la migración C-06 sin desplegar, cron descartado, paso omitido y workflow deshabilitado.
  - Fila nueva en la tabla de checks.
  - En «Correo de alertas»:
    - filtro `email_skipped_at`;
    - motivos de omisión;
    - pico de `expired` en la primera corrida;
    - exit 1 por 401/403;
    - orden de activación con las dos migraciones;
    - `PAGES_URL` con valor por defecto;
    - SQL de reencolar que excluye las omitidas y explica cómo revertir una omisión (las dos columnas a la vez, por el CHECK `alerts_email_skip_pair`);
    - «Cómo vigilarlo» ya no dice que salud no lo vigila.
  - Se cierra el pendiente H-ARQ-C05-01.
- `docs/adr/0017-correo-de-alertas.md`: adenda C-06.

## Hallazgos
- **H-ARQ-C06-01 (alta para el merge, del tester):** `tests/scripts/qa-v04.test.js:113` (`[C] vigila los cuatro workflows...`) compara `WORKFLOW_RULES` con una lista fija de 4 archivos y falla con la fila nueva. El cambio de código es correcto y lo exige ADR 0017 punto 10. El tester debe actualizar la lista para incluir `correo-alertas.yml`. El desarrollador no debe tocarla (CLAUDE.md §1). Mientras tanto, la CI de la rama sigue en rojo.
- **H-ARQ-C06-02 (media, operación):** `correo-alertas.yml` no tiene runs desde que se creó (03:04 UTC del 21-nov). La gracia de `assessWorkflow` para workflows nuevos vence a 30 h, el 2026-11-22 a las 09:04 UTC. Ya se observó que GitHub descarta crons recién creados (nota del runbook sobre `salud.yml`). Si los crons de hoy (11:53 y 14:53 UTC) no corren, salud abrirá `correo-alertas: sin runs completados`. Recomendación al orquestador: tras el merge, lanzar `correo-alertas.yml` una vez a mano. Es idempotente y, sin `RESEND_API_KEY`, solo deja un `::notice::`.
- **H-ARQ-C06-03 (media, operación):** el orden de despliegue (valoración 2). Hay que desplegar la migración C-06 antes de P-09.
- **H-ARQ-C06-04 (baja):** en la ruta `expired`, si `markAlertsEmailSkipped` marca y luego `insertAudit` falla, quedan alertas marcadas sin fila de auditoría, aunque el run sale en exit 1 y queda visible. Es el mismo patrón de marcar y luego auditar que ya tenía C-05 con `emailed_at`. Aceptable con el volumen actual. Si se quiere atomicidad, haría falta una RPC que marque y audite en una sola transacción (posible ítem futuro, no bloquea).
- **H-ARQ-C06-05 (baja):** las alertas agotadas (`email_attempts >= 3`) que salen de la ventana nunca reciben la marca `expired`, porque `expiredEmailAlerts` filtra `< maxAttempts`. Es coherente: ya tienen sus `alert_email_failed` en `audit_log`. Las consultas del runbook las siguen distinguiendo por `email_attempts`.
- **H-ARQ-C06-06 (informativo):** `recipientAccess` hace una llamada a `getUserById` y una consulta a `user_roles` por destinatario distinto, con caché por corrida. Es suficiente a escala académica. Al crecer, conviene una sola consulta a `user_roles` por lote.
- **Base de tiempos:** sin medición todavía (no hay runs). Queda en «Pendiente de completar» del runbook: medir tras P-09.
