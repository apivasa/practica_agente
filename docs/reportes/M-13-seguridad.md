# M-13 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. El ítem solo cambia JS: añade `engine/numeric.js` (`SAFE_ABS_LIMIT`, `SAFE_ABS_LIMIT_TEXT`, `isSafeMagnitude`) y aplica el tope |v| < 2^53 antes de guardar en `engine/indicator.js` (umbrales generales y por categoría), `engine/commitment.js` (overrides, paquete por categoría y su suma) y `engine/measurements-input.js` (todas las mediciones, en el formulario y en el CSV). No toca la BD, ni grants, ni RLS, ni workflows, ni dependencias. La validación del front es de usabilidad: la barrera real sigue siendo la BD, con los CHECK `*_safe` de M-11 y M-12.

Pruebas de seguridad añadidas:
- `tests/security/engine-m13.test.js`: 8 casos.
  - Categoría 3 (Entradas), 6 casos:
    - `SAFE_ABS_LIMIT_TEXT` es un texto fijo, sin HTML ni prefijo de fórmula.
    - `isSafeMagnitude` no hace coerción. Rechaza objetos con `valueOf` o `toString`, `new Number`, cadenas, BigInt, arreglos, booleanos, NaN, ±Infinity y ±2^53. Acepta `-0`, `1e-300` y ±(2^53−1).
    - `validateIndicator` da mensajes de fuera de rango que no reflejan el valor, aunque la categoría lleve un payload XSS.
    - `validateCommitment`:
      - los overrides de ±1e300 no aparecen en el mensaje;
      - una suma de paquetes seguros que pasa de 2^53 se rechaza;
      - la clave `__proto__` se rechaza sin contaminar el prototipo.
    - `validateMeasurementInput` responde a un valor de 400 dígitos con un mensaje fijo que no lo repite.
    - `parseMeasurementsCsv` recibe filas con 2^53, 400 dígitos, `=1e300` y una cola de 400 KB pensada contra `NUMBER_RE`:
      - el análisis termina en menos de 2 s, así que no hay ReDoS (en CI tardó unos 30 ms);
      - no guarda ninguna fila;
      - ningún mensaje empieza por `= + - @` ni reproduce la cifra.
  - Categoría 1/6, 2 casos:
    - Los 9 CHECK `*_safe` de M-11 y M-12 siguen en las migraciones. Ninguna migración posterior los borra ni los marca `not valid`, y las pruebas de API que los atacan (`api/numeric-safe-cap-m11`, `api/json-shape-m12`) no tienen `skip` ni `todo`.
    - `engine/numeric.js` es puro: sin red, almacenamiento, `eval`, regex ni secretos.

Resultados del pipeline (commit 1253eef, que incluye d297472 con las pruebas):
- Seguridad, run 44728208149: https://github.com/apivasa/practica_agente/actions/runs/44728208149. Todos los jobs terminaron en success:
  - gitleaks (historial completo);
  - semgrep (JS, secretos, Actions, SQL);
  - CodeQL (actions, javascript-typescript);
  - npm audit (producción);
  - DAST (e2e de seguridad y ZAP baseline);
  - pruebas de seguridad (`tests/security`): 575 pass, 0 fail, 0 skip, con los 8 casos de M-13;
  - pentest API contra Supabase local: 553 pass, 0 fail, 0 skip. Incluye los ataques directos por PostgREST con 1e400, 2^53 y notación exponencial, que la BD rechaza con 23514 aunque se salte el front.
  - Las fases A y B de S-05 se omitieron porque no corresponden a este ítem.
- CI, run 44728208062: https://github.com/apivasa/practica_agente/actions/runs/44728208062 (success).
- Antes de eso, el commit del desarrollador (45778d4) pasó Seguridad en el run 44725311504, en success.

Hallazgos: ninguno nuevo. No cambia el estado de ningún hallazgo en `docs/seguridad/hallazgos.md`.

Observaciones sin hallazgo:
- XSS: los mensajes nuevos interpolan solo constantes y el nombre de la categoría. Ese nombre lo configura la gestora y también lo valida la BD. Todo se pinta con `el(..., { text })`, es decir, con `textContent` (`src/views/dom.js:41`). En `src/` no hay `innerHTML`, `insertAdjacentHTML` ni `document.write`. La lista de errores del CSV (`src/views/custodian/measurements.js:181-186`) también usa `textContent`.
- Inyección de fórmulas: los mensajes no se exportan a ningún CSV ni hoja de cálculo; solo se muestran. Además empiezan por una etiqueta fija (`valor:`, `Umbral`, `Paquete`, `thresholds`). Los mensajes previos de formato (`valor: "<entrada>" debe ser un número…`) ya repetían la celda como texto inerte. No cambian en este ítem y no son explotables.
- La BD sigue siendo la barrera real: el front no relaja ni sustituye ningún CHECK. El pentest API confirma el rechazo por PostgREST con el JWT de cada rol.
- ReDoS: el diff no añade expresiones regulares. `NUMBER_RE` e `INTEGER_RE` son lineales (sin cuantificadores anidados), y la prueba con 400 KB lo confirma.
- La meta mensual (`src/lib/targets-form.js:44`) ya tenía su propio tope (`TARGET_MAX`), así que no queda hueco.

Verificado sin hallazgos:
- Categoría 1 (RLS): sin cambios; la regresión del pentest API está en verde.
- Categoría 3 (Entradas): tope, coerción, prototipo, CSV, fórmulas y ReDoS.
- Categoría 4 (Front): sin sumideros HTML; el DAST y ZAP están en verde.
- Categoría 6 (Cadena de suministro): sin dependencias nuevas; gitleaks, semgrep y CodeQL en verde; sin secretos en el diff.
- Categorías 2, 5, 7 y 8: el ítem no las toca y la regresión completa pasó en verde.
