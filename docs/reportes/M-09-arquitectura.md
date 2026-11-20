# M-09 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. El endurecimiento no cambia ninguna decisión: los grants por columna y el CHECK son detalle de implementación de ADR 0005 y del modelo de datos que ya existe.
Salud: CI y Seguridad en verde en `item/M-09` sobre 8a855e0. El rojo de CI en 2ca4a33 venía de la prueba de seguridad 045, que esperaba el comportamiento anterior de `targets`; se ajustó a 42501 en d66e022. `main` en verde (últimos CI y Seguridad `success`). Sin cambios en los workflows programados ni en `salud.yml`.

Hallazgos:
1. **Sin columnas ni tablas nuevas.** Siguen las 9 tablas. La migración `20261124120000_hardening_m09.sql` es aditiva: `revoke update` de tabla + `grant update (target_value)` en `targets`, `ADD CONSTRAINT measurements_value_finite` y `create or replace` de `private.check_measurement_category()`. No borra datos ni columnas, así que no es compuerta de migración destructiva.
2. **Coherencia BD/motor.**
   - `targets`: `src/data/target-admin.js` solo envía `{ target_value }` en el `update` y hace un `insert` completo (el `insert` mantiene el grant de tabla). No usa `upsert`, que sí necesitaría UPDATE sobre las columnas del conflicto. El privilegio por columna no afecta al trigger AFTER `audit_targets`. `scripts/lib/db.js` solo lee `targets` con la clave secreta.
   - `measurements_value_finite`: en PostgreSQL `NaN` es mayor que cualquier otro valor, así que `value < 'Infinity'` ya excluye `NaN`. El `<> 'NaN'` explícito sobra, pero se lee mejor. Coincide con `engine/measure.js` y `engine/rows.js` (`Number.isFinite`).
   - Trigger VULN: el tope `9007199254740991` es `Number.MAX_SAFE_INTEGER`, el mismo criterio de `engine/rows.js:149` (`Number.isSafeInteger(n) && n >= 0`). La comparación explícita con `NaN` hace falta porque `NaN = trunc(NaN)` es verdadero.
   - `cumulativeThirds` (`engine/vulnerabilities.js`): el tope `Math.min(..., total)` sigue en `engine/` como función pura compartida por `packageStatus` y la propuesta de metas (M-07). No hay copias en `src/` ni en `scripts/`. Con paquetes enteros, que son los que valida la BD, el resultado no cambia.
3. **Verificación antes del primer despliegue.** Se añadió a `docs/operacion.md` › Despliegue, junto a la de M-08. Las dos consultas de solo lectura del final de la migración deben devolver 0 filas.
   - Si la primera devuelve filas, el `ADD CONSTRAINT` valida las filas existentes y falla. Como `db push` usa una transacción por archivo, no se aplica nada del archivo, tampoco los grants ni el trigger.
   - Si la segunda devuelve filas, la migración se aplica y el motor ya descarta esas filas.
   - Una vez aplicada, un `PATCH` sobre otra columna de `targets` devuelve 42501. Es lo esperado.
4. **Runbook corregido dentro del ítem.** En `docs/operacion.md` §6 pentest-api se quitó «Relanzar solo el job (`rerun-failed-jobs`)» ante `address already in use`: contradecía el reintento automático de `scripts/ci/supabase-start.sh` (F-07). La nota histórica del puerto 54324 (inbucket) también remite ahora a F-07.
5. **Observación sin acción.** Las mediciones que no son VULN siguen sin tope superior. Un `numeric` finito enorme (por ejemplo `1e400`) llega a JS como `Infinity` y `engine/measure.js` lo descarta (`REASON_OUT_OF_RANGE`), así que el motor está protegido. Rechazarlo ya en la entrada sería un ítem aparte, de prioridad baja.
