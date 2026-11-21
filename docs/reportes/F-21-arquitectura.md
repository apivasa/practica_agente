# F-21 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. El cambio cabe en el punto 6 del ADR 0014 («los detalles quedan en el log y el resumen del run»): el cuerpo del issue no cambia.
Salud: rama `item/F-21` con punta 7b3ae30. En 2591cfc el CI salió en `failure`, por el lint de `qa-f21` que corrige 7b3ae30, y Seguridad en `success`. CI y Seguridad de 7b3ae30 seguían en curso al cerrar esta revisión: el orquestador debe confirmarlos antes del merge. En local, `node --test tests/scripts/*.test.js` da 1055 pruebas, 1054 pasadas y 0 fallidas. No cambian `salud.yml` ni los workflows programados.

## Revisión 2 (reintento 1, punta 7b3ae30)
- H-ARQ-F21-01 queda **cerrado** con 2591cfc. Con el valor ya sin controles, `sanitizeLogValue` busca el último ` — ` y, si lo que sigue es un enlace `https` (sin espacios ni controles, validado con `URL`) que deja al menos 20 caracteres de texto, recorta solo el texto anterior. El total sigue en 300 o menos. Si no se cumple, hace el recorte normal.
- **Reproducción del caso de 308 caracteres** (`correo-alertas`, producción activa, «hace 149 h» + «duración no verificable» + «3 de 4: failure, cancelled, timed_out»): la salida tiene 300 caracteres y termina en `t… — https://github.com/apivasa/practica_agente/actions/runs/99999999999`. El enlace sale completo y el resultado sigue en `fail`.
- **Inyección, comprobado a mano:**
  - Un «enlace» final con `\n::error::` no se acepta como enlace: se aplica el recorte normal y todo queda en una línea.
  - Un `\n::warning::` en el texto se cambia por un espacio, y el enlace final se conserva.
- El runbook (`docs/operacion.md`) ya describe que el enlace se conserva, y en qué casos se usa el `gh api` de respaldo.

## Qué se revisó (revisión 1, sigue vigente)
- `sanitizeLogValue` es pura y cuenta por code points. Cambia por espacio C0, DEL, C1, U+2028 y U+2029. Se aplica al log, a las celdas del `GITHUB_STEP_SUMMARY`, a `--only` inválido, a los `::error::` de excepción de `check.js` e `issue.js` y al número del issue en el log.
- **Cuerpo del issue: no se recorta ni cambia.** Lleva los nombres de check saneados con `[a-z0-9-]`, la hora y `RUN_URL` validada contra `^https://github.com/<o>/<r>/actions/runs/\d+$`.
- **ok/fail no cambian.** El saneo es solo de salida. `results`, `failedChecks` y `failures=` usan los valores sin tocar. Validar el id antes de «sin jobs» solo cambia el texto (los dos casos ya daban `fail`), y es coherente con `checkWorkflows`, que no pide jobs si el id no es entero.

## Hallazgos
- **H-ARQ-F21-01 (media): cerrado en 2591cfc.** El recorte a 300 quitaba el enlace al run evaluado, que va al final del detalle. Ahora el enlace se conserva (ver Revisión 2).
- **H-ARQ-F21-02 (baja, informativa):** el resumen no escapa Markdown aparte de `|`. El resumen no ejecuta comandos de workflow, así que no hay riesgo de inyección. Solo se anota.
- **H-ARQ-F21-03 (baja): cerrado.** `docs/operacion.md` explica el saneo, la conservación del enlace y el respaldo con `gh api .../workflows/<archivo>/runs`.
