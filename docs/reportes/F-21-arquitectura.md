# F-21 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: sí (una corrección dentro del ítem, H-ARQ-F21-01)
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. El cambio cabe en ADR 0014 punto 6 («los detalles quedan en el log y el resumen del run»): el cuerpo del issue no cambia.
Salud: rama `item/F-21` en f79ae8a. CI y Seguridad en curso al revisar; el commit anterior (33e8df8) salió verde en los dos. En local, `node --test tests/scripts/*.test.js` da 1010 pruebas pasadas, 0 fallidas y 1 todo, incluida `tests/scripts/f21-fixes.test.js`. No hay cambios en `salud.yml` ni en los workflows programados.

## Qué se revisó
- `sanitizeLogValue` (`scripts/health/lib.js`) es pura y cuenta por code points. Cambia por espacio C0, DEL, C1, U+2028 y U+2029, y recorta a `LOG_VALUE_MAX = 300` con «…». Un `max` inválido vuelve a 300.
- Se aplica al log (`tag check: detalle`), a las celdas del `GITHUB_STEP_SUMMARY` (check, estado y detalle), a `--only` inválido, a los `::error::` de excepción de `check.js` e `issue.js`, y al número del issue en el log de `issue.js`.
- **Cuerpo del issue: no se recorta ni cambia.** `issueBody` sigue llevando solo los nombres de check saneados con `[a-z0-9-]`, la hora y `RUN_URL` validada contra `^https://github.com/<o>/<r>/actions/runs/\d+$`. El enlace al run de salud del issue queda intacto.
- **ok/fail no cambian.** El saneo solo se aplica en la salida. `results`, `failedChecks` y `GITHUB_OUTPUT` (`failures=`) usan los valores sin tocar. En `requiredStepProblem`, poner la validación del id antes de «sin jobs» solo cambia el texto: los dos casos ya daban `fail`. Es coherente con `checkWorkflows`, que no pide jobs si el id no es entero.
- Runbook: la línea de `docs/operacion.md` que cita «el último run no tiene id verificable» ya existía y sigue siendo válida. Añadí un párrafo sobre el saneo y el recorte, con la forma de recuperar el run si el enlace se recorta.

## Hallazgos
- **H-ARQ-F21-01 (media, bloquea): el recorte a 300 puede quitar justo el enlace al run evaluado.** `assessWorkflow` pone el enlace ` — <html_url>` **al final** del detalle, después de juntar los problemas. Con producción activa, en `correo-alertas`, el caso «último run hace 149 h» + «duración no verificable» + «paso "Enviar correos" no terminó en success en todas sus apariciones (3 de 4: failure, cancelled, timed_out)» da 308 caracteres. La salida queda en `.../actions/runs/99…`: se pierde el id, que es el dato que el runbook usa en `gh api .../runs/<id>/jobs`. Con 2 de 3 da 296, al borde del límite. El enlace del candidato solo está en el log y en el resumen, no en el issue, así que ahí no hay respaldo. **Corrección dentro del ítem** (cualquiera de las dos):
  1. recortar solo la parte de problemas y conservar el enlace: sanear y recortar `problems.join('; ')` y añadir `link` después; o en `check.js`, sanear con un límite propio de detalle que deje espacio para el sufijo ` — https://...`;
  2. o subir `LOG_VALUE_MAX` para el detalle, por ejemplo a 1000. La protección contra comandos `::` viene de cambiar los controles por espacios, no de la longitud, y el `catch` de `checkWorkflows` ya limita los mensajes de error a 120.
  Añadir una prueba con un detalle de más de 300 caracteres que termine en enlace: el enlace debe salir completo.
- **H-ARQ-F21-02 (baja, informativa):** en la tabla del resumen, `|` se cambia por `/` después del saneo, así que la celda puede quedar en 300 caracteres más «…». Está bien. No se escapan otros caracteres de Markdown (`<`, `` ` ``). El resumen no ejecuta comandos de workflow, así que no hay riesgo de inyección. Solo se anota.
- **H-ARQ-F21-03 (baja, cerrada en esta revisión):** `docs/operacion.md` no explicaba el saneo ni qué hacer si el detalle sale con «…». Agregué el párrafo tras la descripción del issue de salud.
