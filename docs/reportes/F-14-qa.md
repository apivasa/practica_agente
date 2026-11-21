# F-14 — Informe QA

Veredicto: VERDE

Rama `item/F-14`, revisada sobre 637a7a2. Probé contra el criterio de `docs/plan-maestro.md` (fila 28f) y contra los hallazgos H-F13-01 y H-F13-02 de `docs/reportes/F-13-seguridad.md`.

## Criterio de aceptación

| Punto | Estado |
|---|---|
| H-F13-01: `assessDeploy` solo cubre un fallo con `warn` si es aislado; una cadena de fallos no queda oculta | Cumplido. Ver la nota sobre la desviación. |
| H-F13-01: el rojo esperado de H-F11-06 (un fallo único seguido del run que lo supera) sigue dando `warn` | Cumplido |
| H-F13-02: `newerPendingRun` rechaza timestamps que no son texto | Cumplido |
| H-F13-02: `newerPendingRun` rechaza timestamps en el futuro más allá de un margen (`FUTURE_SKEW_MIN` = 5 min) | Cumplido. El límite exacto se acepta y 1 ms más se rechaza. |

### La desviación del desarrollador

El criterio dice "anterior success **o** el fallo tiene menos de `maxPendingMin`". El desarrollador implementó solo la primera condición. El caso `[pendiente 1 min, failure 20 min, failure 30 min]` muestra por qué. Con la alternativa, el fallo más reciente tiene menos de 90 min, así que daría `warn` y la cadena quedaría oculta. Eso contradice la frase que cierra la corrección sugerida en H-F13-01: "Con dos fallos seguidos, `fail`". En una cadena real, la alternativa reabriría casi siempre el hueco, porque `salud.yml` corre cada 6 h y los fallos de `deploy` en push suelen ser recientes.

Conclusión: la desviación cumple la intención del hallazgo mejor que su texto literal. La acepto. La prueba `desviación del desarrollador` la deja fijada.

## Pruebas añadidas

`tests/scripts/qa-f14.test.js`, con 24 casos:

- **[1] H-F13-01 (14 casos):**
  - Reproducción literal del hallazgo: da `fail`.
  - Dos fallos recientes por debajo de `maxPendingMin`: da `fail`. Es la desviación.
  - Un anterior en `timed_out`, `startup_failure` o `action_required` forma cadena.
  - Un `skipped`, un `neutral` o varios `cancelled` entre dos fallos no rompen la cadena.
  - La entrada desordenada da el mismo veredicto.
  - Evolución en el tiempo: un fallo aislado da `warn`. Si el pendiente también falla y entra otro run en cola, la siguiente corrida da `fail`.
  - Un fallo de `pull_request` no forma cadena. Uno de `workflow_dispatch` sí.
  - Fallo aislado viejo (300 min) con pendiente reciente: da `warn`. H-F11-06 se conserva.
  - Un success antes de un cancelado cuenta como aislado.
  - Fallo aislado con el pendiente atascado: da `fail`.
  - Regresiones: cadena sin pendiente da `fail`; success con fallos viejos detrás da `ok`.
- **[2] H-F13-02 (10 casos):**
  - Límite exacto de `FUTURE_SKEW_MIN` (en el límite cubre; 1 ms después no). Además se comprueba que el margen es de minutos y no de horas.
  - Un pendiente con fecha +10 h hace que `assessDeploy` dé `fail`.
  - Un `run_started_at` en el futuro no cubre.
  - Un `created_at` del fallo en el futuro, numérico, de tipo `Date` o ausente no cubre.
  - Un `created_at` del pendiente numérico, de tipo `Date`, `12` o `null` no cubre.
  - Un `run_started_at` numérico no cubre y no se sustituye por `created_at`.
  - Un `run_started_at` `null` o vacío usa `created_at`, como antes.
  - Los ISO de la API, con y sin milisegundos, siguen funcionando.
  - Un pendiente creado antes del fallo nunca cubre.

## Resultado local

Las pruebas corren con `node --test`:

| Conjunto | Resultado |
|---|---|
| `tests/scripts/qa-f14.test.js` | 24/24 |
| Salud y regresión de F-11 a F-14 (`health*`, `qa-v04*`, `f1*-fixes`, `qa-f1*`) | 359/359 |
| `tests/engine` + `tests/scripts` con cobertura | 1514/1514 |

En `scripts/health/lib.js` el código nuevo de F-14 queda cubierto entero: 99,33 % de líneas, y las líneas 82-84 que faltan no son de F-14. No completé la suite entera de `tests/**` porque pasa del tiempo límite de la sesión. CI la corre al hacer push.

Resultado CI: lo verifica el orquestador en los runs de `item/F-14` tras este push.

## Cobertura engine/

Aproximadamente 99,6 % de líneas, por encima de la meta del 95 %. Por archivo, todos están al 100 % salvo `commitment.js` (99,35), `xlsx.js` (98,49) y `zip.js` (97,16). F-14 no toca `engine/`.

## Hallazgos

Ninguno bloqueante.

- **QA-F14-01 · Info.** Si el despliegue anterior al fallo queda fuera de la página que devuelve la API, `isolatedFailure` trata el fallo como aislado. Eso solo pasa cuando hay muchos cancelados u omitidos entre los dos, y está documentado en el código. Es aceptable.
- **QA-F14-02 · Info.** El orden de `relevant` y la detección de `stuck` en `assessDeploy` siguen usando `Date.parse` sin validar. Queda fuera del alcance de H-F13-02, que solo nombra `newerPendingRun`, y no abre ocultación: con fechas inválidas, el pendiente ahora no cubre y el resultado es `fail`. Cómo reproducirlo: un pendiente con `created_at` en el futuro no se marca como `stuck`, pero el check falla igual por el `failure`.
