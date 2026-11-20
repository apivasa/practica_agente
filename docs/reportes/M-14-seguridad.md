# M-14 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. La migración `supabase/migrations/20261128120000_safe_cap_js_rounding_m14.sql` reemplaza los 9 CHECK `*_safe` de M-11/M-12. Conservan su nombre y pasan a un borde más estricto, |v| < 2^53 − 0,5 (`9007199254740991.5`). Cada tabla se cambia con un único `ALTER TABLE` que hace DROP + ADD. No añade funciones, grants, policies, DML ni `NOT VALID`, y no toca RLS. Cierra H-ARQ-M13-01: un valor en [2^53 − 0,5, 2^53) se guardaba en la BD, `JSON.parse` lo redondeaba a 2^53 y el motor lo rechazaba. Ahora lo que acepta la BD también lo acepta el motor.

Pruebas de seguridad añadidas o ajustadas:
- `tests/security/engine-m13.test.js` › barrera de la BD (cat. 1/6), ajustada sin perder su intención. Antes prohibía cualquier `drop constraint` de un CHECK `_safe`. Ahora, en todas las migraciones, exige que:
  - cada DROP vaya dentro de un `ALTER TABLE`, en la misma sentencia y seguido del ADD del mismo nombre;
  - no se use `drop ... if exists` ni `not valid`;
  - la última definición tenga un tope ≤ 2^53 con comparación decimal exacta (BigInt; `Number()` redondearía `9007199254740992.4`) y no use `<= 2^53`;
  - la nueva `api/safe-cap-m14` no tenga `skip` ni `todo`.
- `tests/security/db-static-m14.test.js`: 3 casos (cat. 1/3/6).
  - No hay funciones, `security definer`, grants, policies, DML, DROP de objetos, `NOT VALID`, `IF EXISTS` ni secretos.
  - Hay exactamente 4 sentencias, una por tabla, y en cada una los DROP y los ADD cubren el mismo conjunto de nombres, con el ADD después del DROP.
  - Todos los topes son `9007199254740991.5`: 7 `<` y 2 jsonpath `>=` en modo `strict`, y ningún `<=`.
- `supabase/tests/security/051_security_safe_cap_js_rounding_m14.test.sql`: 26 casos pgTAP (cat. 1/3).
  - Catálogo:
    - cada uno de los 9 CHECK existe una sola vez y está validado (`9/9/9`): el reemplazo no dejó duplicados ni huecos;
    - ningún CHECK de `public` conserva el borde viejo;
    - todo `_safe` usa el borde nuevo.
  - Bajo RLS, gestora:
    - rechazos: 2^53 − 0,5 en decimal y exponencial, 2^53 − 0,25, el negativo simétrico, `jsonb_set` y `||` en los umbrales por categoría, y la meta por UPDATE y por INSERT (`…991.50000000001`);
    - control positivo: 2^53 − 0,6 se acepta y se guarda exacto.
  - Bajo RLS, custodio:
    - rechazos: `package_total`, `jsonb_set` y `||` en `package_by_category`, los overrides (incluido el negativo), el UPDATE calculado (2^53 − 1) + 0,5 y un INSERT con espacios y exponencial;
    - control positivo: (2^53 − 1) + 0,4 se acepta.
  - Líder y comité: 0 filas aunque el valor sea válido.
  - Comprobación final: los valores quedan intactos y no se crean filas.
- `tests/security/api/safe-cap-m14.test.js`: 6 casos por PostgREST con JWT por rol (cat. 1/3).
  - PATCH en el borde en las 6 columnas escalares, con 9 variantes: decimal, `.9999`, exponencial `e15`/`E+15`, cadena, cadena con espacios, 20 decimales y negativos. Respuesta esperada: 400/23514, con la fila intacta.
  - `thresholds_by_category` en el borde (gestora).
  - `package_by_category` y POST de `measurements` en el borde (custodio).
  - PATCH de líder1, líder3, comité y anónimo: 0 filas o 401/403, con la fila intacta.
  - Control positivo: la API devuelve `9007199254740991.4`, `JSON.parse` lo lee como `Number.MAX_SAFE_INTEGER` e `isSafeMagnitude` lo acepta (BD == motor).
  - Barrido de lecturas de `indicators`, `targets`, `commitments` y `measurements` con 3 roles: ningún número queda fuera de `isSafeMagnitude`.
- Ajustes sin debilitar (cat. 1/3):
  - `supabase/tests/security/049` #3: el barrido de columnas numeric escribibles por la API exige ahora el borde `< 9007199254740991.5`, más estricto que 2^53. Una columna nueva con el tope viejo hace fallar la prueba.
  - `049` #30 y `050` #34: la comprobación de la semilla usa el borde nuevo.
  - `050` #3: `measurements.value` con `abs(value) < 9007199254740991.5`.
  - `050` #27: `9007199254740991.9999` lo rechaza ahora `commitments_package_by_category_safe`. Los CHECK se evalúan en orden alfabético y `_safe` va antes que `_whole`. Sigue siendo 23514 con el nombre exacto.
- `docs/seguridad/modelo-amenazas.md`: sección «Superficie nueva (M-14)» con T-M14-01 y T-M14-02.
- `docs/seguridad/hallazgos.md`: sección M-14, sin hallazgos nuevos.

Verificación activa de lo pedido:
- **Ventana sin CHECK (atomicidad):** no la hay. Cada tabla se modifica en una sola sentencia `ALTER TABLE` con todos los subcomandos DROP/ADD. PostgreSQL la ejecuta con `ACCESS EXCLUSIVE` como una unidad, así que ninguna otra transacción ve la tabla sin restricción. Si el ADD falla al validar filas existentes, no se aplica nada. Lo comprueban `db-static-m14` (una sentencia por tabla) y `engine-m13` (regla general para cualquier migración futura). En el catálogo, `051` #1 confirma que cada CHECK existe una vez y validado tras aplicar todas las migraciones.
- **NOT VALID:** no se usa. Lo comprueban `db-static-m14`, `engine-m13`, `051` #1 (`convalidated`) y `114` del desarrollador.
- **Bordes por PostgREST con JWT por rol:** cubiertos por `api/safe-cap-m14`, que en CI pasó sus 6 casos sin omisiones.
- **Secretos:** gitleaks del historial completo en verde; `db-static-m14` y `static-secrets` sin hallazgos.

Resultados del pipeline (commit b7680ab, que incluye 5351818 con las pruebas):
- Seguridad, run 44734387132, success: https://github.com/apivasa/practica_agente/actions/runs/44734387132
  - gitleaks (historial completo) · semgrep (JS, secretos, Actions, SQL) · CodeQL (actions, javascript-typescript) · npm audit (producción) · DAST (e2e de seguridad + ZAP baseline) · pentest API (PostgREST/Auth, Supabase local): todos success.
  - En e040997 el pentest API dio 559/559, 0 skipped, incluida `pentest-api: M-14`: https://github.com/apivasa/practica_agente/actions/runs/44732163134
  - S-05 fase A y fase B quedan skipped por diseño: solo corren para S-05.
- CI, run 44734387145, success: https://github.com/apivasa/practica_agente/actions/runs/44734387145
  - db (pgTAP): `049`, `050`, `051`, `114` y `115` en ok.
- Run intermedio 44733262831 (CI, failure en 4a26d54): mi fixture de `051` usaba `thresholds_by_category = null` y la columna es NOT NULL. Se corrigió a `'{}'` en 5351818. No era un fallo de la app.

Hallazgos: ninguno nuevo.
- H-M12-01 (Info, escala de `1e-16000`) sigue registrado sin cambios: M-14 no lo afecta.
- Nota de cierre de H-ARQ-M13-01: el trigger de M-09 (entero y ≤ 2^53 − 1) y `commitments_package_by_category_whole` (entero ≥ 0) ya eran coherentes con el borde nuevo. El entero máximo admitido, 2^53 − 1, es exacto en double.

Verificado sin hallazgos: 1 (RLS y autorización por rol sobre las columnas tocadas; catálogo de CHECK), 3 (entradas en el borde: decimal, exponencial, cadena, negativos, JSONB parcial, UPDATE calculado), 6 (gitleaks, semgrep, CodeQL, npm audit) y 7 (ZAP baseline). Las categorías 2, 4, 5 y 8 no las toca el ítem y su regresión pasó en el pipeline.
