# ADR 0010 — Configuración de indicadores, compromisos y captura de mediciones

Estado: Aceptado (decisión técnica, 2026-11-19, ítems M-02, M-03 y M-04; no contradice el diseño ni ADR 0005/0009)

## Contexto
M-02 (alta y edición de indicadores por la gestora), M-03 (compromisos por unidad, indicador y periodo con umbral negociado) y M-04 (captura manual e importación CSV) son las primeras pantallas de escritura. El desarrollador tomó decisiones que no estaban fijadas en el diseño; este ADR las deja registradas.

## Decisión
1. **Registro de rutas y vistas (aplica ADR 0009).** `ROUTES` en `src/lib/route-logic.js` es la única fuente de rutas; `main.js` resuelve `VIEWS[view](ctx)` sin `if/else`; las subrutas de un rol se montan en `renderRoleShell` con el menú del registro filtrado por rol. Acceso a datos solo en `src/data/<dominio>.js` con mensajes en español (`raise`).
2. **Asignación de custodio sin RPC (no atómica).** La gestora asigna el custodio con tres escrituras por PostgREST: borra filas `custodian` previas del indicador, inserta la nueva en `user_roles` y actualiza `indicators.custodian_user_id` (informativa, ADR 0005). Orden "falla cerrado": si una escritura falla, el indicador queda sin custodio con permisos, nunca con dos. La pantalla detecta incoherencias entre `user_roles` y la columna y pide volver a guardar. Se acepta para la versión académica; si se necesita atomicidad, se hará con una función `security definer` y su ADR.
3. **Sin correos en el selector de custodio.** La API no expone `auth.users`; los candidatos son usuarios con alguna fila `custodian` y se etiquetan con los códigos que ya custodian y un fragmento del uuid. Consecuencia: dar el primer rol de custodio a un usuario nuevo sigue siendo tarea de alta de usuarios (fuera de la UI). Una tabla de perfiles con nombre visible requiere cambio del modelo de datos (ADR 0005) y por tanto decisión del usuario.
4. **`value` incremental en meta acumulada.** En `cumulative_target` cada medición registra lo resuelto o detectado en esa fecha; el motor (`engine/measure.js`) suma la ventana. Ni el CSV ni la captura manual guardan acumulados.
5. **Validación y parser CSV en `engine/measurements-input.js`.** Funciones puras, sin dependencia nueva; límites de 1 MiB y 5000 filas; celdas con forma de fórmula se rechazan; la inserción es una sola sentencia (todas o ninguna).
6. **Umbral efectivo del compromiso en `engine/commitment.js`** (`effectiveThresholds`): el override se aplica solo si vienen verde y amarillo y son coherentes con el sentido; si no, se usan los generales con `reason`.
7. **Semilla para e2e sin alterar la integración de C-03.** Usuarios ficticios `custodio3`, `multirol` y `sinrol`, e indicadores `CHG` y `LAT` **inactivos**: dan rol de custodio sin entrar en la evaluación programada ni cambiar sus conteos. Ninguno es líder ni comité, así que no reciben alertas de C-04.

## Deuda registrada (ítem propuesto)
`scripts/lib/build.js` (`indicatorConfig`, de C-03) aplica el override con su propia regla, que difiere de `effectiveThresholds`: con un override parcial (solo verde o solo amarillo) C-03 completa con el general y lo aplica, mientras que el motor lo descarta. Por el front no se puede guardar un parcial (`validateCommitment`), pero sí escribiendo directamente en PostgREST (el custodio tiene `UPDATE` sobre ambas columnas) y la BD no lo impide. Además `todayInBusinessTz` (`src/lib/dates.js`) duplica `todayInGuayaquil` (`scripts/lib/dates.js`). Se unifica en un ítem aparte (ver informe M-02-M-03-M-04): `indicatorConfig` pasa a usar `effectiveThresholds`, la fecha de negocio pasa a `engine/`, y un `CHECK ((green_override is null) = (yellow_override is null))` en `commitments` lo hace cumplir también en la BD.

## Consecuencias
- V-01..V-03 siguen el mismo patrón (ruta en `ROUTES`, módulo en `src/data/`, vista en `src/views/<rol>/`).
- El e2e crece con cada pantalla; el job midió 85 s con M-02..M-04 (umbral de alerta 4 min, `docs/operacion.md`).
