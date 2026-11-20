# F-09 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no

**Superficie nueva:** ninguna. Solo cambia la infraestructura de pruebas del pentest de API. Esto cierra las alertas CodeQL `js/file-access-to-http` #14, #15 y #16 de `main`, en `numeric-safe-cap-m11.test.js:30`, `json-shape-m12.test.js:26` y `safe-cap-m14.test.js:24`.

**Rol:** constructor del ítem. La revisión independiente la hacen `tester` y `arquitecto-sre`.

## Cambios
- **`tests/security/api/_lib.js`:** se elimina la caché de tokens en `tmpdir`, que se leía con `readFileSync` y luego se enviaba con `fetch`. Ya no importa `node:fs`, `node:os` ni `node:path`. `loginAll()` obtiene los tokens en este orden:
  1. Caché en memoria del proceso.
  2. `PENTEST_TOKENS`, un JSON de rol a token pasado por entorno. Se valida que estén los 7 roles, que cada token tenga forma JWT y que venza en más de 5 minutos.
  3. Inicio de sesión real.
- **Reintento de `login()`:** ante un 429 de GoTrue reintenta como máximo 6 veces. Respeta `Retry-After`; si no viene, espera 2 s, 4 s, 8 s… con un tope de 60 s por espera. Cualquier otro código (200, 400…) se devuelve sin reintentar, así que las pruebas que esperan 400 no cambian.
- **`tests/security/api/login-all.mjs` (nuevo):** inicia sesión una sola vez y escribe el JSON en stdout.
- **`.github/workflows/seguridad.yml`, job `pentest-api`:** captura esa salida con `PENTEST_TOKENS="$(node …/login-all.mjs)"` y la exporta. Así los 10 archivos de prueba, que `node --test` ejecuta en procesos separados, comparten una sola ronda de 7 inicios de sesión. No queda archivo intermedio ni eco en el log, y la línea `node --test --test-concurrency=1 …` no cambia.
- **Otros patrones iguales:** busqué en `tests/`, `e2e/` y `scripts/` y no hay ninguno. Los demás `readFileSync` + `tmpdir` leen logs de stubs o archivos del repo y no acaban en peticiones HTTP.
- **Supresiones:** no hay comentarios de supresión ni cambios en la configuración de CodeQL. No se desactivó ni se debilitó ninguna prueba.

## Pruebas de seguridad añadidas
`tests/security/token-cache-f09.test.js`, 6 casos:
- **Categoría 6, regresión SAST (3 casos):**
  - Ningún archivo de `tests/security/api` usa `fs` ni `tmpdir`.
  - En `tests/`, `e2e/` y `scripts/` no hay lectura de `tmpdir` que acabe en `fetch`.
  - Los tokens pasan por entorno, sin redirección, `GITHUB_ENV` ni `echo`.
- **Categoría 2 (3 casos):**
  - `validTokens` acepta solo mapas completos y vigentes, y rechaza tokens vencidos, por vencer, incompletos o basura.
  - El reintento ante 429 está acotado y no reintenta otros códigos.

## Verificación local
`node --test 'tests/security/*.test.js' 'tests/workflows/*.test.js'` da 726 casos superados, 0 fallos y 2 omitidos. Los 2 omitidos ya lo estaban antes y dependen de `dist/`. Las pruebas de `tests/security/api` se omiten en local porque no hay Supabase. En CI se ejecutan con `PENTEST_REQUIRE=1`.

## Resultados del pipeline
Ver la sección «Runs» al final, que se completa tras el push.

## Hallazgos
Ninguno nuevo.

## Verificado sin hallazgos
Categorías 2 y 6.
