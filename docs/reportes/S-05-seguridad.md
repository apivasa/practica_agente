# S-05 — Informe de seguridad
Veredicto: VERDE (fase A). La fase B, contra producción, queda pendiente del primer despliegue.
Requiere cambiar alcance: no
Superficie nueva: en S-05 el constructor es seguridad. No hay código nuevo de la app. Se añade la superficie del pentest: el job `s05-fase-a`, que hace dos escaneos ZAP activos solo contra 127.0.0.1 del runner, y el job `s05-fase-b`, que es manual y no destructivo contra Pages y el Supabase real. También se revisa la superficie que abre V-05: front en `https://apivasa.github.io/practica_agente/`, Auth del proyecto real configurado desde el panel y no desde `config.toml`, posible `pg_graphql` activo, y los secretos de producción en `deploy.yml` y en los programados. Modelo de amenazas: sección "Superficie de producción (S-05)", T-PROD-01..07.

Informe completo: `docs/seguridad/pentest-preproduccion.md`.

## Pruebas de seguridad añadidas
- `tests/security/api/preprod-s05.test.js`: 72 casos, corre en `pentest-api` y es obligatorio.
  - Categoría 1: 3 de embebidos con alcance, 5 de esquemas ocultos por `Accept-Profile`/`Content-Profile` y 8 de GraphQL.
  - Categoría 2: 5 de Auth (settings, enumeración, refresh inventado, `jwt_expiry` ≤ 3600, admin con la clave publicable).
  - Categoría 3: 50 de inyección (21 sondas × 10 tablas × 5 actores, con alcance verificado) y 1 de integridad.
- `tests/security/preprod-s05.test.js`: 31 casos, corre en `security-tests`.
  - Categoría 2: 7 sobre `config.toml` (registro, proveedor de correo, anónimos y OAuth, `jwt_expiry`, rotación, redirecciones, rate limits).
  - Categoría 5: 20 de secretos en los 5 workflows (`VITE_` solo publicable, `db push` sin semilla ni `--debug`, environment en los jobs con credenciales de administración, sin PR), 1 de `deploy.yml` (se activa al fusionar V-05), 2 que vigilan que los jobs `s05-fase-a`/`s05-fase-b` estén acotados y 1 sobre la lista blanca de hosts de `fase-b.test.js`.
- `tests/security/prod/fase-b.test.js`: unos 35 casos, solo en `s05-fase-b`, que es manual.
  - Categoría 4: front publicado (HTTPS, HSTS, CSP, secretos, terceros, archivos de desarrollo).
  - Categoría 2: Auth real.
  - Categorías 1 y 3: API anónima, RPC, esquemas, GraphQL, JWT.
  - Modo `roles`: IDOR, escalada y auditoría con 4 cuentas de prueba.
- `.github/workflows/seguridad.yml`:
  - Input `fase_b` (`no` | `anonimo` | `roles`).
  - Job `s05-fase-a`, categoría 7: ZAP full scan del front con AJAX spider y ZAP API scan de PostgREST con la sesión de la gestora. Usa la imagen fijada por digest. Falla si hay riesgo alto, si aparece algún 401 (ZAP sin sesión), si PostgREST devuelve algún 5xx o si hay menos de 1000 peticiones.
  - Job `s05-fase-b`: environment `produccion`, solo desde `main`, sin clave secreta, ZAP de 1 hilo con retardo y duración acotada, sin escaneo activo de la API.
- `docs/seguridad/modelo-amenazas.md`: T-PROD-01..07 y su trazabilidad. `docs/seguridad/hallazgos.md`: H-S05-01..06; H-C02-01 pasa a corregido.

## Resultados del pipeline
Run de referencia: [Seguridad 44661334199](https://github.com/apivasa/practica_agente/actions/runs/44661334199), commit `37a440d`, con los 9 jobs en verde y `s05-fase-b` omitido como corresponde. [CI 44661334125](https://github.com/apivasa/practica_agente/actions/runs/44661334125) en verde.
- gitleaks (historial completo): verde.
- semgrep (JS, secretos, Actions, SQL): verde. En el primer intento marcó `unsafe-add-mask-workflow-command` por mi uso de `::add-mask::`; lo quité, porque las claves son locales y efímeras y no se imprimen.
- npm audit `--omit=dev`: 0 vulnerabilidades; 112 paquetes con firma verificada.
- CodeQL (JS y Actions): verde.
- `security-tests`: 485 casos, 485 pasan, 0 omitidos.
- `pentest-api`: 531 casos, 531 pasan, 0 omitidos.
- DAST (S-04, baseline + e2e de seguridad): verde.
- **ZAP full scan del front** (`s05-fase-a`): 15 URL, FAIL 0, WARN 5, PASS 138, sin riesgo alto.
- **ZAP API scan** (`s05-fase-a`): 80 URL, FAIL 0, WARN 4, PASS 116, sin riesgo alto. 43 850 peticiones: 0 × 401, 0 × 5xx, 200 en las lecturas base, 403 donde la gestora no tiene privilegio y 400 cuando el parser estricto de PostgREST rechaza el payload.
- Fase B: no se ha ejecutado. Requiere el primer despliegue (compuerta de la usuaria); el procedimiento está en `pentest-preproduccion.md` › Fase B.

## Hallazgos
No hay altos ni críticos abiertos.
- **H-C03-02 · Media · 5 · `evaluacion-mensual.yml`, `ritmo-diario.yml`.** Sigue abierto desde C-03. `SUPABASE_SECRET_KEY` se lee sin `environment:`. Si los secretos están a nivel de repo, cualquier workflow de una rama del repo los puede leer. Además, `environment: produccion` en `deploy.yml` solo protege si el environment existe con regla de ramas = `main`; si no existe, GitHub lo crea sin protección.
  - Reproducción: en una rama, un workflow con `on: push` y `env: K: ${{ secrets.SUPABASE_SECRET_KEY }}` recibe el valor.
  - Corrección: la usuaria crea el environment con regla `main`, mueve los 6 secretos y borra los del repo. El desarrollador añade `environment: produccion` a los dos jobs programados.
- **H-S05-01 · Media · 2 · panel de Auth del proyecto real.** `config.toml` no se aplica a producción. Un proyecto nuevo trae el registro abierto, contraseñas de 6 caracteres y Site URL `localhost`. Sin rol no se ven datos: está probado.
  - Reproducción tras el deploy: `GET https://<ref>.supabase.co/auth/v1/settings` con la clave publicable → `disable_signup: false`.
  - Corrección: la usuaria cierra el registro, fija Site URL y redirecciones a Pages y pone la contraseña mínima en 12 con complejidad. La fase B falla si el registro sigue abierto.
- **H-S03-02 · Baja · 2.** Sigue abierto: no hay política de contraseñas ni en `config.toml` ni en el panel. Corrección: el desarrollador pone `minimum_password_length = 12` y `password_requirements = "lower_upper_letters_digits"` en `config.toml`, y la usuaria lo mismo en el panel.
- **H-S05-03 · Baja · 1 · `pg_graphql` en producción.** En local está desactivado, así que su RLS no se probó con datos. Corrección: desactivarlo en el panel si no se usa. La fase B verifica la introspección anónima.
- **H-S05-04 · Baja · 3 · PostgREST 403 (ZAP 10099).** El `hint` revela `GRANT … ON public.<tabla> TO authenticated`. Aceptado.
- **H-S05-06 · Baja · 5 · `deploy.yml` › `verify` (rama `item/V-05`).** Recibe `SUPABASE_SECRET_KEY` solo para validar su formato. Corrección: quitarla de ese job.
- **H-S05-02 · Baja · 7.** Aceptado: la AJAX spider no inicia sesión; las vistas con sesión las cubren los e2e de `e2e/security/`.
- **H-S05-05 · Info · 4.** Aceptado: `Access-Control-Allow-Origin: *` en el gateway de Supabase no tiene impacto, porque la sesión viaja como bearer.

## Verificado sin hallazgos
- 1 · Autorización y RLS: las sondas con `or=`, `in=` y `not.and` hacia otra unidad, los embebidos y los esquemas ocultos no devuelven filas fuera del alcance de ningún rol. Las 10 tablas siguen con RLS. No hay RPC expuestas.
- 2 · Autenticación: registro cerrado, sin anónimos ni OAuth, sin enumeración de usuarios en el login, refresh token inventado rechazado, sesiones de 1 h o menos, y la clave publicable no abre `/auth/v1/admin/*`.
- 3 · Inyección: 1050 sondas específicas de PostgREST y unas 44 000 de ZAP sin ningún 5xx, ninguna espera inducida y ningún cambio de datos.
- 4 · Front: el full scan no encuentra XSS reflejado ni persistente, traversal, SSI ni bibliotecas vulnerables; la CSP sigue sin `unsafe-*`.
- 5 · Actions: solo la clave publicable llega a `VITE_*`; `db push` va sin semilla; `deploy.yml` es manual, solo desde `main` y verifica `dist/`.
- 6 · Cadena de suministro: gitleaks, semgrep, npm audit y CodeQL en verde.
- 8 · Auditoría: H-C02-01 corregido y verificado. La auditoría sigue sin poder modificarse por ningún rol (S-03 y la fase B en modo `roles`).

## Pendientes para el orquestador
1. Antes o junto al primer despliegue, registrar como compuerta de la usuaria: H-S05-01 (panel de Auth), H-C03-02 (environment `produccion` con regla `main` y secretos movidos allí), H-S05-03 (desactivar `pg_graphql`) y, de forma opcional, las 4 cuentas de prueba más el secreto `S05_TEST_USERS` para el modo `roles`.
2. Para V-05, pasar al desarrollador: H-S05-06 (`verify` sin la clave secreta), `environment: produccion` en los dos programados (H-C03-02) y H-S03-02 en `config.toml`.
3. Tras el despliegue: `gh api -X POST repos/apivasa/practica_agente/actions/workflows/seguridad.yml/dispatches -f ref=main -f 'inputs[fase_b]=anonimo'`. Después, enlazar el run en `pentest-preproduccion.md` › Resultados de la fase B.

## Intento 2 (respuesta a QA ROJO, `a397b1c`)
Commit `f96881b`. [Seguridad 44664594826](https://github.com/apivasa/practica_agente/actions/runs/44664594826) (workflow_dispatch con `fase_b = no`) está **verde**: los 9 jobs pasan y `s05-fase-b` queda omitido.
- **QA-S05-01 / H-ARQ-S05-01, corregido.** El `if` del job `s05-fase-b` exige ahora `github.ref == 'refs/heads/main'`. La guarda tiene `id: main-guard`, y los pasos «ZAP full scan de Pages» y «Sin alertas de riesgo alto (Pages)» llevan `if: ${{ !cancelled() && steps.main-guard.outcome == 'success' }}`. «Guardar informes» sigue con `always()`: solo sube archivos locales.
- **QA-S05-03, corregido.** Exclusión global de ZAP para todo lo que no esté bajo `https://apivasa.github.io/practica_agente/`, con el mismo mecanismo en la fase A (127.0.0.1:4173/practica_agente/). Además, el paso de alertas falla si alguna URI del informe queda fuera del subárbol. En la fase A funciona: el full scan pasó de 15 a 6 URL y desaparece la alerta 10098 del gateway, todo sigue en FAIL 0, WARN 5, PASS 138 y sin riesgo alto.
- **QA-S05-02, aclarado** (`pentest-preproduccion.md` › 2). El job comprueba ahora con `curl` la lectura base de cada tabla, y las 10 de 10 responden 200. Aun así, ZAP solo obtiene 3 respuestas 2xx en total: sus ataques llegan a SQL como mucho en 3 tablas. El API scan prueba la autenticación y la ausencia de 5xx; la cobertura de inyección de las 10 tablas la dan las 1050 sondas de `api/preprod-s05.test.js`.
- **QA-S05-04, corregido.** La búsqueda de Kong y el conteo de estados usan `awk` en lugar de `grep`, así que una búsqueda sin coincidencias ya no corta el paso por `pipefail`. Si falta Kong o el log está vacío, el job falla con su `::error::` propio: «no se encontró el contenedor Kong…» o «ZAP apenas atacó la API (0 peticiones)».
- **H-ARQ (bajo), aplicado.** `s05-fase-a` corre solo en `pull_request`, `schedule` y `workflow_dispatch` con `fase_b = no`, con `timeout-minutes: 30`. No filtro `github.base_ref == 'main'` porque en este repo todos los PR van a `main`.
- `tests/security/preprod-s05.test.js` exige las dos barreras, la exclusión de ZAP, la verificación de URI y los nuevos disparadores y timeout de la fase A.

**CI está en ROJO por una contradicción en la prueba de QA, no por el workflow.** Ver [CI 44664589136](https://github.com/apivasa/practica_agente/actions/runs/44664589136). `tests/workflows/qa-s05.test.js` › «S-05 · qué fase corre en cada evento» falla en 3 casos, que son justo los que contradicen los cambios 1 y 5 que pidió el orquestador:
- (a) `push: fase A sí`. Ahora la fase A ya no corre en push (H-ARQ).
- (b) y (c) `workflow_dispatch (fase_b=anonimo|roles): fase B sí`. El evaluador de la prueba solo define `github.event_name`, así que el nuevo `github.ref == 'refs/heads/main'` del job da falso.

El tester debe actualizar esos casos: push → fase A no, y añadir `ref: 'refs/heads/main'` (y un caso con otra rama → fase B no). No toqué esa prueba. El resto de `qa-s05.test.js` pasa, incluida «ningún paso que contacta producción corre si falla la comprobación de main».
