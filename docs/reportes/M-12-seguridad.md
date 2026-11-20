# M-12 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. La migración `supabase/migrations/20261127120000_json_shape_safe_m12.sql` añade tres CHECK aditivos (`indicators_thresholds_by_category_safe`, `measurements_value_safe`, `commitments_package_by_category_whole`). Usan jsonpath y `abs`, no funciones propias. No hay grants, RPC ni políticas nuevas, y el esquema `public` sigue sin funciones (comprobado en el catálogo). Cierra H-M11-01, H-M11-02 y H-M11-03 (T-M11-03 y T-M11-04 del modelo de amenazas).

Pruebas de seguridad añadidas:
- `supabase/tests/security/050_security_json_shape_m12.test.sql`: 34 casos. Categoría 1: 6 casos (catálogo: los CHECK están validados y no dependen de funciones; tope en `measurements.value`; el líder no escribe y nada cambia). Categoría 3: 28 casos, todos bajo RLS con la gestora o el custodio:
  - `jsonb_set`, `jsonb_insert`, `||` y `#-` sobre umbrales: cambiar un valor a 1e400, añadir una clave, quitar `yellow`, reemplazar por un objeto incompleto, cadena, arreglo;
  - upsert por `code`;
  - `0.9007199254740992E+16`;
  - claves `Green` y `green `;
  - `null`;
  - clave duplicada con 1e400 al final (se rechaza) y al principio (se acepta, porque se guarda el último valor);
  - ±(2^53−1);
  - `measurements.value` con exponencial, `"  1E400  "`, `x+1` y `x*1e300` en un KPI sin categorías, y `-0`;
  - paquete: `jsonb_set` a 0.5, `||` con −1, `1e-16000`, `9007199254740991.9999`, upsert por (unidad, indicador, periodo), claves libres (`Crítica`, `total`) con `1.0`, `1e2` y `-0`;
  - ninguna fila guardada, incluida la semilla, incumple los CHECK.
- `tests/security/api/json-shape-m12.test.js`: 7 casos de las categorías 1 y 3 por PostgREST con el JWT de cada rol y cuerpos crudos. Cubre:
  - 19 formas o valores inseguros en `thresholds_by_category` más un upsert `on_conflict=code`;
  - 6 literales o cadenas ≥ 2^53 en `measurements.value`, con control positivo 2^53−1;
  - 6 paquetes no enteros o negativos;
  - controles positivos de la gestora y del custodio;
  - el líder recibe 0 filas;
  - ninguna lectura de la gestora ni de los custodios contiene números inseguros.
- `supabase/tests/security/049_security_numeric_safe_cap_m11.test.sql`: cabecera actualizada. El barrido de columnas numeric ya no tiene excepción: la quitó el desarrollador y yo la verifiqué.
- `docs/seguridad/modelo-amenazas.md` (T-M12-01, T-M12-02) y `docs/seguridad/hallazgos.md`: H-M11-01..03 cerrados y H-M12-01 registrado.

Resultados del pipeline (commit b8ef30f, que contiene las pruebas de 12899e2):
- Seguridad, run 44723154848: https://github.com/apivasa/practica_agente/actions/runs/44723154848. Todos los jobs en success: gitleaks (historial completo), semgrep (JS, secretos, Actions, SQL), CodeQL (actions, javascript-typescript), npm audit (producción), DAST (e2e de seguridad y ZAP baseline), pruebas de seguridad (`tests/security`) y pentest API (Supabase local). El pentest API dio 553 pass, 0 fail y 0 skip; la suite M-12 pasó 7/7. Las fases A y B de S-05 se omiten porque no corresponden a este ítem.
- CI, run 44723154888: https://github.com/apivasa/practica_agente/actions/runs/44723154888. El job db (pgTAP) pasó con 35 archivos y 873 pruebas, incluidas `security/049` y `security/050`. Las pruebas 091 y 111 del tester ya están corregidas en esa rama.
- Además, en local: PostgreSQL 16 con un stub de `auth` y todas las migraciones aplicadas. Allí se probaron unos 80 payloads con el rol `authenticated` y los claims de gestora, custodio y líder, y 050, 049, 048 y 112 pasan con un stub de pgTAP.

Hallazgos:
- H-M12-01 · Info · 3 Entradas · `measurements.value` e `indicators.thresholds_by_category` (y las columnas numeric de M-11).
  - Qué pasa: los CHECK limitan la magnitud pero no la escala.
  - Cómo reproducir: el custodio hace `POST /rest/v1/measurements` con `"value":1e-16000`, o la gestora guarda `{"P0P1":{"green":-0,"yellow":1e-16000}}`. Las dos escrituras se aceptan (comprobado en PG 16 bajo RLS).
  - Efecto: PostgREST devuelve un literal de unos 16 KB que `JSON.parse` convierte en 0. No altera colores ni cálculos; solo infla las respuestas del propio KPI o de los umbrales.
  - Alcance: solo los roles que ya escriben esa columna, y queda en auditoría.
  - Corrección sugerida (opcional): limitar la escala, por ejemplo `scale(value) <= 6`, o redondear.
  - Registrado en `docs/seguridad/hallazgos.md`, sin ítem.
- Observación sin hallazgo: varias categorías de 2^53−1 suman más de 2^53, así que `packageTotal` en el motor pierde precisión. Aun así el resultado es finito, porque para llegar a Infinity harían falta unas 10^292 claves. Además, el CHECK de `package_total` rechaza ese total si el front lo escribe. La incoherencia entre `package_total` y la suma por categorías solo afecta al KPI del propio custodio.

Verificado sin hallazgos:
- Categoría 1 (Autorización y RLS): las restricciones se aplican sobre la fila resultante, así que las escrituras parciales del JSONB y los upserts no las saltan. El líder no puede escribir.
- Categoría 3 (Inyección y entradas): rechaza tipos raros (cadena, null, booleano, arreglo, objeto), claves extra o con otras mayúsculas, claves que faltan, notación exponencial, ±2^53, NaN e ±Infinity, fracciones y negativos en el paquete. Un JSONB que no es objeto da 23514 y no un error de jsonpath. Con claves duplicadas se guarda el último valor. `-0` y `1.0` se aceptan como legítimos.
- Categoría 6 (Cadena de suministro): sin dependencias nuevas, gitleaks y semgrep en verde y sin secretos en el diff.
- Categorías 2, 4, 5, 7 y 8: el ítem no las toca y la regresión completa pasó en verde.
