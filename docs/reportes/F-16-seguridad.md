# F-16 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. No hay endpoints, tablas, permisos ni workflows nuevos. El cambio endurece el check `deploy-main` de `salud.yml` (`scripts/health/lib.js`). `parseApiTime` exige ISO 8601 con zona (`API_TIME_RE`), y eso cubre también `newerPendingRun`. Si dos completados tienen el mismo `created_at`, gana el `id` mayor (`compareIdDesc`). Un pendiente con `run_started_at` ilegible o futuro mide el atasco con `created_at`. Corrige H-F15-01, H-F15-02 y H-F15-03. Modelo de amenazas: T-F16-01.

## Pruebas de seguridad añadidas

`tests/security/health-deploy-f16.test.js`: 17 casos, todos de la categoría 5 (automatizaciones). Corren con `node --test` en el job de pruebas de seguridad de `seguridad.yml`.

- **`API_TIME_RE` / `parseApiTime` (8 casos).**
  - Probé 33 formatos límite y todos dan NaN: solo año, solo fecha, sin zona, sin segundos, separador espacio, `t`/`z` en minúscula, offset `+0500` o `+05`, `GMT`, punto sin decimales, más de 9 decimales, año expandido `±YYYYYY`, saltos de línea, espacios, NUL o basura antes o después, dígitos Unicode (ancho completo y arábigo-índicos), mes 13, hora 25, minuto o segundo 60, offset `+24:00`/`+99:99` y RFC 2822.
  - Los valores que no son string dan NaN, incluidos un objeto con `toString`/`valueOf` hostiles, un `String` envuelto y un `Date`.
  - Los offsets equivalentes dan el mismo instante. Un futuro escrito con offset tampoco esquiva `FUTURE_SKEW_MIN`.
  - ReDoS: cuatro entradas de alrededor de 1 MB tardan menos de 500 ms en total. El regex no tiene flags `g`/`y`, así que no guarda estado.
  - Un `failure` con fecha no ISO da `fail`. Un pendiente o un fallo con fecha no ISO no se cubren en `newerPendingRun` ni en `assessDeploy`.
- **Empates de `created_at` (5 casos).**
  - La reproducción de H-F15-02 da `fail` en todas las permutaciones.
  - Probé 5 escenarios de 4 runs empatados en sus 24 permutaciones (`ok`/`warn`/`fail` según el id mayor).
  - El mismo instante escrito con offsets distintos cuenta como empate.
  - Un pendiente empatado con el fallo no lo cubre.
  - Los ids enteros de 2^40 se ordenan bien.
- **`run_started_at` malo (3 casos).** Usé 8 valores malos, futuros incluidos. El pendiente viejo da `fail`, medido con `created_at`. El reciente no da atasco y no cubre un fallo aislado. Un `run_started_at` antiguo sigue contando como atasco.
- **Fuzz (1 caso).** Generé 4000 listas con muchos empates, orden aleatorio y 15 % de fechas malas en `created_at` y en `run_started_at`. Siempre que el resultado es `ok`, no hay completados inválidos y el más reciente por (`created_at`, `id`) es `success`.

Regresión local (`node --test tests/security/health-*.test.js tests/scripts/*.test.js`): 823 casos, 822 pasan, 0 fallos. Queda 1 `todo` anterior de QA (H-C04-QA-01), que no toca este ítem.

Cambio del desarrollador en `tests/scripts/f15-fixes.test.js`: las dos aserciones que esperaban `ok` con `run_started_at` futuro o de tipo número ahora esperan `fail`. Es lo que pide H-F15-03 y endurece la prueba, no la debilita. Es un archivo del tester, así que lo debe validar QA.

## Resultados del pipeline

Los runs de Seguridad y CI sobre el commit de este informe en `item/F-16` aparecen en
`https://github.com/apivasa/practica_agente/actions?query=branch%3Aitem%2FF-16`. El orquestador confirma `success` antes del merge.

## Hallazgos

Intenté forzar un falso `ok`/`warn` con formatos límite, ReDoS, ids no enteros y empates. Los tres hallazgos de F-15 quedan corregidos. Quedan dos de severidad Info. Ninguno se explota sin controlar la API de GitHub, que siempre manda ISO 8601 UTC e ids enteros:

- **H-F16-01 · Info · 5 · `scripts/health/lib.js` (`compareIdDesc`).** Si dos completados empatan en `created_at` y algún `id` no es un entero seguro (texto, decimal o mayor que 2^53), el comparador da 0 y vuelve a decidir el orden de entrada. Repro: dos runs `push`/`completed` con el mismo `created_at`, el primero `success` con id `'1'` y el segundo `failure` con id `'2'`: el resultado es `ok`. En orden inverso da `fail`. Con tres runs empatados y un id no entero, el comparador deja de ser transitivo. Corrección sugerida: si hay empate y los ids no se pueden comparar, tratarlo como indeterminado (`fail`) u ordenar primero el que no es `success`.
- **H-F16-02 · Info · 5 · `API_TIME_RE` + `Date.parse`.** El regex valida la forma pero no el rango. V8 acepta `2027-02-30` (lo pasa al 2 de marzo) y `T24:00:00`. La fecha solo se desplaza a otro instante válido y pasado, así que no produce un `ok` falso. Aceptado. Opcional: rechazar la fecha si `toISOString()` no coincide con los componentes.

## Verificado sin hallazgos

- 5 (automatizaciones): `salud.yml` no tiene permisos ni disparadores nuevos. El regex es lineal y está anclado. Ningún formato límite, empate con ids enteros o `run_started_at` manipulado produce `ok`/`warn` (fuzz incluido).
- 6 (secretos): el diff no tiene literales con forma de clave o token.
- 1–4, 7, 8: el ítem no los toca. La regresión completa corre en `seguridad.yml`.
