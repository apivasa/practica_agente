# Operación — runbook

Dueño: arquitecto-SRE. Zona horaria de negocio: America/Guayaquil (UTC-5, sin horario de verano).
Producción aún no existe (P-02/P-03 pendientes): la salud se prueba en CI contra Supabase local (job `integration` de `ci.yml`). `evaluacion-mensual` y `ritmo-diario` existen desde C-03/C-04 (ADR 0008), pero no hacen nada hasta que haya secretos y `vars.EVALUATION_ENABLED='true'`. `salud.yml` lo construye V-04.

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

Posible intermitencia (2026-11-19): Seguridad run 44634155934 en `main` falló en pentest-api, paso «Levantar Supabase local», con `failed to bind host port 0.0.0.0:54324/tcp: address already in use` (contenedor inbucket). Es del runner, no del código; relanzar el run. Si se repite, ítem: fijar puertos distintos por job o desactivar `inbucket` en los jobs que no usan correo.

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
   - Falla `supabase start` o `supabase status` (sin `not ok` en el log): problema de la CLI o de Docker en el runner. Relanzar una vez; si se repite, revisar si cambió la imagen del runner o la versión fija de la CLI (debe ser la misma que en `ci.yml`).
   - `PENTEST_REQUIRE=1 pero faltan ...`: el paso "Obtener URL y claves locales" no encontró `API_URL`, `PUBLISHABLE_KEY` o `SECRET_KEY` en `supabase status -o env` (la CLI cambió los nombres). Ajustar el paso; nunca quitar `PENTEST_REQUIRE`.
   - `catálogo › toda tabla de public tiene fila en la matriz`: una migración añadió una tabla o vista. Añadir su fila en `tests/security/api/matrix.js` (seguridad) en la misma rama, con lo que diga ADR 0005; no es un falso positivo.
   - Una celda de la matriz, un caso de IDOR o de escalada falla: la RLS o los grants son más abiertos (o más cerrados) que el diseño. Corrige el desarrollador en `supabase/migrations/`; si el diseño mismo está en duda, decide el arquitecto (ADR).
   - Fuera de este job las pruebas de `tests/security/api/` se omiten (`# SKIP`) a propósito; dentro deben salir con `skipped 0`.
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
1. Secretos `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (`sb_secret_...`) en el repositorio. Cuando se muevan al environment `produccion` (H-C03-02, ADR 0014), estos workflows deben declarar `environment: produccion` **antes** de quitar los secretos del repositorio. Si no, se quedan sin clave y saltan la evaluación con un warning.
2. Variable de repositorio `EVALUATION_ENABLED=true` (*Settings → Secrets and variables → Actions → Variables*).
3. Primera corrida manual de `ritmo-diario` sin `as_of`. Verificar en el log la línea JSON final con `errors: 0`.
Mientras falte algo, el job termina en verde con `::warning::... se omite la evaluación`. Desde la activación, un warning así en un cron significa que alguien borró un secreto o la variable: es una incidencia.

### Cómo vigilarlos (hasta que V-04 construya `salud.yml`)
- Último run de cada uno: `gh api 'repos/apivasa/practica_agente/actions/workflows/ritmo-diario.yml/runs?per_page=3' --jq '.workflow_runs[]|{id,event,created_at,conclusion}'` (igual con `evaluacion-mensual.yml`).
- Criterios que `salud.yml` (V-04) debe automatizar, abriendo un issue con etiqueta `salud` **sin datos de unidades** (el repo es público):
  - `ritmo-diario`: hay un run `schedule` con `conclusion=success` en las últimas 26 h.
  - `evaluacion-mensual`: si hoy es día ≥ 2 del mes, hay un run `success` con `created_at` en el mes actual.
  - Ningún run en `failure`, ni un `success` cuyo paso "Evaluar" fue omitido estando `EVALUATION_ENABLED=true`.
  - Duración del job por debajo de 5 min.
  - En BD (consulta liviana con la clave secreta): hay `audit_log` de `system:evaluate` con `created_at` en las últimas 26 h. Si no hubo cambios, puede no haber filas: usar `pace_snapshot` del día solo si hay compromisos trimestrales con paquete.
- GitHub **desactiva los cron de un repo público tras 60 días sin actividad**. Si pasa, reactivar con `gh api -X PUT repos/apivasa/practica_agente/actions/workflows/ritmo-diario.yml/enable` (igual el mensual). V-04 debe alertar si `state != active`.
- GitHub puede retrasar los cron varios minutos o descartar alguno en horas de carga. Un día sin run no es un fallo del código: relanzar manualmente con el `as_of` de ese día.

### Qué hacer si fallan
1. Identificar el paso fallido (consulta de jobs arriba) y leer el log. El script nunca imprime la clave. La última línea JSON resume `evaluations`, `written`, `alerts` y `errors`, y cada error sale como `Error: <unidad>: <motivo>`.
2. **Exit 2 `Error de configuración`**: falta un secreto, la URL no es https, la clave no tiene prefijo `sb_secret_`, `as_of` es futuro o se definió `EVALUATE_ALLOW_FUTURE` contra un host no local. Corregir los secretos o la fecha (crear o rotar secretos es compuerta del usuario).
   **Exit 3** (solo mensual): el mes ya estaba cerrado y no se pidió `reprocess` (ver "Reprocesar un mes").
3. **Errores por unidad** (exit 1, hay otras unidades bien): el script escribió las unidades sanas y reporta las otras. Causas típicas:
   - `El historial termina en ... (H-C01-02)`: `as_of` no corresponde al mes que se cierra (ver "Reprocesar un mes").
   - Un indicador con configuración inválida: lo corrige la gestora o el custodio en la app.
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
- Es idempotente: solo reescribe las evaluaciones que cambian y audita esas. Además deja una fila `evaluation_reprocess` en `audit_log` (con `written`, `alerts` y `errors`). Si el color o el nivel cambian, sale una alerta `color_change` nueva (la anterior queda en el historial). Si nada cambia, no hay alertas.
- La racha de escalada usa los meses ya guardados del trimestre. Al reprocesar un mes que no es el último, hay que reprocesar también los siguientes del mismo trimestre, en orden: M, M+1...
- `assertHistoryFresh` impide cerrar un mes que no sea el mes de `as_of` o el anterior. Siempre se usa el día 1 del mes siguiente al reprocesado.
- Ritmo diario de una fecha pasada: lanzar `ritmo-diario` con `as_of` = esa fecha (no necesita `reprocess`). Compara contra el último snapshot anterior a esa fecha.
- Auditoría de reprocesos: `select created_at, entity_id, details from audit_log where action = 'evaluation_reprocess' order by created_at desc;`

### Restaurar
- Las evaluaciones son derivables: se recalculan desde `measurements`, `commitments`, `targets` y `exceptions` reprocesando los meses del trimestre en orden.
- Las alertas y `audit_log` no se regeneran, porque son historial.
- **Respaldos en el plan gratuito.** No hay PITR y no hay que contar con restaurar desde el panel. Antes de cada despliegue que traiga migraciones nuevas, el usuario saca un volcado lógico **en su equipo**: `supabase db dump -f esquema.sql` y `supabase db dump --data-only -f datos.sql`. Nunca se guarda como artefacto de Actions ni en el repo, porque el repo es público.
- **Restaurar tras una migración dañina.** Primero se escribe una migración correctiva en un PR revisado y se despliega (ver `docs/despliegue.md`). Si hay que borrar tablas o columnas con datos, o recargar `datos.sql`, es compuerta del usuario (CLAUDE.md §3).

## Despliegue (`deploy.yml`, V-05)
Procedimiento completo en `docs/despliegue.md`. Decisiones en ADR 0014.
- **Falla `verify`**: falta un secreto, el prefijo de clave es incorrecto, la rama no es `main`, `confirm` no vale `desplegar` o Auth tiene el registro abierto. Corregir la configuración. Crear o rotar secretos y cambiar Auth es tarea del usuario.
- **Falla `build-pages`**: si la verificación de `dist/` detecta un secreto u origen local, tratarlo como el fallo de gitleaks (ver arriba). Si el build falla por la CSP, `SUPABASE_URL` no coincide con `PRODUCTION_SUPABASE_ORIGIN` (ADR 0011).
- **Falla `migrate`**: la BD puede quedar a medias, porque `db push` aplica cada archivo en su propia transacción. Revisar `supabase migration list` y corregir con una migración nueva. Nunca se edita una migración ya aplicada.
- **Falla `smoke`**: comprobar Settings → Pages (fuente = GitHub Actions) y relanzar solo `smoke`. Si la URL responde pero la app no carga, revisar `base` en `vite.config.js`.
- **Cuidado con la concurrencia con las evaluaciones**: `despliegue-produccion` y `evaluacion-produccion` son grupos distintos. No hay que desplegar migraciones de `evaluations`, `alerts` o `audit_log` el día 1 a la hora del cron mensual.

## Pendiente de completar
- Disponibilidad de Pages y Supabase y vigilancia automática de los cron (`salud.yml`, V-04). Una vez publicado (V-05), el plan gratuito pausa el proyecto tras unos 7 días sin actividad: V-04 debe llegar antes de esa ventana o, mientras tanto, `ritmo-diario` (activado con P-05) mantiene la actividad.
