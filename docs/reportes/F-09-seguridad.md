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
Resultados sobre `a582efa`:

- **Seguridad**, [run 44739380017](https://github.com/apivasa/practica_agente/actions/runs/44739380017): verde en el intento 2.
  - En el intento 1, `pentest-api` no llegó a correr ninguna prueba: Supabase no arrancó porque el puerto 54322 estaba ocupado en el runner. Es un fallo de infraestructura que F-07 ya conoce, no del cambio.
  - En el intento 2, `pentest-api` superó los 559 casos, con 0 fallos y 0 omitidos, y el log no contiene ningún JWT (`eyJhbGci` aparece 0 veces).
  - `CodeQL (javascript-typescript)` y `CodeQL (actions)` dan success, igual que gitleaks, semgrep, npm audit, `security-tests` (incluye F-09) y DAST.
- **CI**, [run 44739380024](https://github.com/apivasa/practica_agente/actions/runs/44739380024): verde en el intento 2.
  - En el intento 1, `e2e/qa-v08.spec.js:107` falló de forma intermitente al iniciar sesión en el front: no apareció el botón «Cerrar sesión». Ese spec no usa `tests/security/api/_lib.js`, y `main` está en verde con el mismo spec.
- **Límite de verificación:** la sesión recibe 403 en la API de code scanning. El orquestador debe confirmar en el PR que el check «CodeQL» indica que no hay alertas nuevas. Después del merge, las alertas #14, #15 y #16 deben pasar a *fixed*.

## Hallazgos
Ninguno nuevo.

## Verificado sin hallazgos
Categorías 2 y 6.
