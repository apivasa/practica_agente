# V-04 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: workflow programado `salud.yml` (cada 6 h + `workflow_dispatch` sin inputs) que lee la API de Actions con `github.token` (`actions: read`), hace GET a Pages y a `SUPABASE_URL/auth/v1/health` con la clave publicable, y abre o comenta issues con la etiqueta `salud` en el repo público (`issues: write`, solo job `alert`). `scripts/health/{check,issue,lib}.js`. Paso nuevo en `ci.yml` (`scripts/ci/health.sh`) contra Supabase local y un servidor 127.0.0.1.

Pruebas de seguridad añadidas:
- `tests/security/workflows.test.js` (+3 casos, cat. 5): salud.yml solo `schedule`/`workflow_dispatch` sin inputs ni `environment`, sin `SUPABASE_SECRET_KEY`/`sb_secret_`; `issues: write` exactamente una vez y en `alert`, `check` sin escrituras, `alert` sin `secrets.`, ningún otro `*: write`, sin `${{ }}` en `run:`; `ci.yml` sigue sin secretos y `health.sh` exige loopback y no imprime la clave. Además, salud.yml queda cubierto por las reglas genéricas (permissions de nivel superior, SHA + comentario, sin `pull_request_target`/`workflow_run`, `persist-credentials: false`, no imprime secretos). Verificado por mutación: añadir `issues: write` en `check` hace fallar la prueba.
- `tests/security/health-v04.test.js` (7 casos, cat. 5 y 8): log/resultados sin clave, URL de Supabase ni cuerpo de respuesta ante 200, 500 y error de red cuyo mensaje lleva URL y clave; clave secreta/JWT/vacía rechazada sin mostrar el valor; la clave solo viaja por cabecera y solo a la URL de Supabase; `safeUrl` rechaza http remoto, `file:`, `javascript:`, `data:`; `checkHttp` no copia el mensaje del error; `parseFailures` descarta menciones, markdown, saltos de línea y nombres largos; `issueBody` descarta `RUN_URL` ajena o con query y no contiene datos sensibles ni menciones.

Resultados locales: `node --test 'tests/security/*.test.js'` → 464 tests, 462 pass, 0 fail, 2 skip preexistentes (requieren `dist/`, corren en `seguridad.yml`).
Resultados del pipeline: gitleaks · semgrep · npm audit · ZAP · pentest RLS/API — pendientes del run de `seguridad.yml` en la rama `item/V-04` (este informe no hace push; el orquestador enlaza los runs). El ítem no toca BD, RLS, front ni dependencias npm.

Hallazgos:
- H-V04-01 · Baja · 5 · `scripts/health/lib.js:58` (`redirect: 'follow'`). El GET a Supabase sigue redirecciones: la cabecera `apikey` (publicable) se reenvía a un destino cross-origin y el destino no se revalida con `safeUrl`. Reproducir: `SUPABASE_URL` que responda 302 a otro host; el fetch reenvía `apikey`. Impacto bajo (la clave ya es pública en `dist/`). Corrección: `redirect: 'manual'` para Supabase y tratar 3xx como falla. Registrado en `docs/seguridad/hallazgos.md`.
- H-V04-02 · Info · 5 · `workflow_dispatch` desde otra rama ejecuta código modificado con `issues: write`; requiere escritura en el repo y no hay secretos privilegiados. Aceptado.

Verificado sin hallazgos:
- 5 Automatizaciones: permisos mínimos por job (`contents: read` global; `actions: read` en check; `issues: write` solo en alert); acciones por SHA con versión; `persist-credentials: false`; sin `pull_request_target`; `FAILURES` y `RUN_URL` pasan por `env:` y se sanean (`[a-z0-9-]{1,40}`, regex de github.com); sin inputs que manipular; salud no aplica ni quita candados (solo lee).
- 5/8 Fuga en repo público: el issue lleva solo nombres de check, hora y enlace al run; los `detail` (que pueden incluir `html_url` de runs, públicos) van solo al log/summary del run, nunca la URL de Supabase ni la clave; errores de GitHub muestran método, ruta y estado HTTP sin token.
- 2 Claves: solo `SUPABASE_PUBLISHABLE_KEY` (se exige prefijo `sb_publishable_`); ninguna clave legada ni secreta.
- CI: `health.sh` aborta si `API_URL` no es `127.0.0.1`/`localhost`; sin `set -x` ni eco de la clave; `ci.yml` sigue sin `secrets.`.
- Modelo de amenazas: corregido (salud.yml no usa la clave secreta) y añadidas T-JOB-12..14.
- Categorías 1, 3, 4, 6, 7: sin superficie nueva (sin tablas, front ni dependencias).
