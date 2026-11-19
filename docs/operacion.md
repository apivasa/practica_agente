# Operación — runbook

Dueño: arquitecto-SRE. Zona horaria de negocio: America/Guayaquil (UTC-5, sin horario de verano).
Producción aún no existe (P-02/P-03 pendientes): la salud se prueba en CI contra Supabase local. `salud.yml`, `evaluacion-mensual` y `ritmo-diario` todavía no existen; sus secciones se añadirán con C-03 y el ítem de salud.

Consultas útiles (solo REST, ver CLAUDE.md §5):
- Runs de una rama: `gh api 'repos/apivasa/practica_agente/actions/runs?branch=<rama>&per_page=6' --jq '.workflow_runs[]|{id,name,event,conclusion}'`
- Jobs y duración: `gh api repos/apivasa/practica_agente/actions/runs/<id>/jobs --jq '.jobs[]|{name,started_at,completed_at,conclusion}'`
- Log de un job: `gh api repos/apivasa/practica_agente/actions/jobs/<job_id>/logs`
- Relanzar: `gh api -X POST repos/apivasa/practica_agente/actions/runs/<id>/rerun-failed-jobs`

## Workflows y tiempos base

Medidos en la rama `item/S-01` (2026-11-19, `ubuntu-latest`). Los jobs de cada workflow corren en paralelo salvo `e2e`, que espera a `build`.

| Workflow | Disparadores | Job | Base | Alerta si |
|---|---|---|---|---|
| `ci.yml` | PR; push a `main`, `item/**`, `fix/**`; manual (y desde `lockfile.yml`) | build (lint, unit, build) | 16–23 s | > 2 min |
| | | db (pgTAP, CLI Supabase 3.2.0) | 69–74 s | > 4 min |
| | | e2e (Playwright, tras build) | 26 s | > 3 min |
| | | **total de pared** | **~70 s** | > 5 min |
| `seguridad.yml` | PR; push a `main`, `item/**`, `fix/**`, `ensayo/**`; lunes 06:17 UTC (01:17 Guayaquil); manual | gitleaks | 8 s | > 2 min |
| | | semgrep | 24 s | > 3 min |
| | | npm audit | 11 s | > 2 min |
| | | CodeQL (actions) | 39 s | > 5 min |
| | | CodeQL (javascript-typescript) | 50 s | > 6 min |
| | | pruebas de seguridad | 9 s | > 2 min |
| | | **total de pared** | **~50 s** | > 7 min |
| `lockfile.yml` | push a `item/**`, `fix/**` que cambie `package.json`; manual (nunca en `main`) | lockfile | < 30 s | > 2 min |

Fuentes: CI run 44597648985, Seguridad run 44597649643 (ambos `success`); referencia previa CI run 44594674729.

Tasa de fallos observada: en `main`, los fallos/cancelaciones del 2026-11-19 vienen de la puesta en marcha (cancelaciones por concurrencia y un fallo antes del lockfile), no de pasos intermitentes. En `item/S-01`, un solo fallo de Seguridad (run 44595333304) causado por la rama `ensayo/s01-secreto` y corregido en el ítem. Ningún paso intermitente detectado todavía.

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
6. **Run semanal** (lunes) falla sin cambios de código: casi siempre es una CVE nueva (npm audit) o una regla nueva (semgrep/CodeQL). Abrir rama `fix/seguridad-<fecha>`; el orquestador lo trata en el paso 3 del ciclo ("salud primero").
7. **Dependabot** propone subir una acción: verificar que el SHA corresponde al tag del comentario y que CI y Seguridad pasan en el PR antes de fusionar.

## Pendiente de completar
- Disponibilidad de Pages y Supabase (`salud.yml`), reprocesar un mes, restaurar: se documentan cuando existan producción y los workflows programados.
