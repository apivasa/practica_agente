# F-21 — Informe QA

Veredicto: **VERDE**

Rama revisada: `item/F-21` (SHA del desarrollador `f79ae8a`). Objeto: `sanitizeLogValue` en `scripts/health/lib.js` y su uso en `scripts/health/check.js` e `issue.js` (H-F20-01), y el orden de validación de `requiredStepProblem` / `checkWorkflows` (H-ARQ-F20-03 = QA-F20-02).

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| (1a) Reemplaza `\r`, `\n`, 0x00-0x1f, 0x7f-0x9f, U+2028/U+2029 | Cumplido | Se probó cada code point de 0x00 a 0x1f y de 0x7f a 0x9f, más U+2028 y U+2029: todos pasan a un espacio. Los bordes de fuera no cambian: 0x20, `~` (0x7e), NBSP (0xa0), U+2027 y U+202A. `\r\n` da dos espacios. Objetos y `Error` se pasan a texto antes de sanear. |
| (1b) Recorta a 300 con «…» | Cumplido | 299 y 300 caracteres se dejan igual. Con 301 quedan 299 caracteres más «…», 300 en total. El recorte va después del reemplazo, así que un salto en la posición 300 no sobrevive. `max` igual a 1 o 2 se respeta. Un `max` negativo, decimal, de texto o `Infinity` vuelve a 300. |
| (1c) Ningún valor de la API abre una línea con `::` en el log ni en `GITHUB_STEP_SUMMARY` | Cumplido | El run de la API simulada trae `\n`, `\r`, NEL, LS, PS, VT y FF seguidos de `::stop-commands::`, `::add-mask::`, `::error::`, `::set-output` y otros, en `conclusion` y en `html_url`. Se probó con producción inactiva, con producción activa y con `HEALTH_PLAIN_LOG=1`. Ni el log, ni el resumen, ni `GITHUB_OUTPUT` tienen una línea que empiece con `::` aparte de las anotaciones del propio script. Cada fila del resumen tiene 3 celdas, también cuando el valor trae `\|`. Cada valor tiene como mucho 300 caracteres. `--only` con NEL, LS o PS sale en una sola línea con código 2. En `issue.js`, un `number` hostil del issue, ya sea creado o comentado, sale en una sola línea. |
| (1d) Los resultados ok/fail no cambian | Cumplido | `main` devuelve el `detail` original sin sanear y el código de salida sigue siendo 1. `failures=` incluye el check que falla. Un run en `success` con un `html_url` largo y hostil sigue en `ok`. `assessWorkflow` da el mismo estado con controles en `conclusion` que sin ellos. |
| (2) `candidate.id` no entero seguro → fail «el último run no tiene id verificable», sin pedir jobs | Cumplido | Se probó con 2^53, -2^53, `NaN`, `Infinity`, booleano, objeto, array, BigInt y texto vacío. En todos los casos sale fail con ese mensaje, nunca con «sin jobs del último run», y `listJobs` no se llama. Si el run más reciente no tiene id y uno antiguo sí, no se piden los jobs del antiguo. Con id 0, que es un entero seguro, sí se piden jobs. Sin producción el check queda en `skip` y no pide jobs. Con id inválido y `failure`, falla por la conclusión. El mensaje nombra el paso requerido de cada regla. |

## Pruebas añadidas

- `tests/scripts/qa-f21.test.js` (nuevo): 39 casos.
  - (1a): 7 casos.
  - (1b): 7 casos.
  - (1c) en `check.js`: 6 casos.
  - (1c) en `issue.js`: 2 casos.
  - (1d): 3 casos.
  - (2): 14 casos.
- El fuente no tiene caracteres de control, NBSP ni separadores literales; todos van como escapes `\uXXXX`. Lo comprobé con un escaneo por code point del archivo.

## Resultado local

`node --test tests/scripts/*.test.js tests/security/*.test.js`: 2864 tests, 2861 pass, 0 fail, 2 skipped y 1 todo. El todo es el que ya existía, H-C04-QA-01. Lint y e2e no se pueden correr aquí porque no hay `npm install`; se validan en el CI de la rama.

## Cobertura

- `engine/`: no aplica, F-21 no lo toca.
- `scripts/health/`, medido con las suites de salud y F-19 a F-21:
  - `lib.js`: 95,5 % de líneas.
  - `check.js`: 88,4 %.
  - `issue.js`: 75 %.
  - Las líneas que faltan en `check.js` (62-69) y en `issue.js` (16-20) son los bloques de entrada por CLI, que solo corren como proceso. `sanitizeLogValue` y `requiredStepProblem` quedan cubiertas del todo.

## Hallazgos

Ninguno bloqueante.

- **QA-F21-01 (info).** El recorte a 300 se aplica a todo el `detail`. Si una `conclusion` de la API es larga, el enlace al run (`— html_url`), que va al final del detalle, ya no aparece en el log ni en el resumen. El resultado, el código y el issue no cambian, así que solo se pierde el diagnóstico. Para reproducir: `checkWorkflows` o `main` con un run cuya `conclusion` tenga 400 caracteres; la línea de log termina en «…» sin la URL. Opcional: acotar la `conclusion` dentro del detalle antes de añadir el enlace.
- **QA-F21-02 (info, solo en las pruebas).** Al escribir el archivo, las secuencias `\u2028`, `\u2029` y `\u00a0` quedaron como caracteres literales y rompieron el regex: U+2028 termina la línea dentro de un literal `/.../`. Las cambié otra vez por escapes y lo comprobé con el escaneo. No es un defecto de la app.
