# F-20 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí (cambio acotado a `requiredStepProblem` en `scripts/health/lib.js`, dentro del modelo de salud de ADR-0014; sin tablas, sin lógica de negocio fuera de `engine/`, sin cambio de stack)
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (endurecimiento de implementación; ADR-0014 sigue vigente). Actualizado `docs/operacion.md` (runbook).
Salud: CI de `item/F-20` en 9ea6aa1 en rojo por las 12 pruebas con fixtures sin `run_id` (QA las ajusta en paralelo; no es un defecto de diseño). Seguridad en curso. En `main`, `Ritmo diario` último run 44864590732 (workflow_dispatch) `success` con paso `Evaluar` en `success`. `correo-alertas` aún sin runs en `main`.

## Verificaciones

1. **Riesgo de falso fail por matriz o `if:`.** Revisados los tres `requiredStep` de `WORKFLOW_RULES`:
   - `ritmo-diario.yml` → `Evaluar`; `evaluacion-mensual.yml` → `Evaluar`; `correo-alertas.yml` → `Enviar correos`.
   - Los tres tienen **un solo job, sin `strategy.matrix`**, sin `continue-on-error` y sin `needs`. El paso requerido aparece exactamente una vez.
   - El único `if:` es `steps.check.outputs.ready == 'true'`, que es `false` solo si faltan `SUPABASE_URL`/`SUPABASE_SECRET_KEY` o si `EVALUATION_ENABLED != 'true'`. La comprobación solo corre con `EVALUATION_ENABLED=true`, así que un `skipped` ahí es justamente la incidencia que debe alertar (o el caso conocido de un run anterior a la activación, ya documentado). La regla «todas en success» no añade falsos fallos con los workflows actuales.
2. **Contraste con la API real.** `GET /actions/runs/44864590732/jobs?per_page=100&page=1` devuelve `total_count: 1` y un job con `run_id: 44864590732` (número entero, igual al run), `run_attempt: 1`, y el paso `Evaluar` en `success`. Pasé esa respuesta real, más los runs y el workflow reales, a `assessWorkflow` de la rama con `productionEnabled: true`: resultado `ok`. Control negativo con el mismo `run_id` convertido a texto: `fail` («no traen el run_id del último run»), como se esperaba. Paginación: el cliente usa `per_page=100` hasta 5 páginas según `total_count`; con 1 job sale en la primera página. Todos los jobs de un run (cualquier página) traen el mismo `run_id`, así que paginar no rompe la comprobación.
3. **Coherencia con ADR-0014 y el runbook.** Es coherente con la línea fail-closed de ADR-0014 y F-17..F-19. `docs/operacion.md` describía el mensaje y las condiciones de F-19 (`los jobs recibidos no son del último run`), que F-20 cambia. Lo actualicé con las condiciones nuevas, los mensajes nuevos y qué hacer ante cada uno.

## Hallazgos

- **H-ARQ-F20-01 (corregido en este informe, docs):** el runbook `docs/operacion.md` tenía el texto de alerta de F-19, que ya no coincide con el código. Añadí la viñeta «Desde F-20» en la sección de salud, y en «Qué hacer ante cada alerta» las alertas `no traen el run_id del último run`, `el último run no tiene id verificable` y `no terminó en success en todas sus apariciones`.
- **H-ARQ-F20-02 (informativo, sin acción):** un paso con `continue-on-error: true` reporta `conclusion: success` aunque falle (la API de jobs no expone `outcome`), así que la comprobación no lo detectaría. Hoy ningún paso requerido lo usa. Quedó registrado en el runbook como regla: no usarlo en `Evaluar` ni en `Enviar correos`.
- **H-ARQ-F20-03 (informativo):** `checkWorkflows` solo llama a `listJobs` si `Number.isSafeInteger(candidate.id)`. Con un id no entero, `jobs` queda vacío y el check falla con «sin jobs del último run» antes de llegar a la nueva comprobación «el último run no tiene id verificable», que en ese caso no se alcanza. El resultado es igualmente fail-closed. El mensaje más preciso solo aparece al llamar la función pura con jobs. No bloquea.
- **H-ARQ-F20-04 (informativo):** CI de la rama en rojo por las 12 pruebas con fixtures sin `run_id`. Es esperado y lo resuelve QA. El merge debe esperar CI verde.
