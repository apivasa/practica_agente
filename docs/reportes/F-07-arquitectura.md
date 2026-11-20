# F-07 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (el reintento de CI no cambia ADR 0004 ni ADR 0014; `docs/operacion.md` actualizado)
Salud: CI run 44683698735 y Seguridad run 44683698811 en `13d670a`, los dos en verde. Los runs cancelados de `0c8029f` son por concurrencia, no fallos. Workflows programados: no los toca.
Hallazgos:

1. **(ROJO: no se cumple el criterio de aceptación.)** El criterio pide que «el paso intermitente registrado en operacion.md deje de requerir relanzar a mano». Las **dos** ocurrencias registradas fueron en `seguridad.yml`, job `pentest-api` (runs 44638730859, puerto 54322, y 44634155934, puerto 54324). F-07 solo cambia `ci.yml`. Los tres `supabase start` de `.github/workflows/seguridad.yml` (líneas 174, 233 y 343: pentest-api, dast y S-05 fase A) siguen sin reintento. Además, los jobs de seguridad son los que más compiten por Supabase local en paralelo (ver S-04 en operacion.md).
   **Corrección dentro del ítem:** el agente `seguridad` (dueño de `seguridad.yml`, CLAUDE.md §1) cambia esos tres pasos a `bash scripts/ci/supabase-start.sh supabase start -x ...`, con los mismos `-x` de ahora. El desarrollador no puede tocar ese archivo. No hace falta ADR.
2. **Diseño del script (correcto).** El reintento está acotado (1..5, por defecto 3) y la espera está limitada (≤ 60 s). Al agotar los intentos sale con el código real del último intento, nunca 0, así que el reintento no esconde un fallo real. El script solo acepta `supabase start` o `supabase db start`, de modo que no es un ejecutor genérico. No lee secretos. El diagnóstico usa `ss -ltnp` y `docker ps -a`, como se propuso en V-04. Cumple la regla de no desactivar pasos para que algo pase.
3. **Costo (aceptable).** En el peor caso son 3 × ~65 s + 2 × 10 s ≈ 3,5 min más en el job, y solo cuando ya iba a fallar. Los jobs no tienen `timeout-minutes` en `ci.yml` (el valor por defecto es 360 min), así que no hay riesgo de cortar el job. Si en el futuro se fija un timeout, debe dejar margen para los reintentos.
4. **Pruebas (correcto).** `tests/scripts/supabase-start.test.js` cubre el éxito al primer intento, la recuperación, el agotamiento con código ≠ 0 y la validación de argumentos. Usa un `supabase` falso en PATH, sin Docker.
5. **Runbook (resuelto en este informe).** `docs/operacion.md`, sección pentest-api: cómo leer el `::notice::` de intermitencia absorbida y el error final, y la advertencia de que `seguridad.yml` sigue sin el script mientras no se aplique el punto 1.
6. **Monitoreo de intermitencia (propuesta, no bloquea).** El `::notice::` «arrancó en el intento N» solo queda en el log. Más adelante, `salud.yml` podría contar esas anotaciones de los runs de CI de `main` para medir la tasa real. Por ahora basta con anotarlo en operacion.md cuando aparezca.
