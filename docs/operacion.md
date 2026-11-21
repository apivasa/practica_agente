# Operación — runbook

Dueño: arquitecto-SRE. Zona horaria de negocio: America/Guayaquil (UTC-5, sin horario de verano).
Producción publicada desde el 2026-11-20 (V-05, run 44838844787: migraciones aplicadas y Pages en `https://apivasa.github.io/practica_agente/`); pentest fase B en modo `anonimo` en VERDE (S-05b, run 44839422473). Mientras no exista `vars.EVALUATION_ENABLED='true'` (P-05), `evaluacion-mensual` y `ritmo-diario` terminan en verde sin evaluar, y `salud.yml` (V-04) omite los checks `pages` y `supabase`: **la producción publicada aún no se vigila ni se sondea**, y el plan gratuito puede pausar el proyecto tras 7 días sin actividad. Ver «Activación de producción (P-05)». La salud se sigue probando en CI contra Supabase local (job `integration` de `ci.yml`).

Consultas útiles (solo REST, ver CLAUDE.md §5):
- Runs de una rama: `gh api 'repos/apivasa/practica_agente/actions/runs?branch=<rama>&per_page=6' --jq '.workflow_runs[]|{id,name,event,conclusion}'`
- Jobs y duración: `gh api repos/apivasa/practica_agente/actions/runs/<id>/jobs --jq '.jobs[]|{name,started_at,completed_at,conclusion}'`
- Log de un job: `gh api repos/apivasa/practica_agente/actions/jobs/<job_id>/logs`
- Relanzar: `gh api -X POST repos/apivasa/practica_agente/actions/runs/<id>/rerun-failed-jobs`

## Workflows y tiempos base

Medidos en `item/S-01` y actualizados en `item/S-02-S-03` e `item/C-03-C-04` (2026-11-19, `ubuntu-latest`). Los jobs de cada workflow corren en paralelo salvo `e2e`, que espera a `build`.

| Workflow | Disparadores | Job | Base | Alerta si |
|---|---|---|---|---|
| `ci.yml` | PR; push a `main`, `item/**`, `fix/**`; manual (y desde `lockfile.yml`) | build (lint, unit, build) | 16–23 s | > 2 min |
| | | db (pgTAP, CLI Supabase 3.2.0) | 66–74 s | > 4 min |
| | | e2e (Playwright, tras build) | 26–29 s | > 3 min |
| | | integration (Supabase local + `evaluate.js` mensual y diaria ×2 + `verify-evaluate.sql`) | 69–71 s | > 4 min |
| | | **total de pared** | **~70–95 s** | > 5 min |
| | | db (pgTAP, CLI Supabase 3.2.0) | 69–74 s | > 4 min |
| | | e2e (Playwright + Supabase local desde F-05, tras build; desde V-01..V-03 con «Evaluar la semilla») | 118–135 s desde V-01..V-03; 197 s en el run 44635617337 por `playwright install` lento (109 s). Desglose: `supabase start` 41–64 s, Playwright install 16–109 s, evaluación de la semilla 1–2 s, pruebas 19–25 s. Antes: 85–113 s; antes de F-05: 26–28 s | > 4 min |
| | | **total de pared** | **~2 min** (desde F-05; antes ~70 s) | > 5 min |
| `seguridad.yml` | PR; push a `main`, `item/**`, `fix/**`, `ensayo/**`; lunes 06:17 UTC (01:17 Guayaquil); manual | gitleaks | 8 s | > 2 min |
| | | semgrep | 24 s | > 3 min |
| | | npm audit | 11 s | > 2 min |
| | | CodeQL (actions) | 39 s | > 5 min |
| | | CodeQL (javascript-typescript) | 50–62 s | > 6 min |
| | | pruebas de seguridad (258 casos; las de `tests/security/api/` se omiten aquí) | 7–25 s | > 2 min |
| | | pentest-api (Supabase local + 428 casos PostgREST/Auth) | 74–93 s | > 5 min (timeout del job: 30 min) |
| | | dast (desde S-04: Supabase local + build + e2e de seguridad + ZAP baseline) | 162–185 s (de ellos `supabase start` ~68 s, ZAP baseline ~64 s, Playwright install ~16 s, e2e ~11 s) | > 6 min (timeout del job: 30 min) |
| | | **total de pared** | **~3 min** (desde S-04 lo marca dast; antes ~75–95 s por pentest-api) | > 7 min |
| `evaluacion-mensual.yml` | cron `7 11 1 * *` (día 1, 06:07 Guayaquil); manual con `as_of` | evaluate (mensual) | sin base (aún sin producción); < 10 s si se omite | > 5 min (timeout 15 min) |
| `ritmo-diario.yml` | cron `23 11 * * *` (06:23 Guayaquil); manual con `as_of` | evaluate (diario) | sin base; < 10 s si se omite | > 5 min (timeout 15 min) |
| `salud.yml` | cron `41 */6 * * *` (00:41, 06:41, 12:41, 18:41 UTC); manual | check (disponibilidad + API de Actions) | sin base aún; < 30 s esperado (sin `npm ci`) | > 3 min (timeout 10 min) |
| | | alert (solo si check falla) | < 20 s esperado | > 2 min (timeout 5 min) |
| `lockfile.yml` | push a `item/**`, `fix/**` que cambie `package.json`; manual (nunca en `main`) | lockfile | < 30 s | > 2 min |

Fuentes: CI run 44597648985, Seguridad run 44597649643 (S-01); CI run 44605484960 y Seguridad run 44605484997 (S-02+S-03, ambos `success`); referencia previa CI run 44594674729.
Desde F-05 el job e2e levanta Supabase local (Auth + API + semilla) con la CLI 3.2.0 y construye el front con `VITE_SUPABASE_URL` y la clave publicable que expone `supabase status`; si falla en «Exportar URL y clave publicable», la CLI cambió el formato de `status -o env` (revisar nombres `API_URL` / `PUBLISHABLE_KEY`). El total de pared de CI pasa a ~2 min (e2e y db corren en paralelo). Fuente e2e: CI run 44606117086 (rama `item/F-05`) frente a 44605255030 (`main`).

Fuentes: CI run 44597648985, Seguridad run 44597649643 (ambos `success`); referencia previa CI run 44594674729.
Fuentes: CI run 44606812249 (C-03+C-04: build 12 s, db 67 s, integration 69 s, e2e 29 s) y 44606007143 (integration 71 s); CI run 44597648985, Seguridad run 44597649643 (S-01); CI run 44605484960 y Seguridad run 44605484997 (S-02+S-03, ambos `success`); referencia previa CI run 44594674729.

Fuente M-02..M-04: CI run 44614924089 (`item/M-02-M-03-M-04`: build 27 s, db 73 s, integration 77 s, e2e 85 s; total de pared ~114 s). Los fallos previos de la rama (runs 44611063764 y 44613324671, jobs integration y e2e) fueron defectos reales de la semilla y del e2e, corregidos en e31beb2; no son intermitencia.

V-01..V-03 (2026-11-19, rama `item/V-01-V-02-V-03`): el job e2e agrega el paso «Evaluar la semilla» (`scripts/ci/seed-evaluations.sh`, que corre `evaluate.js` mensual ×2 y diaria ×1 contra Supabase local; ADR 0013). Ese paso tarda **1–2 s** y las pruebas e2e pasan a **19–25 s**. El job completo midió 118–132 s en los runs 44630802132, 44631993693 y 44634478066, y 197 s en el run 44635617337 (`success`). En este último, `playwright install --with-deps` tardó 109 s, cuando lo normal son 16–38 s: fue la red del runner, no el paso nuevo. Nueva base del e2e: **118–135 s**, con alerta si pasa de 4 min. Si `playwright install` vuelve a superar los 90 s en dos runs seguidos, se aplica la regla de paso intermitente y se propone cachear `~/.cache/ms-playwright` por versión del lockfile. Los tres fallos de e2e de la rama fueron defectos reales: los e2e de V-01..V-03 no toleraban filas creadas por M-02 y C-02, y el texto del enlace de V-02 chocaba con el e2e de C-02. Se corrigieron en 18ae59d, 30be5ca, e2f42b1 y 8403b5a. No hubo intermitencia.
- Si falla «Evaluar la semilla»: revisa la última línea JSON de `evaluate.js` (`errors`). Si el error es `H-C01-02` o es de configuración, cambiaron la semilla o las fechas del script. Corrige la semilla o el script, nunca los e2e. El script se niega a correr si `API_URL` no es loopback.

Tasa de fallos observada: en `main`, los fallos/cancelaciones del 2026-11-19 vienen de la puesta en marcha (cancelaciones por concurrencia y un fallo antes del lockfile), no de pasos intermitentes. En `item/S-01`, un solo fallo de Seguridad (run 44595333304) causado por la rama `ensayo/s01-secreto` y corregido en el ítem. Ningún paso intermitente detectado todavía. En `item/S-02-S-03`, los dos fallos de `pentest-api` (runs 44604283956 y 44604729716) fueron defectos reales de las pruebas, corregidos en commits posteriores; no son intermitencia.

S-04 (2026-11-19, rama `item/S-04`): job dast medido en Seguridad runs 44610609487 (162 s), 44611568177 (185 s) y 44612384789 (177 s), todos `success`. En el último, pentest-api tardó 169 s (base 74–93 s): primera vez sobre el doble de la base; si se repite en el siguiente run se registra como ítem (regla de abajo). Probable causa: dast y pentest-api levantan cada uno su Supabase local en paralelo y compiten por la descarga de imágenes. Los fallos de los dos primeros commits de la rama (runs 44609093018, 44609853829) fueron defectos reales de las pruebas de anti-framing, corregidos; no intermitencia.

V-04 (2026-11-19, rama `item/V-04`): **primer paso intermitente confirmado.** `pentest-api` falló en Seguridad run 44638730859 en `supabase start` con `failed to bind host port 0.0.0.0:54322/tcp: address already in use` y pasó al relanzarlo sin cambios. Por la regla de abajo se propone como ítem de plan (ver informe `docs/reportes/V-04-arquitectura.md`): fijar puertos propios por job en `supabase/config.toml` no es posible (un solo archivo), así que la propuesta es un paso previo que verifique el puerto libre con reintento, o `supabase start` con un reintento acotado y log de quién ocupa el puerto (`ss -ltnp`). CI run 44638730844: integration 87 s con el paso nuevo `scripts/ci/health.sh` (base 69–77 s; el paso añade ~12 s por el reintento de 10 s de la caída simulada).
Posible intermitencia (2026-11-19): Seguridad run 44634155934 en `main` falló en pentest-api, paso «Levantar Supabase local», con `failed to bind host port 0.0.0.0:54324/tcp: address already in use` (contenedor inbucket). Es del runner, no del código. Superado por F-07: `scripts/ci/supabase-start.sh` reintenta solo y ya no se relanza a mano. Si se repite pese al reintento, ítem: fijar puertos distintos por job o desactivar `inbucket` en los jobs que no usan correo.
Cierre (F-10, 2026-11-20): causa raíz probable, puerto efímero de origen en el rango de Supabase; mitigado por F-10 (job 136313873270 como evidencia: 3 intentos fallidos en 54322 sin ningún proceso en LISTEN ni contenedor que retuviera el puerto). La hipótesis no queda probada. Vigilancia durante 2 semanas tras el merge: contar en `main` los `::notice::` «arrancó en el intento N» con N > 1. Si aparece alguno con la reserva aplicada, la hipótesis queda refutada y se abre un ítem nuevo.

Regla: un job que supera dos veces seguidas el doble de su base, o que falla y pasa al relanzarlo sin cambios, se registra como ítem de plan (paso intermitente).

## Qué hacer si falla seguridad.yml

Primero identifica el job fallido (consulta de jobs arriba) y lee su log. Nunca se resuelve con `continue-on-error`, `|| true`, bajando `--audit-level` ni quitando reglas: lo prohíben CLAUDE.md §4 y `tests/security/workflows.test.js`.

1. **gitleaks** (`leaks found: N`)
   - Descarga el artefacto `gitleaks-report` (SARIF, redactado) para ver archivo, commit y regla.
   - Si el secreto es **real**: trátalo como comprometido. Rotarlo es compuerta del usuario: registra en `docs/pendientes-usuario.md` y notifica. No reescribas historia publicada; tras la rotación se añade el hallazgo a `.gitleaksignore` por huella, en PR revisado por seguridad.
   - Si es **falso positivo** (dato ficticio de prueba): sustituirlo por un valor que no case con el patrón; si no es posible, `.gitleaksignore` por huella con justificación en el PR.
   - Las ramas `ensayo/**` fallan a propósito: no son incidencia. Recordar al dueño que las borre.
   - gitleaks escanea solo `HEAD` (`--full-history HEAD`): un fallo en una rama no contamina las demás.
2. **semgrep**
   - Hallazgo real: corregir el código en la rama (desarrollador). Falso positivo: comentario `nosemgrep: <regla>` con justificación, revisado por seguridad.
   - Error de red o del registro de reglas (no hay hallazgos en el log): relanzar una vez; si persiste > 1 día, abrir ítem.
3. **npm audit**
   - `npm ci` falla por lockfile desincronizado: falta el run de `lockfile.yml` o no lanzó Seguridad sobre el commit del lockfile; relanzar `seguridad.yml` manualmente en la rama tras el commit del bot.
   - Vulnerabilidad alta/crítica en dependencia de producción: actualizar la dependencia (PR de Dependabot o ítem `fix/`). Si no hay versión corregida y no se puede retirar, es regla de parada 3.
   - `npm audit signatures` falla: no fusionar nada; posible paquete manipulado. Revisar qué paquete y avisar a seguridad.
4. **CodeQL**
   - Alerta nueva: revisar en *Security → Code scanning* (o en el log del job). Corregir en la rama; descartar solo con justificación de seguridad.
   - Error de subida SARIF (`security-events`): verificar que code scanning sigue habilitado en el repo (configuración del dueño).
5. **pruebas de seguridad** (`tests/security`)
   - Una prueba de `workflows.test.js` falla: un workflow incumple la política (acción sin SHA, `latest`, permisos, `--ignore-scripts`...). Corregir el workflow, no la prueba.
   - `static-secrets.test.js` falla en `dist/`: un secreto se coló en el bundle (p. ej. una variable `VITE_*` con la clave secreta). Tratar como gitleaks real.
6. **pentest-api** (`tests/security/api/`, Supabase local)
   - Falla `supabase start` con `address already in use` (puerto 54322): intermitente conocido (V-04); no es un defecto del ítem y no se relanza a mano. Desde F-07, los jobs que arrancan Supabase con `scripts/ci/supabase-start.sh` reintentan solos: son 3 intentos, con `supabase stop --no-backup` y 10 s de espera entre uno y otro, y el diagnóstico (`ss -ltnp`, `ss -tanp`, `docker ps -a`, `ip_local_reserved_ports`) queda en el grupo «Diagnóstico de puertos de Supabase local (54320-54329)». Desde F-10, antes del primer intento el script reserva 54320–54329 con `sysctl net.ipv4.ip_local_reserved_ports`, para que el kernel no use esos puertos como puerto efímero de origen. El log lo confirma con la línea «Puertos reservados: ip_local_reserved_ports=…» (o «ya reservados» si la reserva existía). El diagnóstico cubre 54320–54329: muestra el valor de las reservas, los procesos en LISTEN (`ss -ltnp`) y los sockets TCP en cualquier estado (`ss -tanp`). Un `::warning::` «No se pudieron reservar» significa que el runner no tiene `sudo` no interactivo: la protección queda solo en el reintento. Un `::notice::` «arrancó en el intento N» indica intermitencia absorbida: anótala aquí si se repite. «no arrancó tras 3 intentos» ya no es intermitencia: revisa el diagnóstico (otro contenedor o proceso retiene el puerto) antes de relanzar. Si ocurre con la reserva aplicada y sin ningún proceso en LISTEN, apunta a un socket de origen abierto antes de la reserva (por un paso anterior del job): mira el bloque `ss -tanp`. El script lo usan los tres arranques de `ci.yml` y los tres de `seguridad.yml` (pentest-api, dast y S-05 fase A).
   - Falla `supabase start` o `supabase status` (sin `not ok` en el log): problema de la CLI o de Docker en el runner. Relanzar una vez; si se repite, revisar si cambió la imagen del runner o la versión fija de la CLI (debe ser la misma que en `ci.yml`).
   - `PENTEST_REQUIRE=1 pero faltan ...`: el paso "Obtener URL y claves locales" no encontró `API_URL`, `PUBLISHABLE_KEY` o `SECRET_KEY` en `supabase status -o env` (la CLI cambió los nombres). Ajustar el paso; nunca quitar `PENTEST_REQUIRE`.
   - `catálogo › toda tabla de public tiene fila en la matriz`: una migración añadió una tabla o vista. Añadir su fila en `tests/security/api/matrix.js` (seguridad) en la misma rama, con lo que diga ADR 0005; no es un falso positivo.
   - Una celda de la matriz, un caso de IDOR o de escalada falla: la RLS o los grants son más abiertos (o más cerrados) que el diseño. Corrige el desarrollador en `supabase/migrations/`; si el diseño mismo está en duda, decide el arquitecto (ADR).
   - Fuera de este job las pruebas de `tests/security/api/` se omiten (`# SKIP`) a propósito; dentro deben salir con `skipped 0`.
   - Sesiones (F-09): el paso «Pentest de la API» inicia sesión una sola vez con `tests/security/api/login-all.mjs` (los 7 roles del seed) y pasa los tokens a los archivos de prueba por la variable de shell `PENTEST_TOKENS` (JSON rol → token). No se escriben a disco ni al log, ni pasan por `GITHUB_ENV`. Cada archivo valida la variable (7 roles, forma JWT, más de 5 min de vigencia); si falta o no es válida, inicia sesión de nuevo sin avisar. Ya no existe caché de tokens en `tmpdir`.
   - Falla con `login-all: …` o `login <rol>: 429 …`: `login()` reintenta solo ante 429, hasta 6 intentos, con espera de 2, 4, 8, 16 y 32 s o la de `Retry-After` (tope 60 s por espera). El reintento no deja línea en el log. Si el 429 persiste tras los reintentos, revisa el rate limit de GoTrue antes de relanzar: `supabase/config.toml` no tiene sección `[auth.rate_limit]`, así que rigen los valores por defecto de la CLI. Un `pentest-api` de más de 3 min que no explica «Levantar Supabase» apunta a un 429 sostenido. Cualquier otro código (400, 500) falla en el acto, sin reintento.
   - Correr pentest-api en local (Supabase local con `supabase start` y seed cargado):
     1. Exporta `PENTEST_API_URL`, `PENTEST_PUBLISHABLE_KEY`, `PENTEST_SECRET_KEY`, `PENTEST_JWT_SECRET` y `PENTEST_DB_URL` con los valores `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`, `JWT_SECRET` y `DB_URL` de `supabase status -o env` (igual que el paso «Obtener URL y claves locales»).
     2. Opcional: `export PENTEST_TOKENS="$(node tests/security/api/login-all.mjs)"`. Sin ella cada archivo inicia sesión por su cuenta y es más fácil chocar con el rate limit.
     3. `node --test --test-concurrency=1 'tests/security/api/*.test.js'`. Con `PENTEST_REQUIRE=1` la falta de variables falla en vez de omitir.
   - Nunca pegues el valor de `PENTEST_TOKENS` ni un JWT (`eyJ…`) en issues, PR, informes o logs. No uses `echo` ni `set -x` en ese paso. Aunque sean tokens locales que vencen en 1 h, la regla es la misma.
   - El log de `supabase start` muestra las claves locales por defecto de la CLI (públicas y solo válidas en el runner efímero). No es una fuga; una clave `sb_secret_` de producción en ese log sí lo sería.
6b. **dast** (S-04: build contra Supabase local, `e2e/security`, ZAP baseline pasivo contra `http://127.0.0.1:4173/practica_agente/`)
   - `Build conectado a Supabase local` falla con `CSP: origen de Supabase no permitido`: `VITE_SUPABASE_URL` apunta a un origen que no es el proyecto del repo ni loopback (ver ADR 0011). Corregir la variable; si el proyecto de Supabase cambió de verdad, actualizar `PRODUCTION_SUPABASE_ORIGIN` en `src/security/csp.js` en un PR revisado por seguridad.
   - `La CSP del build admite Supabase local y nada más` falla: el plugin `csp-meta` de `vite.config.js` no inyectó el `<meta>` o apareció `unsafe-inline`/`unsafe-eval` (p. ej. un cambio de Vite que inyecta script inline). Corregir el build, nunca relajar la CSP.
   - `OWASP ZAP baseline` sale con código 1: una regla `FAIL` de `.zap/rules.tsv` saltó. Ver el artefacto `zap-baseline` (HTML/JSON). Código 3: error de ZAP o de la imagen (relanzar una vez). No se pasan reglas a `IGNORE` (lo impide `workflows.test.js`).
   - `Sin alertas de riesgo alto` falla: hallazgo alto real; corregir en la rama.
   - Subir la imagen ZAP: versión y digest `sha256` juntos en un PR; nunca por etiqueta móvil.
   - `Servir dist/` falla: el puerto 4173 ocupado o `vite preview` cambió; ver `preview.log` en el log del paso.
7. **Run semanal** (lunes) falla sin cambios de código: casi siempre es una CVE nueva (npm audit) o una regla nueva (semgrep/CodeQL). Abrir rama `fix/seguridad-<fecha>`; el orquestador lo trata en el paso 3 del ciclo ("salud primero").
8. **Dependabot** propone subir una acción: verificar que el SHA corresponde al tag del comentario y que CI y Seguridad pasan en el PR antes de fusionar.
9. **Dependabot npm (versión mayor):** fusionar de a uno, pidiendo antes `@dependabot rebase` sobre el `main` actual (los lockfiles de varios PR chocan entre sí). Paquetes acoplados (`eslint` y `@eslint/js`) van juntos: primero `eslint`, luego rebase del otro. Un PR que falla por `ERESOLVE` (dependencia par) no se fuerza con `--legacy-peer-deps`: se espera al PR del paquete par.

## Evaluación programada (`evaluacion-mensual`, `ritmo-diario`)

Ver ADR 0008. Ambos usan `node scripts/evaluate.js --mode=monthly|daily --as-of=YYYY-MM-DD` con `SUPABASE_SECRET_KEY`. Comparten `concurrency: evaluacion-produccion`, así que nunca corren a la vez. Actor de auditoría: `system:evaluate`.

### Activación (compuerta del usuario, V-05)
1. Secretos `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (`sb_secret_...`) en el repositorio o en el environment `produccion`. Desde V-05 ambos jobs declaran `environment: produccion` (H-C03-02, ADR 0015), así que leen los secretos de cualquiera de los dos sitios. Cuando el usuario mueva los secretos al environment (con regla de ramas = `main` y **sin revisor requerido**), hay que comprobar con una corrida manual que el paso "Evaluar" se ejecuta antes de borrar los de repositorio.
2. Variable de repositorio `EVALUATION_ENABLED=true` (*Settings → Secrets and variables → Actions → Variables*).
3. Primera corrida manual de `ritmo-diario` sin `as_of`. Verificar en el log la línea JSON final con `errors: 0`.
Mientras falte algo, el job termina en verde con `::warning::... se omite la evaluación`. Desde la activación, un warning así en un cron significa que alguien borró un secreto o la variable: es una incidencia.

### Activación de producción (P-05): lista de comprobación
Orden y compuertas según ADR 0015 (enmienda S-05b). Lo marcado *(usuario)* es compuerta del usuario.
1. Fase B `anonimo` en VERDE (hecho, S-05b).
2. *(usuario)* En el environment `produccion`: `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. Regla de ramas `main`, **sin revisor**.
3. `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` **se quedan también a nivel de repositorio** (o la publicable como variable): `salud.yml` no declara environment (ADR 0014 punto 5) y no tiene valor por defecto para `SUPABASE_URL`. Si se borran del repositorio, con `EVALUATION_ENABLED=true` el check `supabase` falla con `falta SUPABASE_URL`. Ninguna de las dos es secreta. Las que sí se borran del repositorio: `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (H-C03-02), después del paso 5.
4. *(usuario)* Variable de repositorio `EVALUATION_ENABLED=true`.
5. Corrida manual de `ritmo-diario` en `main` sin `as_of`: el paso "Evaluar" debe ejecutarse (no `skipped`) y la línea JSON final traer `errors: 0`. Con la base aún sin configuración (sin unidades ni indicadores), la corrida no escribe evaluaciones; es lo esperado.
6. Corrida manual de `salud.yml`: `pages`, `supabase` y `ritmo-diario` en `ok`. Si sale un issue `salud`, seguir «Qué hacer ante cada alerta» y cerrarlo al quedar verde.
7. El primer cierre mensual automático es el 2026-12-01 (noviembre). Si la gestora no cargó indicadores ni mediciones de noviembre, el cierre no produce colores; si los cargó a medias, se aplican las reglas de mínimo de muestra del diseño. Reprocesar con `--reprocess` si hace falta (ver «Reprocesar un mes»).
8. Antes de dar de alta usuarios reales o anunciar la URL: fase B `roles` en VERDE, H-S05-01 completo en el panel y paso 3 cumplido (ADR 0015, enmienda S-05b).

### Cómo vigilarlos
Desde V-04 lo hace `salud.yml` (ver «Salud del sistema»). A mano:
- Último run de cada uno: `gh api 'repos/apivasa/practica_agente/actions/workflows/ritmo-diario.yml/runs?per_page=3' --jq '.workflow_runs[]|{id,event,created_at,conclusion}'` (igual con `evaluacion-mensual.yml`).
- Los criterios automatizados están en `WORKFLOW_RULES` de `scripts/health/lib.js` (tabla en «Salud del sistema»). La comprobación en BD de `audit_log` de `system:evaluate` **no** se automatizó: exigiría la clave secreta en `salud.yml`, y el paso "Evaluar" omitido o fallido ya se detecta por la API de Actions. Consulta manual: `select action, count(*) from audit_log where actor = 'system:evaluate' and created_at > now() - interval '26 hours' group by 1;`
- GitHub **desactiva los cron de un repo público tras 60 días sin actividad**. Si pasa, reactivar con `gh api -X PUT repos/apivasa/practica_agente/actions/workflows/ritmo-diario.yml/enable` (igual el mensual). `salud.yml` alerta si `state != active`.
- GitHub puede retrasar los cron varios minutos o descartar alguno en horas de carga. Un día sin run no es un fallo del código: relanzar manualmente con el `as_of` de ese día.

### Qué hacer si fallan
1. Identificar el paso fallido (consulta de jobs arriba) y leer el log. El script nunca imprime la clave. La última línea JSON resume `evaluations`, `written`, `alerts` y `errors`, y cada error sale como `Error: <unidad>: <motivo>`.
2. **Exit 2 `Error de configuración`**: falta un secreto, la URL no es https, la clave no tiene prefijo `sb_secret_`, `as_of` es futuro o se definió `EVALUATE_ALLOW_FUTURE` contra un host no local. Corregir los secretos o la fecha (crear o rotar secretos es compuerta del usuario).
   **Exit 3** (solo mensual): el mes ya estaba cerrado y no se pidió `reprocess` (ver "Reprocesar un mes").
3. **Errores por unidad** (exit 1, hay otras unidades bien): el script escribió las unidades sanas y reporta las otras. Causas típicas:
   - `El historial termina en ... (H-C01-02)`: `as_of` no corresponde al mes que se cierra (ver "Reprocesar un mes").
   - Un indicador con configuración inválida: lo corrige la gestora o el custodio en la app.
   - **Medición de VULN malformada (H-M06-01, desde M-08).** El trigger `measurements_category_guard` impide cargar filas nuevas así: el custodio recibe un 23514 («La categoría de la medición debe ser P0P1 o P2P3» o «El valor... entero mayor o igual que 0»). Eso no es una incidencia del sistema. Las filas anteriores a M-08 no hacen fallar ni la mensual ni el diario: `buildPackageInput` las descarta y el motivo o el log dicen "N medición(es) descartada(s)", y el snapshot del ritmo guarda `details.discarded`. Si aparece esa nota, buscar la fila en `measurements` (unidad, indicador, trimestre en curso, `category` fuera de `P0P1`/`P2P3` o `value` no entero) y en `audit_measurements`, y pedir al custodio que la corrija con una medición nueva. Las mediciones no se borran.
   Después relanzar con `workflow_dispatch`, el mismo `as_of` y `reprocess=true` (mensual) o solo el `as_of` (diario).
4. **`evaluations upsert` / `alerts insert` / `audit_log insert`**: error de BD (migración no aplicada en producción, constraint, Supabase pausado o caído). Comprobar que Supabase responde y que las migraciones de `supabase/migrations/` están aplicadas, y relanzar.
5. **`npm ci` falla**: lockfile desincronizado con `main`. Mismo tratamiento que en `seguridad.yml`.
6. **`Sin paquete por criticidad (package_by_category)`** en el log del diario no es fallo: falta el paquete en el compromiso trimestral. Avisar al custodio.
7. Si el fallo se repite dos días o afecta el cierre mensual: el orquestador abre `fix/evaluacion-<fecha>` (paso 3 del ciclo, "salud primero").

### Reprocesar un mes
- La mensual cierra **el mes anterior a `as_of`**. Para reprocesar el mes M se lanza *Actions → Evaluación mensual → Run workflow* con `as_of` = primer día de M+1 y la casilla **`reprocess` marcada**. Por REST: `gh api -X POST repos/apivasa/practica_agente/actions/workflows/evaluacion-mensual.yml/dispatches -f ref=main -f 'inputs[as_of]=2027-02-01' -f 'inputs[reprocess]=true'` (cierra de nuevo enero de 2027).
- Sin `reprocess`, un mes ya cerrado se rechaza: el job falla con `Error: El mes YYYY-MM ya está cerrado; ... --reprocess`, sale con código 3 y no escribe nada. Es una protección, no una incidencia. Si fue un cron duplicado o un relanzamiento accidental, no hay que hacer nada.
- **Relanzar un cron que falló a medias:** las unidades sanas ya quedaron escritas, así que el mes cuenta como cerrado y *Re-run* del run `schedule` (que no lleva inputs) saldrá con código 3. Hay que usar `workflow_dispatch` con el mismo `as_of` y `reprocess=true`.
- `as_of` no puede ser futuro respecto de hoy en Guayaquil; si lo es, sale con código 2. `EVALUATE_ALLOW_FUTURE` existe solo para la integración de CI contra Supabase local: nunca se define en secretos ni variables del repo, y contra producción provoca un error de configuración.
- Casos típicos: el custodio cargó mediciones tarde (después del cron del día 1) o se corrigió una medición o un umbral.
- **Meta mensual cambiada en un mes ya cerrado (M-07).** La pantalla `#/gestora/metas` permite guardar la meta de cualquier mes, y el color que muestra es solo una vista previa. La evaluación guardada no cambia sola. Si la gestora carga o corrige la meta de un mes que ya se cerró (por ejemplo, un indicador quedó «Sin evaluar» por falta de meta), hay que reprocesar ese mes y los siguientes del trimestre, en orden. Las metas se leen al cerrar el mes: si se cargan antes del día 1, no hace falta reprocesar.
- Es idempotente: solo reescribe las evaluaciones que cambian y audita esas. Además deja una fila `evaluation_reprocess` en `audit_log` (con `written`, `alerts` y `errors`). Si el color o el nivel cambian, sale una alerta `color_change` nueva (la anterior queda en el historial). Si nada cambia, no hay alertas.
- La racha de escalada usa los meses ya guardados del trimestre. Al reprocesar un mes que no es el último, hay que reprocesar también los siguientes del mismo trimestre, en orden: M, M+1...
- `assertHistoryFresh` impide cerrar un mes que no sea el mes de `as_of` o el anterior. Siempre se usa el día 1 del mes siguiente al reprocesado.
- Ritmo diario de una fecha pasada: lanzar `ritmo-diario` con `as_of` = esa fecha (no necesita `reprocess`). Compara contra el último snapshot anterior a esa fecha.
- Auditoría de reprocesos: `select created_at, entity_id, details from audit_log where action = 'evaluation_reprocess' order by created_at desc;`

### Restaurar
- Las evaluaciones son derivables: se recalculan desde `measurements`, `commitments`, `targets` y `exceptions` reprocesando los meses del trimestre en orden.
- Las alertas y `audit_log` no se regeneran, porque son historial: hay que restaurarlas de un respaldo.
- **Respaldo (plan gratuito: sin PITR ni descarga garantizada de respaldos diarios).** Paso del dueño (necesita la contraseña de la BD, que no vive en el repo ni en Actions), al menos antes de cada migración y una vez al mes tras el cierre del día 1:
  ```
  supabase link --project-ref <ref>
  supabase db dump --linked -f respaldo-esquema-AAAA-MM-DD.sql
  supabase db dump --linked --data-only --use-copy -f respaldo-datos-AAAA-MM-DD.sql
  ```
  Los archivos contienen datos de unidades: se guardan **fuera del repositorio** (el repo es público), cifrados o en un almacenamiento privado del dueño. Nunca se suben a artefactos de Actions.
- **Restaurar a un proyecto nuevo o limpio:** crear el proyecto, aplicar las migraciones del repo (`supabase db push`), y cargar los datos con `psql "<cadena de conexión>" -v ON_ERROR_STOP=1 -f respaldo-datos-AAAA-MM-DD.sql`. Los triggers append-only de `audit_log` (`audit_log_append_only`) no impiden INSERT, así que el historial se recarga tal cual. Antes de cargar, comprobar que el archivo de datos fija `SET session_replication_role = replica;` (así lo genera la CLI): sin eso, los triggers de auditoría de las demás tablas añadirían filas duplicadas a `audit_log` durante la carga. Es un procedimiento aún no ensayado: se ensaya en V-05. Luego actualizar los secretos `SUPABASE_URL` y claves si cambió el proyecto (compuerta del usuario) y lanzar `salud.yml` a mano.
- Restauración parcial (solo evaluaciones de un mes): no hace falta respaldo, basta reprocesar (ver arriba).

- **Restaurar tras una migración dañina.** Primero se escribe una migración correctiva en un PR revisado y se despliega (ver `docs/despliegue.md`). Si hay que borrar tablas o columnas con datos, o recargar el respaldo de datos, es compuerta del usuario (CLAUDE.md §3).

## Despliegue (`deploy.yml`, V-05, ADR 0015)
Procedimiento completo en `docs/despliegue.md`. Orden de jobs: `verify` → `build-pages` → `migrate-plan` → `migrate` → `deploy-pages` → `smoke`. Ningún job lee `SUPABASE_SECRET_KEY`.
- **Falla `verify`**, paso «Confirmación, rama y secretos»: falta un secreto, el prefijo de la clave publicable es incorrecto, `SUPABASE_URL` no corresponde a `SUPABASE_PROJECT_REF`, la rama no es `main` o `confirm` no vale `desplegar`. Corregir la configuración. Crear o rotar secretos es compuerta del usuario.
- **Falla `verify`**, paso «Origen de producción»: `SUPABASE_URL` no es `PRODUCTION_SUPABASE_ORIGIN` de `src/security/csp.js` (ADR 0011). Los secretos apuntan a otro proyecto, y el job se detiene antes de tocar una base equivocada. Si se cambió de proyecto a propósito, cambiar a la vez los secretos (usuario) y la constante, en un PR revisado por seguridad. Si el paso dice «No se encontró PRODUCTION_SUPABASE_ORIGIN», alguien cambió el formato de la línea en `csp.js`: el `sed` del paso espera `export const PRODUCTION_SUPABASE_ORIGIN = '<origen>';`.
- **Falla `verify`**, paso «Registro cerrado en Auth»:
  - `disable_signup` no es `true`: desactivar *Allow new users to sign up* en el panel de Supabase (tarea del usuario) y relanzar.
  - «No se pudo leer /auth/v1/settings»: el proyecto está pausado (reanudarlo desde el panel) o la clave publicable no es válida.
- **Falla `build-pages`**: si la verificación de `dist/` detecta un secreto u origen local, tratarlo como el fallo de gitleaks (ver arriba). Si el build falla por la CSP, `SUPABASE_URL` no coincide con `PRODUCTION_SUPABASE_ORIGIN`. La base no se tocó.
- **Falla `migrate-plan`** (solo dry-run, no cambia nada): `supabase link` falló por `SUPABASE_ACCESS_TOKEN` o `SUPABASE_DB_PASSWORD` inválidos o por el proyecto pausado. Si el dry-run lista migraciones que no se esperaban, no aprobar ni relanzar `migrate`: revisar `supabase/migrations/` contra `supabase migration list`.
- **Antes de aprobar `migrate` con `20261123120000_measurements_category_guard.sql` (M-08):** correr contra producción, en solo lectura (SQL editor del panel), las dos consultas del final de ese archivo. Las dos deben devolver 0 filas. Si la primera devuelve filas (indicador `cumulative_target` con `lower_is_better`), el `ADD CONSTRAINT` falla y `migrate` queda en rojo sin aplicar ese archivo. Primero se corrige el indicador desde la pantalla de la gestora. Si la segunda devuelve filas, la migración igual se aplica (el trigger solo actúa sobre filas nuevas), pero esas filas quedan descartadas en el cálculo: avisar a la gestora.
- **Antes de aprobar `migrate` con `20261124120000_hardening_m09.sql` (M-09):** mismo procedimiento, con las dos consultas del final de ese archivo (solo lectura, deben devolver 0 filas). Si la primera devuelve filas (`measurements.value` en `NaN`, `Infinity` o `-Infinity`), el `ADD CONSTRAINT measurements_value_finite` valida las filas existentes y falla: `migrate` queda en rojo sin aplicar el archivo (tampoco se aplican el cambio de grants de `targets` ni el trigger, porque van en la misma transacción). Las mediciones no se borran: el custodio carga una medición nueva corregida y la fila mala se corrige con una migración revisada (compuerta del usuario si toca datos en producción). Si la segunda devuelve filas (VULN con valor > 2^53 − 1), la migración igual se aplica (el trigger solo actúa sobre filas nuevas) y el motor ya las descarta (`Number.isSafeInteger`): avisar a la gestora. Después de aplicarla, la gestora solo puede cambiar `target_value` de una meta; un `PATCH` con otra columna devuelve 42501 (403), lo que es esperado.
- **Antes de aprobar `migrate` con `20261125120000_numeric_finite_m10.sql` (M-10):** mismo procedimiento, con las tres consultas del final de ese archivo (solo lectura, deben devolver 0 filas): `indicators` (umbrales), `commitments` (overrides y `package_total`) y `targets` (`target_value`) en `NaN`, `Infinity` o `-Infinity`. Si alguna devuelve filas, el `ADD CONSTRAINT ..._finite` correspondiente valida las filas existentes y falla: `migrate` queda en rojo sin aplicar el archivo (los seis CHECK van en la misma transacción). Corregir antes el valor desde la pantalla de la gestora (indicador, compromiso o meta) con un número finito y volver a correr las consultas. Esas filas ya no afectaban al cálculo: el motor (`engine/indicator.js`, `engine/commitment.js`, `engine/measure.js`) descarta los no finitos. Después de aplicarla, guardar un valor no finito devuelve 23514, lo que es esperado.
- **Antes de aprobar `migrate` con `20261126120000_numeric_safe_cap_m11.sql` (M-11):** mismo procedimiento, con las tres consultas del final de ese archivo (solo lectura, deben devolver 0 filas): `indicators` (umbrales), `commitments` (overrides, `package_total` y cada valor de `package_by_category`) y `targets` (`target_value`) con magnitud ≥ 2^53, o, en `package_by_category`, con un valor que no sea número JSON (texto, `null`, booleano, arreglo u objeto). Si alguna devuelve filas, el `ADD CONSTRAINT ..._safe` correspondiente falla y `migrate` queda en rojo sin aplicar el archivo (los siete CHECK van en la misma transacción). Corregir antes el valor desde la pantalla de la gestora (indicador, compromiso o meta) y volver a correr las consultas. El motor ya trataba esos valores como ausentes (`JSON.parse` los convierte en `Infinity` y `num()`/`isFiniteNumber` los descartan), así que corregirlos puede cambiar el color de un indicador en la siguiente evaluación: avisar a la gestora. Después de aplicarla, guardar un valor con magnitud ≥ 2^53 devuelve 23514, lo que es esperado. Si el valor es `NaN` o `±Infinity`, salta antes el CHECK `..._finite` de M-10, porque PostgreSQL evalúa los CHECK en orden alfabético de nombre.
- **Antes de aprobar `migrate` con `20261127120000_json_shape_safe_m12.sql` (M-12):** mismo procedimiento, con las tres consultas del final de ese archivo (solo lectura, deben devolver 0 filas).
  - **`indicators.thresholds_by_category`:** devuelve filas si alguna categoría no es un objeto `{ "green": n, "yellow": n }`. Eso incluye claves de más o de menos, valores que no son número JSON, o magnitudes ≥ 2^53. Se corrige desde la pantalla de la gestora (editar el indicador y guardar): el formulario reescribe el objeto con la forma correcta.
  - **`measurements.value`:** devuelve filas si hay una magnitud ≥ 2^53. Hasta M-12, eso solo podía pasar en indicadores sin categorías, porque los VULN ya los frenaba el trigger de M-09. Las mediciones no se borran ni se editan desde la app. El custodio carga una medición nueva corregida, y la fila mala se corrige con una migración revisada (compuerta del usuario si toca datos en producción).
  - **`commitments.package_by_category`:** devuelve filas si algún valor del paquete es negativo o no es entero. Se corrige desde la pantalla de compromisos del custodio.

  Si alguna consulta devuelve filas, el `ADD CONSTRAINT` correspondiente valida las filas existentes y falla. `migrate` queda en rojo sin aplicar el archivo, porque los tres CHECK van en la misma transacción. El motor ya descartaba esos valores: los trataba como ausentes (`num()`, `isFiniteNumber`, `Number.isInteger`). Corregirlos puede cambiar el color de un indicador en la siguiente evaluación: avisar a la gestora.

  Después de aplicarla, guardar uno de esos valores devuelve 23514, lo que es esperado. El CHECK que se reporta sigue el orden alfabético de nombre:
  - `NaN` o `±Infinity` en `value`: salta antes `measurements_value_finite` (M-09).
  - Paquete no numérico o con magnitud ≥ 2^53: salta antes `commitments_package_by_category_safe` (M-11).
  - `thresholds_by_category` que no es objeto: salta antes el CHECK original de la columna.

  Las claves del paquete siguen libres: categorías del indicador o `total`.
- **Antes de aprobar `migrate` con `20261128120000_safe_cap_js_rounding_m14.sql` (M-14):** mismo procedimiento, con las cuatro consultas del final de ese archivo (solo lectura, deben devolver 0 filas). Buscan valores con magnitud ≥ 2^53 − 0,5 (`9007199254740991.5`) en `indicators` (umbrales y cada umbral de `thresholds_by_category`), `commitments` (overrides, `package_total` y cada valor de `package_by_category`), `targets` (`target_value`) y `measurements` (`value`).
  - **Qué significa una fila:** solo pudo entrar por API directa con un valor absurdo. El front lo lee como 2^53 y, desde M-13, el motor lo rechaza. Si es un umbral de indicador, la evaluación mensual de ese mes ya estaba fallando para todas las unidades (error reportado, sin color falso). Si es un override, un paquete o una meta, el motor lo descartaba.
  - **Cómo se corrige:** indicadores, compromisos y metas se corrigen desde la pantalla de la gestora o del custodio con un valor razonable, y luego se vuelven a correr las consultas. Una medición no se edita desde la app: el custodio carga una corregida y la fila mala se corrige con una migración revisada (compuerta del usuario si toca datos en producción).
  - **No es destructiva:** reemplaza nueve CHECK por otros más estrictos con el mismo nombre. No borra tablas, columnas ni filas. Cada tabla cambia en un solo `ALTER TABLE` (`DROP` + `ADD`), y `db push` aplica el archivo en una transacción. Si una fila no cumple, el `ADD` falla, `migrate` queda en rojo y no se aplica nada: los CHECK de M-11 y M-12 siguen vigentes.
  - **Bloqueos:** cada `ALTER` toma `ACCESS EXCLUSIVE` sobre `indicators`, `commitments`, `targets` y `measurements` mientras revisa las filas. Con el volumen de la app son milisegundos, pero no hay que lanzarla mientras corre `evaluacion-mensual` o `ritmo-diario`.
  - **Después de aplicarla:** guardar un valor en [2^53 − 0,5, 2^53) devuelve 23514 del CHECK `_safe`. En `package_by_category`, un valor como `9007199254740991.9999` ahora lo reporta `commitments_package_by_category_safe` y ya no `_whole`, por el orden alfabético. Es lo esperado.
- **Falla `migrate`**: la BD puede quedar a medias, porque `db push` aplica cada archivo en su propia transacción. Leer `supabase migration list` en el log (o lanzarlo a mano) y corregir con una migración nueva. Nunca se edita una migración ya aplicada. El front no se publicó: `deploy-pages` necesita `migrate`.
- **Falla `smoke`**: comprobar Settings → Pages (fuente = GitHub Actions) y relanzar solo `smoke`. Si el HTML da 200 pero el JS principal no, la `base` de `vite.config.js` no coincide con la ruta de Pages.
- **Revisor requerido**: no se pone en `produccion`. `evaluacion-mensual` y `ritmo-diario` usan ese environment, y con revisor cada cron quedaría en `waiting` (ADR 0015 punto 6). Si `salud.yml` alerta `último run hace N h` (evaluaciones) o `deploy-main` en `waiting`, quitar el revisor del environment y aprobar o relanzar el run.
- **Cuidado con la concurrencia con las evaluaciones**: `despliegue-produccion` y `evaluacion-produccion` son grupos distintos. No hay que desplegar migraciones de `evaluations`, `alerts` o `audit_log` el día 1 a la hora del cron mensual.

## Salud del sistema (`salud.yml`, V-04, ADR 0014)

Código: `scripts/health/check.js` y `scripts/health/lib.js` (Node puro, sin dependencias npm), pruebas en `tests/scripts/health.test.js` y prueba contra Supabase local en `scripts/ci/health.sh` (job `integration` de `ci.yml`), que incluye la **simulación de caída de Pages** (puerto cerrado → `failures=pages`, código 1).

Permisos: workflow `contents: read`; job `check` añade `actions: read`; solo el job `alert` tiene `issues: write`. No usa la clave secreta: solo `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (secreto o variable).

| Check | Qué mira | Cuándo se exige |
|---|---|---|
| `pages` | GET a `vars.PAGES_URL` (por defecto `https://apivasa.github.io/practica_agente/`) responde 200; 2 intentos con 10 s | `EVALUATION_ENABLED=true` |
| `supabase` | GET `<SUPABASE_URL>/auth/v1/health` con la clave publicable responde 200; evita la pausa por inactividad | `EVALUATION_ENABLED=true` |
| `ritmo-diario` | workflow `active`; último run completado (no cancelado) en `main` hace ≤ 30 h, `success`, ≤ 5 min y con el paso "Evaluar" ejecutado | estado siempre; resto con producción |
| `evaluacion-mensual` | workflow `active`; desde el día 2 (Guayaquil) hay un run del mes actual, el último `success`, ≤ 5 min y "Evaluar" ejecutado | estado siempre; resto con producción |
| `seguridad-semanal` | workflow `active`; último run `schedule` hace ≤ 8 días y `success` | siempre (gracia de 8 días si el workflow es nuevo) |
| `ci-main` | último run `push` de CI en `main` en `success` | siempre |
| `deploy-main` (V-04b) | `deploy.yml` `active`; último run `push` o `workflow_dispatch` en `main` completado (sin contar `skipped`/`neutral`) en `success`; ningún run lleva > 60 min sin terminar (`queued`, `in_progress`, `waiting`...). Último cancelado: **aviso** (warning, no falla), salvo que el despliegue anterior no cancelado haya fallado: entonces falla. Sin despliegues: pasa | siempre (criterio en `DEPLOY_RULE` de `scripts/health/lib.js`, fuera de `WORKFLOW_RULES` porque no es programado) |
| `actions-api` | hay `GITHUB_TOKEN` y la API responde | siempre |

Si algún check falla, el job `check` queda en rojo y el job `alert` abre un issue «Salud del sistema: comprobación fallida» con la etiqueta `salud` (la crea si no existe), o **comenta el issue abierto** si ya hay uno (sin duplicados). El cuerpo solo lleva los nombres de los checks, la hora de Guayaquil y el enlace al run; el detalle está en el log y en el resumen del run. Sin producción activa, `pages`, `supabase` y la ejecución de las evaluaciones salen como `omitido` (warning) y el run queda verde. Un `aviso` (`deploy-main` con el último despliegue cancelado) también sale como warning y no abre issue.

### Qué hacer ante cada alerta
Primero abrir el run enlazado en el issue y leer el resumen (tabla Check/Estado/Detalle). Al resolver, lanzar `salud.yml` a mano (`gh api -X POST repos/apivasa/practica_agente/actions/workflows/salud.yml/dispatches -f ref=main`) y cerrar el issue cuando salga verde.
- **`pages`**
  - `HTTP 404`: Pages despublicado o la ruta cambió. Revisar *Settings → Pages* y el último run del workflow de despliegue; relanzarlo. Si se cambió el nombre del repo, actualizar `vars.PAGES_URL`.
  - `HTTP 5xx` o `sin respuesta`: incidente de GitHub Pages (ver githubstatus.com). Nada que hacer en el repo; el siguiente run confirma la recuperación.
  - `PAGES_URL no es https`: la variable tiene un valor inválido.
- **`supabase`**
  - `HTTP 503`/`540` o `sin respuesta`: proyecto **pausado** (plan gratuito) o caído. Reanudarlo desde el panel de Supabase (paso del dueño). Si se pausó pese a `salud.yml`, revisar que el cron de salud esté `active` (`gh api repos/apivasa/practica_agente/actions/workflows/salud.yml --jq .state`).
  - `HTTP 401`: la clave publicable fue rotada o borrada; actualizar `SUPABASE_PUBLISHABLE_KEY` (compuerta del usuario).
  - `falta SUPABASE_URL ...` / `falta SUPABASE_PUBLISHABLE_KEY`: con `EVALUATION_ENABLED=true` faltan secretos: incidencia de configuración (compuerta del usuario).
- **`ritmo-diario` / `evaluacion-mensual`**
  - `deshabilitado (disabled_inactivity)`: 60 días sin actividad en el repo. Reactivar con `gh api -X PUT repos/apivasa/practica_agente/actions/workflows/<archivo>/enable` y relanzar con el `as_of` de los días perdidos (diario) o el cierre (mensual, ver «Reprocesar un mes»). Lo mismo para `disabled_manually`, confirmando antes que nadie lo apagó a propósito.
  - `último run hace N h` / `sin run del cierre mensual`: GitHub descartó el cron o se retrasó. Lanzar a mano con el `as_of` correspondiente.
  - `último run terminó en failure`: seguir «Qué hacer si fallan» (arriba).
  - `paso "Evaluar" omitido con EVALUATION_ENABLED=true`: falta `SUPABASE_URL` o `SUPABASE_SECRET_KEY`. Compuerta del usuario; luego relanzar. Tras activar producción la primera vez, la alerta puede salir una vez si el último run es anterior a la activación: basta relanzar el workflow.
  - `duró N min`: comparar con la base de la tabla de tiempos; si se repite, aplicar la regla de paso intermitente.
- **`seguridad-semanal`**: run semanal fallido o ausente. Si falló, seguir «Qué hacer si falla seguridad.yml» punto 7. Si no corrió, relanzar `seguridad.yml` manual en `main` y revisar su `state`.
- **`ci-main`**: `main` está en rojo. El orquestador abre `fix/main-<fecha>` (paso 3 del ciclo).
- **`deploy-main`** (el detalle enlaza el run):
  - `último despliegue terminó en failure` (o `timed_out`, `startup_failure`...): seguir «Despliegue» (arriba) según el job que falló y relanzar `deploy.yml` en `main`. La alerta se repite cada 6 h (como comentario del mismo issue) hasta que un despliegue termine en `success`. Un run manual fallido por `confirm` mal escrito también cuenta: basta relanzarlo bien.
  - `último despliegue cancelado y el anterior terminó en failure`: la cancelación no corrige el fallo. Mismo tratamiento.
  - `un despliegue lleva N min en waiting`: alguien puso un revisor en `produccion` (prohibido, ADR 0015 punto 6). Quitarlo y aprobar o cancelar el run. En `queued`/`in_progress`: incidente de runners de GitHub o un paso colgado; cancelar el run, revisar el log y relanzar. La suma de timeouts de los jobs (~55 min) queda por debajo del umbral de 60 min.
  - `aviso último despliegue cancelado`: no hay issue. Relanzar el despliegue si la cancelación no fue intencional.
  - `deploy.yml deshabilitado`: reactivar con `.../workflows/deploy.yml/enable`.
- **`actions-api` o `no se pudo consultar la API de Actions`**: incidente de la API de GitHub o falta de permiso `actions: read`. Relanzar; si persiste, revisar el bloque `permissions` de `salud.yml`.
- **El issue dice «el job de comprobación falló sin resumen»**: `check.js` se cayó antes de escribir la salida (error de Node, checkout o timeout). Leer el log del job `check`.
- **`salud.yml` no corre**: también se deshabilita a los 60 días sin actividad y no puede vigilarse a sí mismo. El orquestador lo comprueba en el paso 3 del ciclo (`.../workflows/salud.yml --jq .state`) y lo reactiva con `.../enable`.

### Auditoría de acciones automáticas (CLAUDE.md §4)
Verificado en V-04: las acciones con efecto en la BD quedan en `audit_log` con actor `system:evaluate` (`scripts/lib/run.js`): `evaluation_upsert`, `escalation_applied` (candado), `alert_sent`, `exception_expired`, `evaluation_reprocess` y `pace_snapshot`; las escrituras de usuarios las registran los triggers de `20261119120200_audit_triggers.sql`, y `audit_log` es append-only. La única acción automática de `salud.yml` con efecto es abrir o comentar un issue: queda registrada en el propio issue (autor `github-actions[bot]`, fecha y enlace al run) y no toca la BD, por eso no se escribe en `audit_log` (haría falta la clave secreta en un workflow que no la necesita).

## Pendiente de completar
- Restauración probada contra el Supabase de producción y medición de tiempos base de `salud.yml` y `deploy.yml` (V-05, tras el primer despliegue y la activación).
- Cron de `salud.yml` (observado el 2026-11-20): desde su creación (02:55 UTC) solo corrió el slot de 12:41 UTC, con unas 3 h de retraso (15:44 UTC); GitHub descartó los de 06:41 y 18:41. Con producción activa, si GitHub sigue descartando crons, `ritmo-diario` (umbral 30 h) puede dar falsas alarmas `último run hace N h`: medir una semana tras P-05 antes de ajustar umbrales.
