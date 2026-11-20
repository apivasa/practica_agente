# M-06 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: el color mensual de los indicadores `cumulative_target` con `thresholds_by_category` (VULN) se calcula por criticidad desde `commitments.package_by_category` (jsonb, lo escribe el custodio) y las mediciones `resolved`/`detected` (custodio), y alimenta la escalada (racha de rojos → congelamiento). La vista del líder muestra una meta nueva por categoría (`categoryGoal`) con etiquetas que salen de las claves jsonb que escribe la gestora. Cambia la semilla (cifras ficticias) y `integration.sh` borra `targets` de VULN en Supabase local.

Pruebas de seguridad añadidas: `tests/security/engine-m06.test.js`, 17 casos:
- 3 · Entradas: 9 (claves `__proto__`/`constructor`/`toString`/`hasOwnProperty` en `thresholds_by_category`, `package_by_category` y `measurements.category`; paquete negativo, decimal, NaN, Infinity, `1e400`, texto, enorme; umbrales NaN/Infinity/negativos/>100/nulos/no objeto; mediciones decimales, enormes, negativas, sin categoría, en minúsculas, fuera del trimestre; `hasCategoryEvaluation` con array/texto/null).
- 5 · Automatizaciones: 4 (lo resuelto se recorta por criticidad, una categoría sin paquete o desconocida impide el verde, `sampleSizes` heredados del prototipo se ignoran, `integration.sh` solo borra después de la guarda de loopback y sin credenciales reales).
- 4/6 · Front y código: 3 (marcado en etiquetas llega como texto, la vista del líder pinta meta y motivo con `text:`, sin `innerHTML`/`eval`/red en el código nuevo).
- 8 · Datos personales: 1 (semilla sin correos que no sean de dominios reservados ni teléfonos).

Resultados locales: `node --test tests/security/*.test.js`: 481 pasan, 0 fallan (Node de la sesión, sin dependencias externas).

Resultados del pipeline: gitleaks · semgrep · npm audit · ZAP · pentest RLS/API: corren en `seguridad.yml` sobre la rama `item/M-06` tras el push (ver la sección "Runs" más abajo). El ítem no cambia migraciones, RLS, workflows ni dependencias: el pentest RLS/API y ZAP son regresión.

## Hallazgos

| ID | Severidad | Categoría | Ubicación | Cómo reproducir | Corrección sugerida |
|---|---|---|---|---|---|
| H-M06-01 | Media | 3/5 · Entradas, automatizaciones | `engine/rows.js` `evaluateCategoryMonth` (el `catch` devuelve `not_evaluated`); `engine/vulnerabilities.js:165-170` (`packageStatus` lanza por una fila); `measurements` sin CHECK de `category` ni de entero | Como custodio de VULN, `POST /rest/v1/measurements` con `{"unit_id":<unidad>,"indicator_id":<VULN>,"measured_on":"2027-01-31","value":0.5,"category":"P0P1","kind":"resolved","created_by":<uid>}` (o `category` nula, `"p0p1"` o `"X"`). El mes que antes daba rojo queda `not_evaluated` ("resolved[n].count debe ser un entero seguro >= 0"). `not_evaluated` reinicia la racha de rojos (`engine/escalation.js:193`), así que la unidad no se congela. El front lo bloquea (`measurements-input.js`), solo pasa por la API, y queda en `audit_measurements`. El custodio ya puede inflar cifras con el mismo efecto, así que no es escalada de privilegios, pero un error de carga por API apaga la escalada en silencio. | Que falle cerrado por fila: en `buildPackageInput`, descartar las filas con categoría fuera de `P0P1`/`P2P3` o valor no entero y contarlas en el motivo, sin anular el mes. En BD: trigger o CHECK que exija `category in ('P0P1','P2P3')` y valor entero en indicadores con categorías. Otra opción: que un `not_evaluated` causado por datos inválidos no reinicie la racha. |
| H-M06-02 | Baja | 3 · Entradas | `engine/rows.js:9-13` (`num`), `buildPackageInput` (`num(pkg.P0P1) ?? 0`) | `package_by_category = {"P0P1": [], "P2P3": 500}` (también `false`, `" "` o `[0]`): `num` lo convierte en 0, la meta de P0/P1 queda en 0 y el resultado es 100 %, verde. Sin ganancia: el custodio puede escribir `0` con el mismo resultado y queda auditado. Aun así, un jsonb malformado debería fallar cerrado. | En `num`, aceptar solo `number` o `string` que no quede vacía tras `trim`. O en BD, exigir que cada valor de `package_by_category` sea un entero >= 0 (`jsonb_typeof = 'number'`). |
| H-M06-03 | Info | 5 · CI | `scripts/ci/integration.sh:84-85` | Primer `delete` del script: usa `DB_URL` de `supabase status`, pero la guarda de loopback solo revisa `API_URL`. Hoy los dos valores vienen de la CLI local, así que no hay riesgo real. | Añadir una guarda `case "$DB_URL"` que solo acepte `127.0.0.1` o `localhost`. |

Los tres quedan en `docs/seguridad/hallazgos.md` (sección M-06) y se proponen como ítem de endurecimiento. Ninguno es Alto ni Crítico: no hay acceso a datos de otra unidad, ni escalada de rol, ni XSS, y el verde no se puede forzar con datos que el autor no podría escribir igual de forma legítima.

## Verificado sin hallazgos

- **XSS (3/4):** las claves de `thresholds_by_category` (por ejemplo `<img src=x onerror=alert(1)>`) llegan al motivo y a `categoryGoal` como texto. `src/views/unit_leader/home.js:99-101` las pinta con `el(..., { text })` (`textContent`). No hay `innerHTML` en `dashboard.js` ni en `home.js`.
- **Prototipos (3):** `__proto__` en el jsonb (como clave propia, tal como lo deja `JSON.parse` de PostgREST) no contamina `Object.prototype`. `categoryMonthColor` lee con `Object.hasOwn`, `normalizeIndicator` usa `Object.create(null)` y descarta `__proto__`, y las categorías no reconocidas quedan sin evaluar e impiden el verde. Si una medición trae `category = "__proto__"`, el `sampleSizes[...] = ... + 1` asigna una cadena a `__proto__`, el runtime la ignora, y `packageStatus` rechaza la fila después.
- **Cifras (3/5):** paquete negativo, decimal, NaN, Infinity, `1e400` o texto da `not_evaluated` o "sin paquete", nunca verde. Lo mismo con umbrales NaN, Infinity, negativos o >100. Lo resuelto de una criticidad se recorta a su paquete, así que inflar P2/P3 no tapa un rojo de P0/P1. El `value` que devuelve siempre es finito o null.
- **Autorización (1):** el ítem no toca RLS ni grants. `evaluations` sigue sin escritura para `authenticated` (regresión en `api/rls-matrix.test.js`).
- **Semilla (8):** solo UUIDs ficticios y cifras. No hay nombres, correos ni teléfonos nuevos.
- **`integration.sh` (5):** la guarda `http://127.0.0.1:*|http://localhost:*` corre antes del nuevo `delete`. Usa las claves locales de `supabase status` y las enmascara con `::add-mask::`. No hay `sb_secret_` literal ni hosts `supabase.co`.
- **Código (6):** el código nuevo del motor no tiene `eval`, `new Function`, `fetch` ni `process.env`.

## Runs

Seguridad sobre `0073b84`: https://github.com/apivasa/practica_agente/actions/runs/44674038234
- gitleaks (historial completo): verde
- semgrep (JS, secretos, Actions, SQL): verde
- npm audit (producción): verde
- CodeQL (javascript-typescript y actions): verde
- pentest API (PostgREST/Auth, Supabase local): verde
- pruebas de seguridad (`tests/security`): verde
- DAST (e2e de seguridad + ZAP baseline): en curso cuando se escribió el informe

CI sobre `0073b84` (https://github.com/apivasa/practica_agente/actions/runs/44674038192): pgTAP verde, integración verde. El build falló por un error de lint en esta misma prueba: el literal `1e400` dispara `no-loss-of-precision`. Lo corrige el commit siguiente, que lo cambia por `Infinity`, y eso no altera lo que se prueba.
