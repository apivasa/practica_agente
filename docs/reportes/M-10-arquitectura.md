# M-10 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. Los CHECK de valor finito son detalle de implementación del modelo de datos que ya existe y siguen el criterio de `measurements_value_finite` (M-09).
Salud: CI y Seguridad en verde en `item/M-10` sobre 945d063. Sin cambios en los workflows programados ni en `salud.yml`.

Hallazgos:
1. **No es destructiva.** `20261125120000_numeric_finite_m10.sql` solo hace `ADD CONSTRAINT` (seis CHECK) en `indicators`, `commitments` y `targets`. No borra ni cambia columnas ni datos, y no hay columnas ni tablas nuevas: siguen las 9 tablas. No es compuerta de migración destructiva. El timestamp es posterior a M-09, así que el orden de aplicación es correcto.
2. **Riesgo de aplicación controlado.** Sin `NOT VALID`, cada `ADD CONSTRAINT` valida las filas existentes. Si en producción hubiera un valor no finito, `migrate` falla sin aplicar nada del archivo (una transacción por archivo). Las tres consultas de solo lectura del final del archivo lo detectan antes. Se añadió el paso a `docs/operacion.md` › Despliegue, junto a los de M-08 y M-09.
3. **Coherencia BD/motor.** El motor ya rechaza los no finitos en las mismas columnas: `engine/indicator.js:49-53` (umbrales), `engine/commitment.js:66-67,115-123` (overrides) y `engine/measure.js:128` (meta). La BD ahora aplica la misma regla también a las escrituras directas por PostgREST, que aceptan `'NaN'` como texto en `numeric`. No hay lógica duplicada fuera de `engine/`.
4. **Semántica de NULL correcta.** `green_threshold`, `yellow_threshold` y `target_value` son `not null`. Las columnas opcionales de `commitments` llevan `is null or (...)`, que es explícito aunque un CHECK con NULL ya pasaría. El `<> 'NaN'` sobra (en PostgreSQL `NaN` es mayor que `Infinity`), pero se lee mejor.
5. **Fuera de alcance, sin acción.** `evaluations.value` queda sin CHECK: solo lo escribe el backend con el motor, que descarta los no finitos. Es coherente con el comentario de la migración.
