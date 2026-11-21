# F-11 — Informe QA

Veredicto: **VERDE** (intento 2; QA-F11-01, QA-F11-02 y QA-F11-03 cerrados)

Rama: `item/F-11` · commit revisado: `ed73630` (intento 2) · intento 1: `e5a34ce` (ROJO)

## Intento 2

### Criterio de aceptación

| # | Punto | Estado |
|---|---|---|
| 1 | H-V05c-01: punta de main en `verify`, salvo que lo posterior sea solo docs | **Cumplido.** Vuelvo a probar los dos bordes del intento 1: un renombrado `src/x.js → docs/x.md` cuenta como código (QA-F11-01) y un compare sin `files`, o con `files` que no es arreglo, falla cerrado (QA-F11-02). La carrera de dos merges seguidos (H-ARQ-F11-01) se resuelve así: si un merge más nuevo con código supera al run en su primer intento, `verify` emite `::warning::`, escribe exactamente `deploy=false`, sale con 0 y el run termina en verde sin publicar. Con `GITHUB_RUN_ATTEMPT` igual a `2`, `3`, vacío, `01`, `1 ` o `abc`, sale con `::error::` y 1 y no escribe `deploy=`. Con lista truncada, sin `files`, `behind`, `diverged` o la API caída, falla aunque sea el intento 1: esos casos no se tratan como la carrera prevista. Sin `GITHUB_OUTPUT`, también falla. Con la punta exacta, con solo docs detrás o con `workflow_dispatch`, escribe una sola línea `deploy=true`. `--strict` en `migrate` y `deploy-pages` (H-ARQ-F11-02, cierra QA-F11-03): si el run está superado, falla también en el intento 1 y nunca escribe en `GITHUB_OUTPUT`. Corre antes de `setup-cli` y antes de `actions/deploy-pages`. Un argumento desconocido o de más falla sin consultar la API. |
| 2 | H-V05c-03a: `clean_error` quita `\r` | **Cumplido** (sin cambios desde el intento 1). Además, el filtro de `wait-ci.sh` ya no cuenta un run sin `head_sha` o sin `event`, ni uno con `head_sha` nulo, de otro commit o con `event` `pull_request`. |
| 3 | H-C06-01: fail-closed | **Cumplido** (sin cambios). |
| 4 | P3: suma de timeouts ≤ `maxPendingMin` | **Cumplido** (75 ≤ 90; los jobs no cambiaron de timeout). |
| 5 | QA V-07b: negativo en notación científica | **Cumplido** (sin cambios). |

### Prueba propia ajustada

`tests/workflows/deploy.test.js` tenía la prueba «ningún paso de la cadena se salta por evento». Prohibía todo `if:` en `verify`, `build-pages`, `migrate-plan` y `migrate`, y chocaba con el `if:` que pidió arquitectura (H-ARQ-F11-01). La intención se mantiene y la prueba queda más estricta que antes:

- Ahora recorre **todos** los jobs (antes eran 4) y mira los `if:` de job y de paso.
- Solo admite un `if:` en `build-pages`, a nivel de job y con el texto exacto `if: needs.verify.outputs.deploy == 'true'`.
- Ningún `if:` puede depender de `github.event*`, `github.run_attempt`, `github.ref` ni `github.actor`.

### Pruebas añadidas (intento 2)

- `tests/scripts/qa-f11.test.js`: 26 casos nuevos, 59 en total.
  - [P1-a] carrera de merges y salida `deploy` (16 casos).
  - [P1-b] `--strict` (4 casos).
  - [P1-c] filtro estricto de `wait-ci.sh` (6 casos).
  - `withFakeGh` acepta ahora argumentos para el script.
- `tests/workflows/deploy.test.js`: 1 caso reescrito (el descrito arriba).

### Resultado local

`npm run test:unit`: 2900 pruebas, 2897 pasan y ninguna falla. Hay 2 omitidas (pentest-api sin Supabase local; corren en `seguridad.yml`) y 1 `TODO` previo y conocido (H-C04-QA-01). CI: ver los runs de la cabeza de `item/F-11` tras este commit.

### Cobertura engine/ (intento 2)

Líneas: 100 % en todos los archivos menos `commitment.js` (99,35 %). La meta es ≥ 95 %.

### Hallazgos (intento 2)

- Ninguno bloqueante. QA-F11-01, QA-F11-02 y QA-F11-03 quedan cerrados.
- **Informativo:** con `deploy=false` el run aparece en verde aunque no publicó. Lo indica el `::warning::` de `verify` y los jobs aparecen como saltados. El arquitecto lo aceptó (H-ARQ-F11-01) y la salud lo trata como `ok`.

---

## Intento 1 (histórico)

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
