# F-21 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. F-21 corrige H-F20-01 con `sanitizeLogValue` (`scripts/health/lib.js`). La función cambia por un espacio cada carácter C0, DEL, C1 (incluido U+0085 NEL), U+2028 y U+2029, y recorta el valor a 300 code points terminando en «…». Se aplica en `scripts/health/check.js` (línea de cada resultado, `--only` inválido, error no capturado y cada celda del resumen, con `|` cambiado por `/`) y en `scripts/health/issue.js` (número de issue y error no capturado). El resto del diff reordena la validación de `candidate.id` en `requiredStepProblem`: falla igual, solo cambia el mensaje. No hay endpoints, permisos, secretos, workflows ni dependencias nuevos. El modelo de amenazas no cambia.

Pruebas de seguridad añadidas: `tests/security/health-log-f21.test.js`, 24 casos, categorías 5 (automatizaciones) y 3 (inyección):
- Barrido Unicode (1 caso). Recorre todo U+0000..U+2FFF y luego U+3000..U+10FFFF a pasos de 0x101, sin sustitutos. Cada control o separador queda como espacio, el resto no cambia y la salida es siempre una sola línea. Cuentan como salto LF, CR, VT, FF, FS, GS, RS, NEL, LS y PS.
- Entradas raras (1 caso): sustituto suelto, objeto con `toString` hostil y 600 000 caracteres de `\n::`. La salida queda acotada.
- `check.js` de extremo a extremo con la API de Actions hostil (8 casos). Son 4 modos por 2 valores de `HEALTH_PLAIN_LOG`:
  - Modos: `conclusion` y `html_url` hostiles; run en success con nombre y `conclusion` de paso hostiles; `fetch` que rechaza con un mensaje hostil; `json()` que lanza `SyntaxError` con un mensaje hostil.
  - Cada valor lleva 12 separadores (incluidos CR solo, CRLF, NEL, U+2028, U+2029, VT, FF, RS, NUL, ESC y CSI de C1) seguidos de `::add-mask::`, `::stop-commands::`, `::error file=…::` y `|`.
  - Se comprueba que el doble inyecta de verdad: algún `detail` crudo trae salto.
  - En el log, cada línea es una sola línea sin controles, y una línea solo puede empezar por `::` si es un prefijo propio del script (`::error::FALLA`, `::warning::omitido|aviso`).
  - En el resumen hay exactamente encabezado, separador y una fila por resultado. Cada fila tiene 3 celdas sin `|` interno y de 300 caracteres como máximo.
  - `GITHUB_OUTPUT` es una sola línea `failures=` con nombres de check fijos.
- `issue.js` (10 casos): `number` hostil del issue abierto o del recién creado, con LF, CR solo, U+2028, NEL u objeto con `toString`. El log es una sola línea `issue #…` sin comando.
- Inventario estático de puntos de impresión en `scripts/health/` (4 casos):
  - `lib.js` no imprime ni escribe archivos.
  - En `check.js` e `issue.js`, toda interpolación de `log`, `console.*`, `appendFileSync`/`writeFileSync`, `process.std*.write` y la línea de filas del resumen pasa por `sanitizeLogValue` o `cell`, o es una constante de una lista cerrada (`tag`, `failures.join(',')` y el ternario creado/comentado). No hay concatenación con `+`.
  - El resumen usa `cell()` en las tres columnas.
  - Una impresión nueva sin sanear hace fallar la prueba.

El fuente de la prueba no tiene caracteres de control ni espacios irregulares literales. Todo va con escapes y no hay regex con escapes de control (`no-control-regex`). En local, `node --test tests/security/health-log-f21.test.js tests/scripts/f21-fixes.test.js 'tests/security/health-*.test.js'` da 592 de 592.

Verificación manual de los puntos de impresión de `scripts/health/` (completa):
- `check.js:22`: `--only` saneado.
- `check.js:48`: `check` y `detail` saneados. `tag` es constante.
- `check.js:51`: `GITHUB_OUTPUT` lleva solo nombres de check de `WORKFLOW_RULES`, `DEPLOY_RULE` y de disponibilidad, que son constantes.
- `check.js:53-55`: las tres celdas pasan por `cell`.
- `check.js:57`: `JSON.stringify` de un número y de los nombres de check constantes.
- `check.js:65` e `issue.js:17`: mensaje de error saneado.
- `issue.js:11`: número saneado.
- El cuerpo del issue (`issueBody`) ya filtraba los checks con `^[a-z0-9-]{1,40}$` y `RUN_URL` con una regex anclada de URL de run. No cambia.

Resultados del pipeline:
- Commit f79ae8a (desarrollador): Seguridad `success`, https://github.com/apivasa/practica_agente/actions/runs/44924911200. CI `cancelled` (sustituido por el push siguiente), https://github.com/apivasa/practica_agente/actions/runs/44924911210.
- Commits f707c85 (arquitectura) y 2ddce69 (estas pruebas): runs `cancelled`, sustituidos por el push siguiente.
- Commit 4c2d802 (QA, incluye estas pruebas): Seguridad `success` (gitleaks, semgrep, npm audit, ZAP, `tests/security/*.test.js` y pentest), https://github.com/apivasa/practica_agente/actions/runs/44925653549. CI `failure`, https://github.com/apivasa/practica_agente/actions/runs/44925653560. Falla solo el lint (`no-control-regex`, escapes `\x0b` y `\x0c` en una regex) de `tests/scripts/qa-f21.test.js:26:20`, que es un archivo de QA. Lo corrige el tester. `tests/security/health-log-f21.test.js` no da errores de lint, y los jobs `db` e `integración` dan `success`.
- gitleaks, semgrep, npm audit, ZAP y `tests/security/*.test.js` corren en `seguridad.yml`.
- La revisión manual del diff `main...item/F-21` no encontró `sb_secret_`, `sb_publishable_` con valor, `ghp_`, `ghs_`, `github_pat_`, JWT, `AKIA` ni claves privadas. El diff no toca dependencias, workflows ni el front.

Hallazgos:
- **H-F21-01 · Informativa · 5/3 · caracteres de formato y markdown en log y resumen.**
  - Dónde: `scripts/health/lib.js` (`sanitizeLogValue`) y `scripts/health/check.js` (`cell`).
  - Qué pasa: los caracteres de formato Unicode (U+200B..U+200F, U+202A..U+202E, U+2066..U+2069, U+FEFF) y la sintaxis markdown o HTML (enlaces, `<img>`, backticks) pasan sin cambios al log y a `GITHUB_STEP_SUMMARY`. Eso permite falsear lo que se ve, por ejemplo con un override bidi o un enlace en una celda.
  - Por qué es Informativa: no abre línea nueva ni inyecta comandos de workflow ni rompe la tabla, porque `|` y los saltos ya se neutralizan. GitHub sanea el HTML del resumen. Además, los valores vienen de la respuesta autenticada de la API de GitHub del propio repositorio: `conclusion` es un enum, `html_url` lo genera GitHub y los nombres de paso los escriben quienes ya tienen escritura.
  - Reproducir: `sanitizeLogValue('ok\u202Eliaf')` devuelve el valor igual.
  - Corrección opcional: añadir a `isLogControl` las categorías Unicode `Cf` (`/\p{Cf}/u`) y escapar `[`, `<` y los backticks en `cell`.
  - Registrado en `docs/seguridad/hallazgos.md` como riesgo residual aceptado. No se propone ítem.
- **H-F20-01** pasa a «Corregido en F-21» en `docs/seguridad/hallazgos.md`.

Verificado sin hallazgos:
- 5 (automatizaciones): inyección de comandos `::` desde conclusión, nombre de paso, `html_url`, mensajes de error y número de issue, incluidos NEL, U+2028/2029 y CR solo; `GITHUB_OUTPUT`; cuerpo del issue.
- 3 (inyección): tabla markdown del resumen.
- 6 (secretos en el diff).
- No aplican en este ítem: 1, 2, 4, 7 y 8.
