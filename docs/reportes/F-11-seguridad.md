# F-11 — Informe de seguridad

Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: `scripts/ci/check-main-tip.sh` (paso «Commit vigente en main» del job `verify` de `deploy.yml`; consulta `commits/main` y `compare/<sha>...<punta>` con el `github.token` de solo lectura). También revisé `clean_error` sin `\r` en los dos scripts, el fail-closed de `runEmailStep` (H-C06-01) y la expansión de negativos de Excel en notación científica (`engine/xlsx.js` `numberText`). Revisé la rama `item/F-11` hasta e5a34ce, más el informe de arquitectura 7ae90fc, que solo toca docs y `salud.yml`. Intento 2 (ed73630): añade la salida `deploy` de `verify`, el `if:` de `build-pages`, el modo `--strict` en `migrate` y `deploy-pages` (con su checkout nuevo y `contents: read`), `previous_filename`, `files` que no es arreglo y el filtro estricto de `wait-ci.sh`. Ver la sección «Intento 2».

## Pruebas de seguridad añadidas

- `tests/security/deploy-f11.test.js` (88 casos, categorías 5 y 1/8). Ejecutan el script con bash y un `gh` falso enrutado por la ruta exacta de la API.
  - Eventos no admitidos (`pull_request_target`, `schedule`, `workflow_run`, `PUSH`, `push\n…`) y `HEAD_SHA`, `GITHUB_REPOSITORY`, `TIP_RETRIES`, `TIP_RETRY_INTERVAL_SECONDS` y `GH_TOKEN` hostiles: falla sin llamar a la API.
  - Camino feliz: una sola consulta. La comparación va en el orden `commit...punta`.
  - Falla cerrado si `commits/main` devuelve un SHA en mayúsculas, corto, nulo, numérico o multilínea, un array, algo que no es JSON o una respuesta vacía. También falla cerrado si `gh` o compare fallan siempre: sale con 1 tras los reintentos y sin imprimir el token.
  - Inyección de `\r`, `::error::`, `::add-mask::` y `::set-output` en el error de `gh`.
  - Status `behind`, `diverged`, `identical`, vacío, nulo, `AHEAD` o `ahead `: falla.
  - 24 rutas desplegables o parecidas a docs (`docsx/a.js`, `docs.js`, `src/docs/app.js`, `README.MD`, `a.md.js`, `src/x.mdx`, `x.md `…) y `files` con `filename` nulo, numérico o ausente: falla.
  - Con 300 archivos falla y con 299 pasa.
  - Los `paths-ignore` de `deploy.yml` coinciden con el filtro del script. El paso no lleva `if:` ni `continue-on-error`.
  - H-C06-01: una BD de C-05, un método que no es función o un `makeDb` que devuelve null, 42 o `'db'` dan código 2. Con un Proxy compruebo que no se envía nada, no se lee ninguna alerta y la clave no sale en el log. La ruta de producción pasa por `runEmailStep`.
- `tests/security/xlsx-import-f11.test.js` (38 casos, categoría 3).
  - CSV: 17 cargas útiles siguen siendo «posible fórmula»: `-1e3`, `-1E+21`, `-1,5e3`, `-1e3+cmd`, `=HYPERLINK(...)`, `-0x10`, `-Infinity`, `- 1`, entre otras. También en `unidad` y `categoria`.
  - XLSX: una celda de texto con `-1e3` o `@SUM(A1)` sigue siendo fórmula. Un `<v>` manipulado (`-1e3x`, `-0x10`, `-1E+400`, `=1+1`) se rechaza. Los negativos expandidos (`-5E-324`, `-1.79E+308`, `-1e-30` → `-0`) se rechazan con «≥ 0», con un mensaje corto que solo lleva `-` y dígitos.
- `tests/security/deploy-v05c.test.js`: el fixture `run()` ahora trae `head_sha` y `event`, como la API real (H-QA-V05c-03). Lo probé con el filtro endurecido en local (`select(.head_sha == $sha and .event == "push")`, cambio temporal ya revertido): `deploy-v05c.test.js` y `deploy-v05c-2.test.js` dan 113/113.
- Regresión local de `node --test 'tests/security/*.test.js'`: 1168/1168.

Modelo de amenazas: T-F11-01..05 y T-CI-10 actualizado. Registro: `docs/seguridad/hallazgos.md`, con H-F11-01..05; H-V05c-01 queda parcial, H-V05c-03(a) y H-C06-01 quedan corregidos.

## Resultados del pipeline

- Seguridad sobre e5a34ce: success. Pasan gitleaks del historial completo, semgrep, npm audit, CodeQL (JS y actions), DAST/ZAP baseline, pentest API y tests/security. https://github.com/apivasa/practica_agente/actions/runs/44877286872
- Seguridad sobre 7ae90fc: success. https://github.com/apivasa/practica_agente/actions/runs/44878280429
- Seguridad sobre 79b7e59: gitleaks en rojo por el literal de la clave ficticia `re_TESTKEY_…`. El commit siguiente lo resolvió (ver «Entrada de `.gitleaksignore`»). https://github.com/apivasa/practica_agente/actions/runs/44876912625
- CI sobre e5a34ce y 7ae90fc: rojo en `build (lint, unit, build)`. No es un hallazgo de seguridad, pero bloquea el merge: ver la nota para el orquestador. https://github.com/apivasa/practica_agente/actions/runs/44878280466

## Valoración de la excepción «solo docs» de `check-main-tip.sh`

- **Equivale a los `paths-ignore` del deploy.** `startswith("docs/")` equivale a `docs/**`, y `endswith(".md")` a `**/*.md`; los dos distinguen mayúsculas igual que el glob de GitHub. Ningún `.md` entra en `dist/`: no hay `public/` ni importaciones `?raw` en `src/` o `vite.config.js`. Tampoco entra en las migraciones. Por eso un commit «solo docs» no cambia lo desplegable de la punta.
- **Compare es acumulativo (`base...head`).** Un código intermedio queda visible aunque lo tape un commit posterior de docs. Si se revierte a cero, el árbol desplegable es idéntico y desplegar es correcto.
- **Lista truncada.** Con 300 archivos o más, falla.
- **Inyección.** SHA y repositorio se validan por regex antes de cualquier llamada, y la punta exige 40 hex minúsculas. No hay `eval` ni interpolación de datos de la API en un comando. Lo único que se imprime sin sanear es el `status` (H-F11-05, Info).
- **Fail-closed.** Funciona ante error de `gh`, JSON inválido y filtro vacío o falso (`jq -e`, `|| exit 1`). Hay dos huecos: `files` ausente se trata como lista vacía (H-F11-04) y los renombres solo miran el nombre nuevo (H-F11-03).

## Hallazgos

- **H-F11-01 · Baja · 5 · `deploy.yml` jobs `migrate` y `deploy-pages`.**
  - Problema: la comprobación de la punta solo corre en `verify`.
  - Cómo reproducir: un run viejo cuyo `deploy-pages` falló, relanzado con *Re-run failed jobs* después de que otro commit con código se publicara. Solo se relanzan `deploy-pages` y `smoke`, y se publica el artefacto del intento anterior encima del front nuevo.
  - Corrección sugerida: repetir `check-main-tip.sh` al principio de `migrate` y antes de `actions/deploy-pages` (checkout disperso de `scripts/ci` y `contents: read`), o prohibirlo en `docs/despliegue.md`.
- **H-F11-02 · Baja · 5 · `check-main-tip.sh` (`workflow_dispatch` → `exit 0`).**
  - Problema: un *Re-run* de un disparo manual viejo reutiliza `confirm=desplegar` y `github.sha`, y vuelve a publicar ese commit.
  - Corrección sugerida: aplicar la misma regla de la punta también en `workflow_dispatch`.
- **H-F11-03 · Baja · 5 · `check-main-tip.sh` `cmp_filter`.**
  - Problema: un renombre `src/app.js → docs/app.js` (o una migración movida a `docs/`) cuenta como «solo docs».
  - Cómo reproducir: `echo '{"status":"ahead","files":[{"filename":"docs/app.js","previous_filename":"src/app.js","status":"renamed"}]}' | jq -er "$cmp_filter"` da `docs`.
  - Corrección sugerida: evaluar también `previous_filename`.
- **H-F11-04 · Baja · 5 · fail-open · `check-main-tip.sh` (`.files // []`).**
  - Cómo reproducir: `{"status":"ahead"}` o `files: null` dan `docs`, y se despliega.
  - Corrección sugerida: exigir `(.files | type) == "array"`.
- **H-F11-05 · Info · 5 · `check-main-tip.sh`, mensaje final.**
  - Problema: el `status` de compare se imprime sin sanear dentro de `::error::`. Lo controla GitHub.
  - Corrección sugerida: `gsub("[^a-z_]"; "")` en el filtro.

H-F11-03 y H-F11-04 coinciden con QA-F11-01 y QA-F11-02 del informe de QA. QA ya los cubre con pruebas en rojo en `tests/scripts/qa-f11.test.js` («renombrado de código a docs», «compare sin `files`»), así que su corrección se verifica ahí y en la próxima revisión de seguridad. No dupliqué esas pruebas en rojo. H-F11-01, 02 y 05 quedan en el registro con su reproducción para el ítem que los corrija. No se omitió ni se desactivó ninguna prueba.

## Verificado sin hallazgos

- **(2) `clean_error`.** Quita `\r` antes de sustituir el token y `::` en `wait-ci.sh` y en `check-main-tip.sh`. No se inyecta ninguna línea `::`.
- **(3) H-C06-01.** Cerrado en la ruta de producción (`scripts/send-alert-emails.js` → `runEmailStep`). `createDb` implementa los tres métodos. `sendAlertEmails` conserva la vuelta a C-05 solo para llamadas directas; hoy solo la hace `scripts/ci/email-integration.js`, con BD real.
- **(5) Excel y CSV.** No hay regresión de fórmulas: `-1e3` en CSV y en celdas de texto de Excel sigue siendo «posible fórmula». La expansión solo afecta a números finitos negativos de celdas numéricas, y se rechazan igual.
- **Entrada de `.gitleaksignore`.** `79b7e59c5ccb83a97a7498602127114ca8efd608:tests/scripts/f11-fixes.test.js:generic-api-key:178` es una huella exacta: commit completo, archivo, regla y línea, y la línea 178 de ese commit asigna a la variable de la clave de Resend el literal ficticio `re_TESTKEY_…`. Es ficticia, sin formato de clave real de Resend, y en la punta la clave se arma en ejecución (`['re','TESTKEY','f11','ficticia'].join('_')`). gitleaks del historial completo pasa en e5a34ce. Correcta.
- **Categorías no tocadas por el ítem.** 1 (RLS/API), 2, 4 y 6 siguen cubiertas por la regresión del pipeline, en verde.

## Nota para el orquestador (no es un hallazgo de seguridad)

- **CI en rojo en e5a34ce por el fail-closed.** Las pruebas de C-05 con una BD simulada sin los métodos de C-06 devolvían 2, que es lo esperado. QA migró esas BD simuladas en 5b44639 sin relajar ninguna aserción; lo comprobé y es la salida correcta. Tras el merge, en local solo quedan en rojo las 2 subpruebas de QA-F11-01/02 (`tests/scripts/qa-f11.test.js:68`), que corresponden a H-F11-03/04.
- **El endurecimiento de H-QA-V05c-03 choca con una prueba del desarrollador.** `tests/scripts/f11-fixes.test.js` («el filtro jq conserva los valores por defecto // $sha y // "push"») fija el filtro laxo. Cuando el desarrollador endurezca `wait-ci.sh`, tendrá que actualizar esa prueba. Las de seguridad ya están preparadas.

## Intento 2 (cabeza ed73630)

Veredicto del intento 2: VERDE. No requiere cambiar el alcance.

### gitleaks (rojo provocado por este informe)

- Causa: en a9fecda, la línea 69 de este informe citaba completa la clave ficticia de prueba `re_TESTKEY_…`. Huella: `a9fecdafc152454404ef864e9e228972f5e81130:docs/reportes/F-11-seguridad.md:generic-api-key:69`. https://github.com/apivasa/practica_agente/actions/runs/44879994782
- Corrección: reescribí las dos citas (líneas 31 y 69) sin el literal. El literal sigue en el historial publicado de la rama y no se reescribe la historia, así que añadí esa huella exacta a `.gitleaksignore` con su justificación. La clave no es una credencial: no tiene formato de clave de Resend y en la punta se arma en ejecución. El commit a9e1bc6 no tocó esa línea y gitleaks solo reportó a9fecda.

### Pruebas añadidas

`tests/security/deploy-f11-2.test.js` tiene 58 casos, todos de la categoría 5. En local pasan 58/58, y la regresión de `tests/security` también pasa.

- **Salida `deploy`.**
  - Punta igual al commit: `deploy=true` una sola vez.
  - Superado en el intento 1: `deploy=false` y nunca `true`.
  - Superado con `GITHUB_RUN_ATTEMPT` en `2`, `3`, vacío, `01`, ` 1`, `1\ndeploy=true`, `0`, `-1` o `uno`, o sin la variable: sale con 1 y no escribe nada.
  - `behind`, `diverged`, `identical`, vacío o `AHEAD` en el intento 1: sale con 1, no con un `deploy=false` silencioso.
  - `files` ausente, null, objeto o string, 300 archivos o un archivo sin nombre: sale con 1, sin `true` ni `false`.
  - Sin `GITHUB_OUTPUT`: sale con 1.
  - Hay una sola escritura en `GITHUB_OUTPUT` y `set_deploy` solo recibe los literales `true` o `false`.
- **Renombres.** `src/app.js → docs/app.js`, `migración → docs/x.md`, `index.html → README.md` y `package.json → docs/` no cuentan como docs. Un `previous_filename` que no es string tampoco. `README.md → docs/b.md` sí cuenta como docs, así que no hay falsos positivos.
- **`--strict`.**
  - Punta o solo docs: sale con 0 sin escribir en `GITHUB_OUTPUT`.
  - Superado en los intentos 1, 2 o desconocido: sale con 1 siempre.
  - `--STRICT`, `-s`, `--strict=0`, `--strict x`, un `--strict` duplicado, `--no-strict` o `strict`: sale con 1 sin consultar la API.
- **`deploy.yml`.**
  - `outputs.deploy` sale solo del paso `tip`, que no lleva `--strict`. `verify` no tiene otro `id`.
  - El único `if:` de `build-pages` es exactamente `needs.verify.outputs.deploy == 'true'`. `migrate-plan`, `migrate`, `deploy-pages` y `smoke` no tienen `if:` ni `continue-on-error`. No hay `always()`, `!cancelled()` ni `failure()`.
  - La cadena de `needs` está completa: Pages necesita `[build-pages, migrate]`.
  - En `migrate` y `deploy-pages`, el `--strict` va antes de `supabase db push` y de `actions/deploy-pages`. Su paso no redefine `GITHUB_EVENT_NAME`, `GITHUB_RUN_ATTEMPT` ni los reintentos, y el checkout previo está fijado por SHA y con `persist-credentials: false`.
  - `deploy-pages` tiene exactamente `contents: read`, `pages: write` e `id-token: write`, y no lee secretos. `migrate` solo tiene `contents: read`.
- **`wait-ci.sh`.** El filtro exige exactamente `select(.head_sha == $sha and .event == "push")`, sin valores por defecto `//`.

### Valoración de los cambios

- **¿Se puede forzar `deploy=true`?** No.
  - El valor es un literal del script y lo escribe un solo paso (`id: tip`) en su propio `GITHUB_OUTPUT`.
  - Las entradas que lo deciden son las variables que pone el runner (`GITHUB_EVENT_NAME`, `GITHUB_RUN_ATTEMPT`) y la API de GitHub con el token del job. Ningún `env:` del workflow las redefine.
  - Un `GITHUB_RUN_ATTEMPT` manipulado o raro cae en el camino de error, y una respuesta de compare mal formada da `unknown`, que también falla.
  - La única forma de saltarse la comprobación es `workflow_dispatch` (H-F11-02). Exige escritura en el repo, `confirm=desplegar`, la rama `main` y el environment `produccion`.
- **¿Se pueden saltar las migraciones y dejar el front desfasado del esquema?** No, por las vías nuevas.
  - `deploy=false` salta toda la cadena en bloque: un job con `needs` sobre un job saltado también se salta, y ninguno lleva `always()`.
  - `deploy-pages` necesita `migrate`, y no hay ningún camino que publique sin haber migrado.
  - Relanzar solo un job reutiliza las salidas de `verify` del intento anterior. Si eran `false`, el `if:` sigue en falso.
  - Queda una ventana transitoria, que ya existía ante cualquier fallo de Pages después de migrar. La registro como H-F11-06 (Info).
- **Un run en verde que no publica.** Si el run B, que supera a A, termina en rojo (por ejemplo, porque falla su CI), A queda en verde sin publicar y producción sigue en la versión anterior, coherente entre front y esquema. Es disponibilidad, no integridad, y B en rojo ya avisa. No es un hallazgo.
- **`--strict` y el checkout nuevo de `deploy-pages`.** El checkout no persiste credenciales. `contents: read` es lo mínimo que necesitan el checkout y `commits/main`/`compare` en un repo público. `GITHUB_TOKEN` no sale en ningún log, porque `clean_error` lo sustituye. Es correcto.
- **`previous_filename` y `files` que no es arreglo.** Las sondas con jq dan `code ahead` para un renombre con origen desplegable o un `previous_filename` que no es string, y `unknown sin lista de archivos` para `files` ausente, null, objeto o string. H-F11-03 y H-F11-04 quedan corregidos.
- **Filtro de `wait-ci.sh`.** Un run sin `head_sha` o sin `event` ya no cuenta. H-QA-V05c-03 queda cerrado del lado de seguridad.
- **H-F11-02 (`workflow_dispatch` sigue exento).** Se mantiene en **Baja**, propuesto como ítem.
  - El alcance ahora es algo mayor: `--strict` también sale con 0 en `workflow_dispatch`. Un *Re-run failed jobs* de un disparo manual viejo pasa también en `migrate` y `deploy-pages`.
  - El impacto está acotado. El esquema no retrocede, porque `db push` desde un commit viejo falla si la BD tiene migraciones que ese commit no conoce. El front sí puede retroceder a una versión anterior que ya pasó todas las compuertas.
  - El actor es interno, con escritura y acceso al environment `produccion`.
  - Corrección sugerida: quitar la exención. `verify` exige `refs/heads/main`, así que un disparo nuevo siempre despliega la punta y pasaría la comprobación. La exención no tiene ningún uso legítimo.

### Hallazgos del intento 2

- H-F11-01, H-F11-03 y H-F11-04: corregidos.
- H-F11-02 · Baja: sigue abierto, con el alcance ampliado a `--strict`.
- H-F11-05 · Info: sigue abierto. En ed73630, `{"status":"ahead\n::error::x"}` todavía da un veredicto de dos líneas.
- **H-F11-06 · Info · 5 · `deploy.yml`, `deploy-pages --strict` después de `migrate`.**
  - Cómo reproducir: el run A espera la aprobación de `migrate` y mientras tanto entra B con código. `migrate` de A pasa y migra, y `deploy-pages` de A falla. El front queda una versión por detrás del esquema hasta que el run B, en cola, publica.
  - Corrección sugerida: documentar que ese rojo es esperado y que no se relanza, o saltar `deploy-pages` en verde en el intento 1.

Registro actualizado en `docs/seguridad/hallazgos.md`: H-F11-01, 03 y 04 corregidos, H-V05c-01 corregido salvo H-F11-02, y H-F11-06 nuevo. Modelo de amenazas: T-F11-01 actualizado y T-F11-06 nuevo.

### Nota para el orquestador (no es un hallazgo de seguridad)

- CI sobre ed73630 está en rojo solo por `tests/workflows/deploy.test.js:247` («ningún paso de la cadena se salta por evento (sin if: en verify, build, plan ni migrate)»). Es una prueba del tester que choca con el `if:` nuevo de `build-pages`. https://github.com/apivasa/practica_agente/actions/runs/44879994788
- Lo que esa prueba protege (que ningún job se salte **por evento**) sigue cumpliéndose: el `if:` depende de la salida del script, no de `github.event_name`. `deploy-f11-2.test.js` fija que ese `if:` es exactamente la comparación con `'true'` y que no hay más. Ajustar esa prueba le toca al tester, no al desarrollador.
