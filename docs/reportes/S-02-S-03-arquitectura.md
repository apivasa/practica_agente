# S-02+S-03 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí (solo añade un job a `seguridad.yml`, pruebas en `tests/security/api/` y documentación de seguridad; no toca front, `engine/`, migraciones ni el modelo de datos; el pentest corre contra Supabase local efímero, sin secretos del repo ni hosts externos)
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (el job sigue la política de ADR 0007 y la matriz verifica ADR 0005 tal cual). Actualizado `docs/operacion.md`: tiempos base, runbook de `pentest-api` y regla para PR mayores de Dependabot.
Salud: CI run 44605484960 `success` (build 10 s, db 66 s, e2e 28 s). Seguridad run 44605484997 `success`: pentest-api 74 s (428 pass, 0 skipped), pruebas de seguridad 23 s (258 pass), CodeQL JS 62 s; el total de pared pasa de ~50 s a ~75–95 s y lo marca pentest-api, dentro del umbral (> 7 min). Los dos fallos previos de pentest-api (44604283956, 44604729716) fueron defectos reales de las pruebas, corregidos en la rama: no hay intermitencia. `salud.yml` y los workflows programados aún no existen (sin producción).

## Verificación de lo pedido

- **Acciones por SHA:** `actions/checkout`, `actions/setup-node` y `supabase/setup-cli` fijadas por SHA de 40 hex con `# vX.Y.Z`, los mismos SHA que el resto de workflows y que `ci.yml`. `workflows.test.js` lo exige para el job.
- **CLI fija:** `version: 3.2.0`, igual que `ci.yml` (H-002). La prueba exige versión semver, no `latest`.
- **Permisos mínimos:** el job no declara `permissions`; hereda `contents: read` del workflow. `persist-credentials: false`. No usa `secrets.` (lo afirma una prueba). Las claves locales van por un archivo `umask 077`, no por `GITHUB_ENV`; solo se imprimen los nombres.
- **Duración:** 74 s (93 s en el run más lento), frente a un `timeout-minutes: 30` holgado. Tiempos base añadidos a `docs/operacion.md` con alerta > 5 min.
- **Omisión fuera / fallo dentro:** verificado en los logs. En `ci.yml` › build (`test:unit` incluye `tests/**`) las tres suites salen `# SKIP sin Supabase local ...`. En `pentest-api` corren las tres, con `# skipped 0`. Con `PENTEST_REQUIRE=1` y sin variables, `skipReason()` lanza al cargar el módulo y el archivo falla. La prueba de política exige que `PENTEST_REQUIRE: '1'` siga en el job, así que nadie puede quitarlo sin que CI falle.
- **Regresión de catálogo:** `rls-matrix.test.js` › catálogo falla si una tabla o vista de `public` no tiene RLS, no tiene `security_invoker` o no tiene fila en la matriz, y también si la matriz tiene tablas que ya no existen. Además falla si aparece una función RPC no prevista. Cubre los principios de diseño "toda tabla con RLS" y "prueba por rol" (CLAUDE.md §4).
- **Modelo de amenazas frente al diseño:** los actores y permisos coinciden con `docs/diseno.md` § Roles y § Excepciones: la gestora define, el custodio carga solo su KPI, el comité ve todo y aprueba excepciones, el líder ve solo su unidad. El modelo cuenta 10 tablas (las 9 del diseño más `audit_log`, ya justificada en ADR 0005). La autorización sale de `user_roles`, nunca del JWT (ADR 0005). Las Actions con la clave secreta son las únicas que escriben `evaluations`, `alerts` y `audit_log`. Las amenazas de componentes aún no construidos quedan asignadas a S-04, C-03, V-04 y V-05, sin inventar funcionalidad.

## Hallazgos
1. **[Menor, no bloquea] Tabla rota en `docs/seguridad/modelo-amenazas.md`.** Hay una línea en blanco entre la fila T-CI-09 y la fila T-CI-10, así que T-CI-10 se renderiza como texto suelto. Lo corrige seguridad quitando la línea en blanco.
2. **[Informativo] Claves locales en el log.** `supabase start` imprime por su cuenta la tabla de claves (`sb_publishable_…`, `sb_secret_…`). Son las claves por defecto de la CLI, públicas y válidas solo en el runner efímero, así que no hay fuga. El commit fe80af4 evita imprimirlas en los pasos propios, pero no puede silenciar la CLI. Queda documentado en el runbook para que nadie lo trate como incidente. Si se quiere ocultar, se puede añadir `supabase start ... > /dev/null` y conservar el log en caso de fallo; queda como mejora opcional de seguridad.
3. **[Informativo] `timeout-minutes: 30`** es unas 20 veces la duración real. Es aceptable, pero 10 min liberaría antes el runner si `supabase start` se cuelga. No bloquea.

## PR abiertos de Dependabot (#8–#11)

Los cuatro son devDependencies (no llegan al bundle de producción) y tienen como base `6f77013`, anterior a `main` actual (`3bf935d`, #12). Como sus lockfiles chocan entre sí, cada uno necesita `@dependabot rebase` y CI en verde sobre el `main` actual antes de fusionarse. Conviene hacerlo después de integrar S-02+S-03, para que también corra `pentest-api`.

| PR | Cambio | CI / Seguridad | Recomendación |
|---|---|---|---|
| #11 | globals 16.5.0 → 17.14.0 | verde / verde | **Fusionar** (primero; menor riesgo), tras rebase. |
| #10 | eslint 9.39.5 → 10.15.0 | verde / verde | **Fusionar** tras rebase, antes que #8. |
| #8 | @eslint/js 9.39.5 → 10.0.1 | **rojo / rojo** (`ERESOLVE`: pide eslint 10, hay 9) | **Esperar**: tras fusionar #10, `@dependabot rebase`; si queda verde, fusionar. No forzar con `--legacy-peer-deps`. |
| #9 | vite 7.3.8 → 8.3.8 | verde / verde (build, e2e y escaneo de `dist/`) | **Fusionar al final y solo**, tras rebase. Es una versión mayor del empaquetador: confirmar que `static-secrets` y e2e siguen en verde sobre `main`. |

Mejora sugerida (ítem para el desarrollador, que es dueño de `.github/dependabot.yml`): agrupar `eslint` y `@eslint/js` con `groups:` para que Dependabot los proponga en un solo PR y no se repita el `ERESOLVE`.
