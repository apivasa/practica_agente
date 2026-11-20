# V-08-V-09 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (el cambio aplica ADR 0003, 0009, 0012 y 0013 sin decisiones nuevas)
Salud: CI y Seguridad en verde en la rama (`daed5cc`). Main en verde (último CI y Seguridad `success`, 2026-11-20 07:11 UTC). Todavía no hay runs programados (`event=schedule`): producción pendiente (P-02/P-03), así que no hay nada que vigilar. Localmente `node --test` sobre `tests/engine` y `tests/front` da 733 pruebas, todas pasan; `lock-v08` y `scope-labels-v09` dan 23, todas pasan.

## Revisión

### Lógica en `engine/` sin duplicados
- `engine/lock.js` es puro: no lee el reloj (`today` lo pasa quien llama, ADR 0003 punto 3) y no hace llamadas de red. Reutiliza `evaluateEscalation`, `exceptionFromRow` y `quarterBounds` sin reimplementarlos.
- `buildHistory`, `assertHistoryFresh` y `YELLOW_MONTH2_ESCALATES_LIKE_RED` se movieron desde `scripts/lib/build.js`, que ahora solo los reexporta. Las Actions (`run.js` → `globalEvaluation`) y el front (`unitLockToday` → `lockToday`) construyen el historial con la misma función y aplican la misma frescura (H-C01-02). No queda una segunda copia.
- `src/lib/dashboard.js#unitLockToday` solo agrega presentación: el texto "Inicio autorizado: REF" y la base del cálculo. No vuelve a calcular nada.
- El cambio de `storedColors[m] ?? 'not_evaluated'` a `Object.hasOwn(...)` no cambia el comportamiento en las Actions, porque `run.js` solo guarda meses que tienen fila. En el front, además, evita que una clave heredada se confunda con un mes guardado.

### ADR 0003: un inicio puntual no levanta el congelamiento
- `lockToday` delega en `evaluateEscalation`, que con la unidad en `frozen` y una excepción `change_start` mantiene `level: 'frozen'` y todas las restricciones. Solo devuelve `authorizedStarts`. El front lo muestra como "Inicio autorizado: REF" debajo del nivel congelado, no como un cambio de nivel. Las pruebas de `tests/engine/lock-v08.test.js` lo cubren.
- Solo `scope: 'all'` vigente pasa la unidad a `exception` (restricciones suspendidas). Esto coincide con el diseño y con ADR 0012.

### El candado de hoy frente al candado oficial del cierre
- No se contradicen de forma confusa. Los dos usan el mismo historial (las evaluaciones globales guardadas) y el mismo motor. Solo cambia la fecha con la que se miran las excepciones: la del cierre en el oficial y hoy en el de hoy.
- La interfaz los separa con etiquetas explícitas: "Restricciones del cierre de AAAA-MM" frente a "Candado vigente hoy". Además el candado de hoy dice en qué se basa ("Según el cierre de AAAA-MM y las excepciones vigentes al AAAA-MM-DD"). En el comité es una columna aparte, "Candado hoy".
- El candado guardado sigue siendo el oficial y auditado. El de hoy no escribe nada ni dispara alertas, así que no crea una segunda fuente de verdad.
- La frescura es igual a la de la evaluación mensual: el cierre tiene que ser del mes actual o del anterior; si no, se muestra "Sin cierre vigente". El front pide 12 meses de evaluaciones (`HISTORY_MONTHS`), que cubren el trimestre del cierre.

### V-09: un solo mapa de alcances
- `SCOPE_LABELS` y `scopeLabel` viven solo en `src/lib/exceptions-logic.js`. `dashboard.js` los reexporta y no queda otra definición en `src/`. `scopeLabel` usa una lista blanca (`Object.hasOwn`), así que una clave heredada sale literal.
- Que las etiquetas vivan en `src/` y no en `engine/` es correcto: son texto de interfaz, no lógica de cálculo (ADR 0009).

## Hallazgos
1. (Informativo, no bloquea) Q-03 (`YELLOW_MONTH2_ESCALATES_LIKE_RED`) hoy es una constante del motor, y el front y las Actions la toman del mismo sitio, así que hoy coinciden. Si al responder Q-03 el valor pasa a configuración en la BD, `lockToday` debe recibir `yellowLikeRed` desde esa misma configuración en el front. Si no, el candado de hoy y el oficial divergirían. Conviene anotarlo como criterio del ítem que resuelva Q-03.
2. (Informativo, no bloquea) Si una sola excepción de la unidad trae datos malformados, todo el candado de hoy queda `invalid`, y el aviso es explícito ("No se pudo calcular el candado de hoy"). Esto falla de forma segura y las restricciones de la BD (CHECK y fechas) lo impiden en la práctica. No requiere cambio.
3. (Informativo) En el inicio del líder, la etiqueta "Restricciones del cierre de AAAA-MM" usa el mes elegido en el selector, que puede ser anterior al cierre en que se basa el candado de hoy. La línea de base del candado de hoy deja claro de qué mes sale cada uno, así que es aceptable.
