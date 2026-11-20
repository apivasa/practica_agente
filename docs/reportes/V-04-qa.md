# V-04 — Informe QA
Veredicto: VERDE

Criterio de aceptación:
- **"Simulación de caída en CI produce alerta": cumplido.** En CI run 44639874789 (rama `item/V-04`, job `integración`, paso `scripts/ci/health.sh`) el log muestra primero `ok pages` y `ok supabase` contra Supabase local, después `FALLA pages: sin respuesta (error de red) tras 2 intentos`, `failures=["pages"]` y `OK: la caída simulada produce alerta (failures=pages)`. Lo repetí en local sin mocks, con un servidor HTTP propio y el puerto 9 cerrado. Todo arriba da código 0 y `failures=`. Pages caído da código 1 y `failures=pages`. Pages y Supabase caídos dan código 1 y `failures=pages,supabase`. Una prueba nueva encadena esa salida real con `issue.js`, que abre un issue con la etiqueta `salud` y la lista `pages`. Otras pruebas comprueban el cableado de `salud.yml`: `alert` depende de `check` con `if: always() && needs.check.result == 'failure'`, y `FAILURES` sale de `steps.health.outputs.failures`.
- **"Runbook en `docs/operacion.md`": cumplido.** La sección «Salud del sistema» tiene la tabla de checks y dice qué hacer ante cada check que puede alertar (`pages`, `supabase`, `actions-api`, `ritmo-diario`, `evaluacion-mensual`, `seguridad-semanal`, `ci-main`). También explica cómo relanzar `salud.yml` y cuándo cerrar el issue. Hay una prueba que falla si se añade un check a `WORKFLOW_RULES` sin documentarlo.
- Descripción del ítem:
  - Cron cada 6 h (`41 */6 * * *`) y `workflow_dispatch`: cumplido.
  - Verifica la web y Supabase: cumplido.
  - Falla visible: el run queda en rojo y se abre o comenta un issue. Cumplido.
  - Alerta si un workflow programado no corrió, falló o está deshabilitado: cumplido.
  - Auditoría: cumplido con una observación (hallazgo 1).

Pruebas añadidas: `tests/scripts/qa-v04.test.js`, con 31 casos en 6 grupos:
- Cableado de `salud.yml` (6).
- Simulación de caída en CI y caída real sin mocks (4).
- Bordes de disponibilidad (5).
- Umbrales exactos de workflows (9). Ejemplos: 30 h exactas ok y 30 h + 1 min falla; 5 min ok y 5 min + 1 s falla; 8 días ok y 8 días + 1 h falla. También cubre: run en curso que no cuenta, runs desordenados, un `workflow_dispatch` que no tapa la falta del cron semanal, `ci-main` con el último push en failure, y el día 1 o 2 del mes en hora de Guayaquil.
- Issue sin duplicados (4). Cubre: la etiqueta ya existe (422), un PR con la etiqueta no cuenta como issue, dos alertas seguidas dan un issue y un comentario, y un 403 al crear el issue deja el job `alert` en rojo.
- Runbook (3).

Resultado local: `node --test` sobre `tests/**/*.test.js` da 1149 pruebas: 1146 pasan, 0 fallan, 2 omitidas y 1 todo, que ya existían. Las 28 pruebas del constructor y las 31 nuevas pasan.

Resultado CI: antes de este informe, CI run 44639874789 y Seguridad run 44639874745 estaban en `success` sobre `0e8fd08`. El estado tras el push de este informe va en la respuesta al orquestador.

Cobertura engine/: 99,9 % de líneas. Solo falta la línea 36 de `commitment.js`, y todos los demás archivos están al 100 %. Para `scripts/health/lib.js` es 97,2 %. Las líneas sin cubrir son `defaultSleep` y `runAll`, que nadie usa. `check.js` e `issue.js` solo dejan sin cubrir el bloque de arranque por CLI, que se ejerce en CI con `health.sh`.

Hallazgos:
1. **Baja (observación, no bloquea).** CLAUDE.md §4 pide que toda acción automática con efecto, como una alerta enviada, quede "en una tabla de auditoría". El issue que abre `salud.yml` queda en GitHub, no en `audit_log`. La desviación está documentada y justificada en ADR 0014, punto 7: escribir en la BD exigiría la clave secreta en un workflow que no la necesita. El orquestador debe decidir si la acepta o si la registra como decisión del usuario. Cómo reproducirlo: `grep -n audit scripts/health/*.js` no devuelve nada.
2. **Baja (riesgo sin verificar).** El plan pide una "consulta liviana periódica" para evitar que el plan gratuito pause Supabase. `salud.yml` sondea `/auth/v1/health`, que podría no contar como actividad de la base de datos. No se puede comprobar sin producción. El arquitecto ya lo reconoce (informe, punto 8). Conviene verificarlo en V-05.
3. **Informativo.** La simulación en CI cubre el job `check` (código 1 y `failures=pages`). La creación del issue (job `alert`) solo se prueba con una API de GitHub simulada y con las pruebas estáticas del cableado, porque `salud.yml` no puede lanzarse hasta que esté en `main`. Recomendación: tras el merge, lanzar `salud.yml` a mano una vez y confirmar que sale verde, o que se omite porque producción está inactiva.
4. **Informativo.** `runAll` en `scripts/health/lib.js` (líneas 233-237) no se usa y es código muerto.
