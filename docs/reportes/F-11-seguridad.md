# F-11 — Informe de seguridad

Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: `scripts/ci/check-main-tip.sh` (paso «Commit vigente en main» del job `verify` de `deploy.yml`; consulta `commits/main` y `compare/<sha>...<punta>` con el `github.token` de solo lectura). También revisé `clean_error` sin `\r` en los dos scripts, el fail-closed de `runEmailStep` (H-C06-01) y la expansión de negativos de Excel en notación científica (`engine/xlsx.js` `numberText`). Revisé la rama `item/F-11` hasta e5a34ce, más el informe de arquitectura 7ae90fc, que solo toca docs y `salud.yml`.

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
- Seguridad sobre 79b7e59: gitleaks en rojo por el literal `re_TESTKEY_f11_123456`. El commit siguiente lo resolvió (ver «Entrada de `.gitleaksignore`»). https://github.com/apivasa/practica_agente/actions/runs/44876912625
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
- **Entrada de `.gitleaksignore`.** `79b7e59c5ccb83a97a7498602127114ca8efd608:tests/scripts/f11-fixes.test.js:generic-api-key:178` es una huella exacta: commit completo, archivo, regla y línea, y la línea 178 de ese commit tiene `RESEND_API_KEY: 're_TESTKEY_f11_123456'`. Es ficticia, sin formato de clave real de Resend, y en la punta la clave se arma en ejecución (`['re','TESTKEY','f11','ficticia'].join('_')`). gitleaks del historial completo pasa en e5a34ce. Correcta.
- **Categorías no tocadas por el ítem.** 1 (RLS/API), 2, 4 y 6 siguen cubiertas por la regresión del pipeline, en verde.

## Nota para el orquestador (no es un hallazgo de seguridad)

- **CI en rojo en e5a34ce por el fail-closed.** Las pruebas de C-05 con una BD simulada sin los métodos de C-06 devolvían 2, que es lo esperado. QA migró esas BD simuladas en 5b44639 sin relajar ninguna aserción; lo comprobé y es la salida correcta. Tras el merge, en local solo quedan en rojo las 2 subpruebas de QA-F11-01/02 (`tests/scripts/qa-f11.test.js:68`), que corresponden a H-F11-03/04.
- **El endurecimiento de H-QA-V05c-03 choca con una prueba del desarrollador.** `tests/scripts/f11-fixes.test.js` («el filtro jq conserva los valores por defecto // $sha y // "push"») fija el filtro laxo. Cuando el desarrollador endurezca `wait-ci.sh`, tendrá que actualizar esa prueba. Las de seguridad ya están preparadas.
