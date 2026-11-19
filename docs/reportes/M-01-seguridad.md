# M-01 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: motor de color `engine/` (funciones puras ESM, sin red ni dependencias). Recibirá datos no confiables: configuración de indicadores, mediciones de custodios (CSV/formularios), `asOf`, `target`, `category`. Sus salidas `color` y `reason` se mostrarán en el front y alimentarán los candados de las Actions.

Pruebas de seguridad añadidas:
- `tests/security/engine-m01.test.js` — 25 casos (node:test), todos en verde con `node --test 'tests/security/*.test.js'`.
  - Categoría 3 (inyección y entradas): 21 — prototype pollution (`__proto__`, `constructor`, `prototype`, categorías heredadas, `appId` reservado), copias defensivas, NaN/Infinity/strings/BigInt en umbrales, valores, `target`, `windowDays`, `minSample`, `compliant` estricto, fechas malformadas (30 feb, hora, espacios, dígitos Unicode, años < 100, signos), `asOf` inválido sin reflejar el payload, elementos basura en el arreglo, complejidad con 200 000 mediciones, `windowDays` enorme, 20 000 categorías, salida acotada a 4 colores.
  - Categoría 6 (código): 4 — sin `eval`/`Function`/RegExp dinámica/import dinámico, motor puro (sin red, `process`, `node:`, DOM; solo imports relativos), sin secretos, regex de fechas sin ReDoS.
  - Categorías 1, 2, 4, 5, 7, 8: no aplican a este ítem (no hay BD, Auth, front, workflows ni datos).
- `tests/security/package.json` (`{"type":"module"}`).
- `docs/seguridad/modelo-amenazas.md` (borrador inicial), `docs/seguridad/hallazgos.md`.

Resultados del pipeline: `seguridad.yml` aún no existe (se crea en S-01); gitleaks, semgrep, npm audit y ZAP no se ejecutaron. Revisión manual: `git diff main...HEAD` sin secretos (búsqueda de `sb_secret_`, `sb_publishable_`, `service_role`, JWT `eyJ`, claves privadas, `password`, `token`: 0 coincidencias). Sin dependencias nuevas (no hay `package.json` raíz modificado). Pentest RLS/API: no aplica.

Hallazgos:
- H-M01-01 · Baja · 3 · `engine/color.js:19,27` · `sampleSize` sin validar: `evaluateColor({measurementType:'window_average',direction:'higher_is_better',thresholds:{green:90,yellow:80},minSample:3},{value:10,sampleSize:NaN})` devuelve `red` en vez de `not_evaluated` (igual con `'x'`). · Validar entero ≥ 0 o tratar inválido como `not_evaluated`.
- H-M01-02 · Baja · 3 · `engine/measure.js:83,111` · Sin límites de rango: dos mediciones de `1e308` dan `value: Infinity` y `evaluateColor` lanza (DoS lógico de un indicador por un custodio); negativos aceptados (`cumulative_target` con `-500`/`target:10` → `-5000`). · CHECK de rango en BD y validación en CSV; Actions capturan el error por indicador y lo auditan.
- H-M01-03 · Baja · 3 · `engine/indicator.js:124-127` · Categoría `__proto__` vía `JSON.parse` valida pero se descarta en silencio (cambia el prototipo del objeto local; sin contaminación global, verificado). · `Object.create(null)`/`Map` o rechazar claves reservadas.
- H-M01-04 · Informativo · 3 · `engine/color.js:37`, `engine/indicator.js:94` · `reason` y errores reflejan el nombre de categoría sin escapar. · El front debe usar `textContent`; prueba XSS cuando haya UI.

Observación (no de seguridad del motor): con `cumulative_target` sin `target` o `target: 0` el valor es 100 (verde). Es comportamiento documentado; las Actions deben pasar siempre el `target` de la meta para no producir verdes por omisión.

Verificado sin hallazgos: prototype pollution global, ejecución dinámica de código, ReDoS, complejidad (O(n)), validación de números no finitos, validación de fechas, fuga de datos en errores de `asOf`, secretos en el diff, pureza del motor (sin red ni E/S).
