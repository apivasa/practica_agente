# C-03+C-04 — Informe de arquitectura y salud
Veredicto: VERDE (segunda revisión sobre `156b2b2`; la primera, sobre `e580c45`, fue ROJO por los hallazgos 1 y 2, ya resueltos)
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0008-evaluacion-y-alertas.md` (Aceptado: las 7 decisiones del desarrollador más idempotencia y Q-03; punto 3 ampliado con el re-cierre explícito `reprocess`, el rechazo de `as_of` futuro y la ventana del trimestre completo). Actualizado `docs/operacion.md`: tiempos base con `integration`, sección "Evaluación programada" (activación, vigilancia hasta V-04, qué hacer si fallan, reprocesar un mes, restaurar).
Salud: sobre `156b2b2`, CI run 44609757020 `success` (build 27 s, db 74 s, integration 77 s, e2e 45 s) y Seguridad run 44609756706 `success` (pentest-api 88 s). Los fallos intermedios fueron defectos reales ya corregidos, no intermitencia: CI 44605287964 (sintaxis de `verify-evaluate.sql`), Seguridad 44606812102 (fixtures con `kind` no permitido) y CI 44608723396 (`043_security_alerts_dedupe.test.sql`, que salía con código 3). Primera revisión: CI 44606812249 `success` (integration 69 s). Los workflows programados no tienen base todavía: sin secretos ni `EVALUATION_ENABLED`, terminan en verde con un warning.

## Verificación de lo pedido
- **Lógica en `engine/`:** sí. Color (`measure`, `evaluateColor`), peor color (`unitColor`), candados (`evaluateEscalation`), ritmo (`packageStatus`, `paceStatus`) y recálculo (`recalculateOnNewCritical`) salen del motor. `scripts/lib/build.js` solo traduce filas a contratos y filtra fechas. `alerts.js` decide disparos a partir de las salidas del motor y no recalcula ninguna regla. `db.js` no tiene lógica. No hay duplicados en `src/`.
- **Backend privilegiado = Actions (ADR 0001):** sí. Solo los dos workflows usan `SUPABASE_SECRET_KEY`. `readConfig` exige el prefijo `sb_secret_` y https. Permisos `contents: read`, acciones por SHA, `persist-credentials: false` y `npm ci --ignore-scripts --omit=dev`. La migración es aditiva y no da INSERT a `authenticated`.
- **Fechas America/Guayaquil:** sí. Hay `todayInGuayaquil` con `Intl` para el `as_of` por defecto. Los cron quedan en 06:07 y 06:23 de Guayaquil (UTC-5 fijo) y evitan el minuto 0. El motor sigue puro (ADR 0003, punto 3).
- **Idempotencia:** sí. `dedupe_key` es única con `ignoreDuplicates`, las evaluaciones solo se escriben si cambian y el snapshot se compara con JSON canónico. `integration.sh` corre cada modo dos veces y compara conteos: en el log, la segunda corrida da `written 0, alerts 0, snapshots 0`.
- **Las 7 decisiones:** todas aceptadas y registradas en ADR 0008 (puntos 1, 2, 3, 4, 6, 7 y 8).

## Hallazgos
1. **[Resuelto en `108e179`] La mensual pierde el día 1 del trimestre en septiembre y diciembre.** `runMonthly` carga mediciones desde `addDays(monthEnd(evalMonth), -max(90, window_days))`. Q3 y Q4 tienen 92 días, así que para `2027-09` el corte es `2027-07-02` y para `2027-12` es `2027-10-02`. Lo verifiqué con `scripts/lib/dates.js`. Las vulnerabilidades resueltas el día 1 del trimestre no cuentan en el acumulado del tercer mes, y eso puede dar un color peor y un candado indebido en el mes que decide el cierre. La semilla usa Q1 y no lo detecta. Corrección en `scripts/lib/run.js`:
   `from = min(quarterBounds(evalMonth).start, addDays(to, -maxWindow))`.
   El tester debería añadir un caso con una medición del 1 de julio o del 1 de octubre.
   **Verificado:** `measurementsFrom()` en `scripts/lib/run.js` toma el mínimo entre el inicio del trimestre y el de la ventana. Además, `evaluateIndicatorMonth` en `scripts/lib/build.js` amplía `windowDays` al trimestre completo en `cumulative_target`, porque el motor también recortaba por ventana. La lógica de cálculo sigue en el motor: el script solo ajusta la entrada.
2. **[Resuelto en `156b2b2`] `pentest-api` fallaba por la nueva constraint `alerts_kind_allowed`.** Los fixtures de `tests/security/api/` insertan alertas con `kind` `idor-fixture` y `pentest-fixture` (error 23514), y se cancelan 415 de 428 casos. La constraint es correcta, porque cierra los tipos al diseño. Se cambiaron los fixtures, que ahora usan un `kind` permitido. pentest-api queda en verde en el run 44609756706.
3. **[Informativo] Cierre del día 1 frente a carga tardía.** El cron cierra el mes a las 06:07 del día 1. Si los custodios cargan después, hay que reprocesar con `workflow_dispatch` (`as_of` = día 1). Queda en el runbook. Si se repite, conviene mover el cron al día 2 o 3, que es una decisión de negocio y no de arquitectura.
4. **[Informativo] Concurrencia compartida.** Con `cancel-in-progress: false`, GitHub conserva solo una corrida pendiente por grupo. El día 1 el mensual y el diario no chocan (06:07 y 06:23, y cada uno dura segundos), así que el riesgo es bajo. Documentado en ADR 0008.
5. **[Para V-04] Vigilancia de cron.** Los criterios quedan especificados en `docs/operacion.md`: run en `success` en las últimas 26 h, run mensual en `success` en el mes, `state` del workflow `active` (GitHub los desactiva tras 60 días sin actividad) y auditoría reciente de `system:evaluate`. El issue `salud` no debe llevar datos de unidades porque el repo es público.
6. **[Informativo] Q-03** está en una constante (`YELLOW_MONTH2_ESCALATES_LIKE_RED`) y no en configuración de BD. Es aceptable mientras Q-03 siga abierta, porque es un solo punto de cambio (ADR 0008, punto 9).
7. **[Aceptado] Cambios del segundo intento** (ADR 0008, punto 3):
   - Un re-cierre sin `--reprocess` sale con código 3 y no escribe nada. Con `--reprocess` queda auditado como `evaluation_reprocess`.
   - Un `as_of` futuro se rechaza.
   - `EVALUATE_ALLOW_FUTURE` solo funciona con un host local: en otro host provoca un error y no se ignora en silencio.
   - Un trigger fija `measurements.created_at` (migración aditiva, función en `private` con `search_path=''` y sin EXECUTE para roles de cliente).

   Una consecuencia operativa queda documentada en el runbook: el *Re-run* de un cron que falló a medias sale con código 3, y hay que relanzarlo por `workflow_dispatch` con `reprocess=true`.
8. **[Cosmético, no bloquea]** En `scripts/lib/build.js`, el JSDoc de `isResolved` quedó encima de `daysBetween` al insertar la función nueva.
