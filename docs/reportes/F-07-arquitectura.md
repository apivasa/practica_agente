# F-07 — Informe de arquitectura y salud
Veredicto: VERDE (intento 2; en el intento 1 fue ROJO)
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (el reintento de CI no cambia ADR 0004 ni ADR 0014; `docs/operacion.md` actualizado)
Salud: CI y Seguridad en verde en `e3061d9`. Los runs cancelados de `e503ae8` y `0c8029f` son por concurrencia, no fallos. Workflows programados: no los toca.
Hallazgos:

1. **Corregido el hallazgo ROJO del intento 1.** El criterio de aceptación pedía cubrir el paso intermitente registrado en operacion.md, que ocurrió en `seguridad.yml`. Ahora los tres `supabase start` de `.github/workflows/seguridad.yml` (pentest-api, dast y S-05 fase A) usan `bash scripts/ci/supabase-start.sh supabase start -x ...`, con los mismos `-x` de antes (commit `1e03204`, restaurado en `cd8d959`). S-05 fase B (producción) no arranca Supabase local y no cambia. Con esto, los seis arranques de Supabase local en CI tienen el reintento acotado.
2. **Diseño del script (correcto).** El reintento está acotado (1..5, por defecto 3) y la espera está limitada (≤ 60 s). Al agotar los intentos sale con el código real del último intento, nunca 0, así que el reintento no esconde un fallo real. El script solo acepta `supabase start` o `supabase db start`, y no lee secretos. El diagnóstico usa `ss -ltnp` y `docker ps -a`, como se propuso en V-04. Cumple la regla de no desactivar pasos para que algo pase.
3. **Costo (aceptable).** En el peor caso son 3 × ~65 s + 2 × 10 s ≈ 3,5 min más en el job, y solo cuando ya iba a fallar. Ningún job lo corta: `ci.yml` no tiene `timeout-minutes`, y los jobs de `seguridad.yml` tienen como mínimo 30 min. Si en el futuro se fija un timeout, debe dejar margen para los reintentos.
4. **Pruebas (correcto).** `tests/scripts/supabase-start.test.js`, `tests/scripts/qa-f07.test.js` y `tests/security/ci-supabase-start-f07.test.js` cubren el éxito, la recuperación, el agotamiento con código ≠ 0, la validación de argumentos y que ningún workflow arranque Supabase sin el script.
5. **Runbook (actualizado).** `docs/operacion.md`, sección pentest-api: cómo leer el `::notice::` de intermitencia absorbida y el error «no arrancó tras 3 intentos», y qué workflows usan el script.
6. **Monitoreo de intermitencia (propuesta, no bloquea).** El `::notice::` «arrancó en el intento N» solo queda en el log. Más adelante, `salud.yml` podría contar esas anotaciones de los runs de `main` para medir la tasa real.
