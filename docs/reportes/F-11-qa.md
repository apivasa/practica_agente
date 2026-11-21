# F-11 — Informe QA

Veredicto: **ROJO** (dos hallazgos bajos en el punto 1; los demás puntos se cumplen)

Rama: `item/F-11` · commit revisado: `e5a34ce`

## Criterio de aceptación

| # | Punto (plan-maestro, fila F-11) | Estado |
|---|---|---|
| 1 | H-V05c-01: `verify` de `deploy.yml` comprueba que el SHA sigue siendo la punta de main, salvo que lo posterior sea solo docs | **No cumplido del todo.** El paso existe en `verify`, va después de `wait-ci.sh` y todos los jobs dependen de `verify`. Se cumplen la punta exacta, código posterior → 1, solo `docs/**`/`*.md` → 0, el límite de 299/300 archivos, `behind`/`diverged`/`identical` → 1, API caída → 1 tras reintentos y `workflow_dispatch` exento. Fallan dos bordes de «solo docs»: QA-F11-01 y QA-F11-02. |
| 2 | H-V05c-03a: `clean_error` quita `\r` | **Cumplido** en `wait-ci.sh` y en `check-main-tip.sh`. La salida no tiene `\r` ni el token, y no aparece ningún comando `::error::` o `::warning::` inyectado al inicio de línea. |
| 3 | H-C06-01: fail-closed (código 2) si la BD no implementa `recipientAccess`/`expiredEmailAlerts`/`markAlertsEmailSkipped` | **Cumplido.** Si falta cualquiera de los tres o no es una función: código 2 y `::error::` con los nombres. No se lee la BD, no se envía nada y no se audita. Una BD de clase con los métodos en el prototipo se acepta. Con los tres métodos se sigue comprobando el rol (un líder de otra unidad no recibe correo). Sin `RESEND_API_KEY` sigue en 0 sin abrir la BD. |
| 4 | P3: prueba de que la suma de `timeout-minutes` de `deploy.yml` ≤ `maxPendingMin` | **Cumplido.** La suma es 25+10+10+15+10+5 = 75 ≤ 90. Cada job fija su `timeout-minutes` y ninguno es una expresión. |
| 5 | QA V-07b: negativo de Excel en notación científica → «≥ 0» | **Cumplido.** Probé `-1E+21`, `-2.5E+22`, `-1.7976931348623157E+308`, `-1E-7`, `-2.5E-10`, `-1E-300` y `-4.9E-324`: dan «número ≥ 0» (o «entero ≥ 0» en vulnerabilidades) y nunca «posible fórmula». El valor mostrado se recorta. Sin regresión: un positivo con exponente no se trata como negativo, -0.5 sigue con «≥ 0», 0 se acepta, y el texto `-1E+21` (CSV o inlineStr) sigue como posible fórmula. |

## Pruebas obsoletas actualizadas (dueño de `tests/`)

El punto 3 vuelve obsoletas, por diseño, cuatro pruebas de C-05: usaban BD simuladas sin los métodos de C-06. Añadí a esas BD simuladas un ayudante `withC06` con tres métodos:

- `recipientAccess`: devuelve un `unit_leader` vigente de la unidad de las alertas del destinatario.
- `expiredEmailAlerts`: devuelve `[]`.
- `markAlertsEmailSkipped`: no hace nada y devuelve `[]`.

Lo apliqué solo en esas cuatro pruebas y no relajé ninguna aserción:

- `tests/scripts/email-c05.test.js`: «fallos de Resend: ::warning:: y código 0…» y «errores de la BD: código 1».
- `tests/scripts/qa-c05.test.js`: «error de Resend en una alerta no detiene las demás…» y «Resend devuelve la clave o el correo en el error…».

## Pruebas añadidas

- `tests/scripts/qa-f11.test.js`: 33 casos.
  - [P1] (20): punta exacta; código posterior; seis rutas desplegables (migraciones, engine, workflow, package.json, index.html, el propio script); solo docs y `.md` en cualquier carpeta; límite 299/300; `behind`/`diverged`/`identical`; borrado de código; renombrado de código a docs; compare sin `files`; API caída en commits y en compare; SHA anómalo; eventos; y que todo job dependa de `verify`.
  - [P2] (2): `\r`, token e inyección de comandos de workflow, en los dos scripts.
  - [P3] (8): faltan los tres; falta cada uno por separado; método que no es función; BD de clase; la comprobación de rol sigue activa; sin clave → 0.
  - [P4] (2): suma de timeouts y timeouts que no son expresiones.
- `tests/engine/qa-f11.test.js`: 14 casos del punto 5.

## Resultado CI

Ver el run de CI de la cabeza de `item/F-11` tras este commit. Localmente (`node --test` con todo `tests/**`): 2736 pruebas; pasan todas menos las dos de QA-F11-01 y QA-F11-02. Hay además un `TODO` previo y conocido (H-C04-QA-01).

## Cobertura engine/

Líneas: 100 % en todos los archivos salvo `commitment.js`, que queda en 99,35 %. El total de `engine/` queda por encima del 99,9 % (meta ≥ 95 %). `measurements-input.js` y `xlsx.js` están al 100 % de líneas.

## Hallazgos

- **QA-F11-01 (Bajo): un renombrado de código a docs cuenta como «solo docs».**
  - Qué pasa: `check-main-tip.sh` solo mira `.filename`. Si un commit posterior renombra `src/x.js` a `docs/x.md`, la API de compare lo devuelve como `{status: "renamed", filename: "docs/x.md", previous_filename: "src/x.js"}` y el script responde 0. Así despliega el commit viejo aunque lo desplegable de la punta ya cambió (el archivo de código ya no existe), en contra de la premisa del propio script («lo desplegable de la punta es idéntico a este commit»).
  - Cómo reproducir: prueba «renombrado src/x.js → docs/x.md…» en `tests/scripts/qa-f11.test.js`.
  - Arreglo sugerido: exigir que también `previous_filename`, si existe, sea `docs/` o `.md`.
- **QA-F11-02 (Bajo): sin lista de archivos, el script asume «solo docs» (falla abierto).**
  - Qué pasa: si la respuesta de compare llega con `status: "ahead"` pero sin el campo `files`, el filtro `(.files // [])` la trata como «solo docs» y el script responde 0. Sin lista de archivos no se puede afirmar «solo docs», y el script dice fallar cerrado ante una respuesta inesperada.
  - Cómo reproducir: prueba «respuesta de compare sin el campo files…».
  - Arreglo sugerido: exigir que `.files` sea un arreglo (`(.files | type) == "array"`).
- **QA-F11-03 (Bajo, informativo, no bloquea): un «Re-run failed jobs» puede saltarse la comprobación.**
  - Qué pasa: la comprobación solo vive en `verify`. Si en un run viejo falló un job posterior (`migrate`, `deploy-pages` o `smoke`) y luego alguien usa «Re-run failed jobs» con main ya avanzada, GitHub no vuelve a correr `verify`, que había terminado bien. Los jobs relanzados migran o publican sin volver a comprobar la punta.
  - Por qué no bloquea: el criterio pide el paso en `verify` y eso se cumple; esto es riesgo residual de H-V05c-01. Además, los mensajes nuevos de `wait-ci.sh` advierten de no relanzar commits viejos.
  - Arreglo sugerido: repetir `check-main-tip.sh` al inicio de `migrate` y de `deploy-pages`.
- **Informativo:** `timeout-minutes` no cuenta el tiempo en cola (concurrencia `despliegue-produccion`) ni la espera del environment. La suma de 75 min acota la ejecución, no el tiempo total de un run pendiente.
