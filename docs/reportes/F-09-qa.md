# F-09 — Informe QA
Veredicto: VERDE

Rama `item/F-09`. Revisión sobre 4a4272f (constructor: seguridad). Validación final sobre 5eed54d, que incluye las pruebas QA.

## Criterio de aceptación: cumplido (por punto)
| Punto | Estado | Evidencia |
|---|---|---|
| Se elimina el flujo archivo→petición, sin supresiones ni cambios a la config de CodeQL | Cumplido | `tests/security/api/_lib.js` ya no importa `node:fs`, `tmpdir` ni `join`. El diff no toca la config de CodeQL ni añade `lgtm`/`codeql[...]`. La consulta `FileAccessToHttp.ql` (security-extended) se evaluó y se subió en el job CodeQL del run 44740730995. La API de code-scanning responde 403 a esta sesión, así que el recuento de alertas abiertas en `main` se confirma tras el merge. |
| Ninguna prueba desactivada o debilitada | Cumplido | Las aserciones existentes no cambian. El reintento solo actúa ante 429 en `login()`. Ninguna prueba espera un 429 de `login()`: `auth-jwt` espera 400 con contraseña incorrecta y en el signup, y las pruebas de enumeración y rate limit (`api/preprod-s05`, `prod/fase-b`) usan `request`/`api` directamente, sin reintento. Si el 429 persiste, `loginAll` falla, no omite (prueba QA 4). |
| pentest-api con el mismo número de casos o más | Cumplido | `main` (run 44739006548): 559/559. `item/F-09` (44740730995 y 44741817502): 559/559, 0 omitidas. |
| CI, Seguridad y CodeQL en verde | Cumplido | En 5eed54d: CI 44741817546 success, Seguridad 44741817502 success (CodeQL js y actions, pentest-api, DAST, semgrep, gitleaks y npm audit en verde). |

## Tokens en logs
Busqué JWT (`eyJ….eyJ…`) en los logs completos de los jobs pentest-api y tests/security de los runs 44740730995 y 44741817502: 0 coincidencias. El paso solo muestra el script (`PENTEST_TOKENS="$(node …login-all.mjs)"`), no el valor, y no hay `set -x` ni `echo`. La prueba QA 7 confirma que `login-all.mjs` escribe en stdout solo el JSON y nada en stderr.

## Pruebas añadidas
`tests/security/qa-f09-token-flow.test.js`, 8 casos. Corren sin red, con `fetch` simulado y una instancia nueva de `_lib.js` por caso.
1. Con `PENTEST_TOKENS` válido no hay inicio de sesión (0 llamadas a fetch).
2. Con `PENTEST_TOKENS` vencido, JSON roto o `[]`, hay login real (7 llamadas) y la segunda llamada sale de la memoria.
3. Un 400 de Auth hace fallar `loginAll` sin reintento.
4. Un 429 persistente agota `LOGIN_RETRY.attempts` y hace fallar `loginAll`.
5. Una contraseña incorrecta tras un 429 sigue devolviendo el 400 que espera `auth-jwt`.
6. Retry-After: `1` da 1000 ms, `3600` queda topado en maxMs, y con `0`, sin cabecera o con un valor no numérico se usa el retroceso exponencial. No espera tras el último intento.
7. La stdout de `login-all.mjs` es exactamente el JSON de tokens. Con un `PENTEST_TOKENS` válido no usa la red.
8. Sin configuración, `login-all.mjs` sale con código distinto de 0 y stdout vacía, también con `PENTEST_REQUIRE=1`.

Local (Node 22): 14/14 entre la prueba del constructor y las de QA. CI tests/security: 584 → 592.

## Resultado CI
https://github.com/apivasa/practica_agente/actions/runs/44741817502 (Seguridad, success) y run 44741817546 (CI, success).

## Cobertura engine/
No aplica: F-09 no toca `engine/` y su cobertura no cambia. Sobre lo que sí cambia: `login-all.mjs` está al 100 % de líneas. En `_lib.js`, la prueba del constructor sola cubre el 74.6 % (le faltan `fromEnv`/`loginAll`, líneas 174-197). Las pruebas QA ejercitan todas las ramas de esas funciones, como muestran los conteos de llamadas, pero el reporte de `node --test` no las atribuye porque importan `_lib.js?…`. El resto (HTTP y psql) se ejercita en pentest-api.

## Hallazgos
- **Bajo, QA-F09-01.** Si `PENTEST_TOKENS` es inválido, se descarta en silencio y se vuelve al login real. No oculta fallos, porque el login real falla de forma visible, pero si `login-all.mjs` devolviera tokens que no pasan la validación, el job volvería a hacer 7 logins por archivo sin avisar y podría acercarse al límite de GoTrue. Sugerencia: un `console.warn` (sin el valor) cuando la variable existe pero no es válida. Para reproducirlo: exporta `PENTEST_TOKENS='{no-json'` y llama a `loginAll()`; inicia sesión sin aviso (prueba QA 2).
- **Informativo, QA-F09-02.** En el peor caso, un `login()` con 429 persistente y Retry-After alto espera hasta 5 × 60 s = 300 s antes de fallar. Está acotado, pero es lento. Sin acción.
- **Informativo.** Desde esta sesión no se puede leer la API de code-scanning (403). El orquestador debe confirmar 0 alertas abiertas (#14–#16 cerradas) en `main` tras el merge.
