# ADR 0013 — Vistas por rol (líder, comité, completitud) y lógica compartida de filas

Estado: Aceptado (decisión técnica, 2026-11-19, ítems V-01, V-02 y V-03; no contradice el diseño)

## Contexto
V-01 (vista del líder), V-02 (matriz del comité) y V-03 (completitud por custodio) son las primeras pantallas que muestran resultados del motor. El líder ve el ritmo del paquete y los umbrales efectivos del mes. Para eso el front tiene que armar las entradas del motor desde filas de la BD, igual que `scripts/lib/build.js` en las Actions. Si se copia esa traducción en `src/`, el tablero y la evaluación programada pueden dar resultados distintos para el mismo dato. Eso rompe la regla de "una sola lógica en `engine/`" (CLAUDE.md, sección 6; ADR 0009, punto 2).

## Decisión
1. **La traducción de filas a contratos del motor vive en `engine/rows.js`** (`num`, `pickCommitment`, `indicatorConfig`, `isResolved`, `buildPackageInput`). El calendario puro vive en `engine/calendar.js` (`addMonths`, `monthEnd`, `quarterBounds`). Las dos son funciones puras sin red y se exportan desde `engine/index.js`. `scripts/lib/build.js` y `scripts/lib/dates.js` las **reexportan** para no romper a quien ya las importa. No quedan copias. `todayInGuayaquil`, `addDays` y los argumentos de la línea de comandos siguen en `scripts/lib/`, porque son propios de las Actions.
2. **El front nunca importa de `scripts/`.** Importa de `engine/` (directamente o vía `src/lib/dashboard.js`) y de `src/data/`. `src/lib/dashboard.js` solo agrupa y formatea filas. No calcula colores, ritmo ni umbrales.
3. **Los colores y la escalada se leen de `evaluations`, no se recalculan en el navegador.** La fuente de verdad del mes cerrado es lo que escribió `evaluate.js`. En el front, el motor solo se usa para lo que no se persiste: el estado del paquete a la fecha (`packageStatus`), el ritmo (`paceStatus`), los umbrales efectivos que se muestran y la vigencia de las excepciones (`exceptionStatus`, que ya tiene en cuenta las revocadas, según ADR 0012).
4. **Acceso a datos según ADR 0009:** hay módulos nuevos `src/data/evaluations.js`, `alerts.js` y `targets.js`, y funciones de lectura en `commitments`, `measurements` y `exceptions`. La autorización la hace RLS. El filtro por `recipient_user_id` en alertas es de usabilidad, porque la gestora y el comité leen todas las alertas. La única escritura nueva es `alerts.read_at`.
5. **Paginación:** PostgREST corta cada respuesta en `max_rows` (1000 por defecto en Supabase, que este proyecto no cambia en `supabase/config.toml`). Por eso toda lectura que pueda pasar de 1000 filas pagina con `.range()` hasta recibir una página incompleta. Un `.limit(n)` con n > 1000 no sirve: se corta igual, sin aviso.
6. **Datos e2e:** las evaluaciones y alertas que usan los e2e no van en `supabase/seed.sql`. Las produce `scripts/ci/seed-evaluations.sh`, que corre el mismo `scripts/evaluate.js` de las Actions (cierres 2027-02-01 y 2027-03-01, y diaria 2027-02-10) contra Supabase local. Usa `EVALUATE_ALLOW_FUTURE=1`, que se rechaza con cualquier host que no sea local. La clave secreta local se enmascara y no pasa a `GITHUB_ENV` ni al build. Así el e2e prueba también el camino real de escritura y la semilla no tiene resultados que el motor no haya calculado.
7. **Rutas:** `/gestora/completitud` es una entrada nueva del registro. El inicio del comité (`/comite`) y el del líder (`/lider`) pasan de la pantalla genérica a sus tableros, según ADR 0009, punto 3.

## Consecuencias
- Si cambia la forma en que se arma la entrada del motor (por ejemplo, un `measurement_type` nuevo), se cambia en un solo lugar y afecta a la vez al tablero y a la evaluación programada.
- El job e2e depende de que `evaluate.js` funcione contra la semilla. Si falla en «Evaluar la semilla», primero hay que revisar el job `integration`, que prueba el mismo script (ver `docs/operacion.md`).
- Las tablas siguen siendo las 9 del diseño y no hay columnas nuevas.
