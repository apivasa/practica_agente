# M-02 + M-03 + M-04 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no

Superficie nueva:
- **M-02, gestora:** alta y edición de `indicators`, activar o desactivar, y asignación de custodio. La asignación escribe `user_roles` (borra e inserta filas `custodian`) y `indicators.custodian_user_id` desde el front, en tres peticiones sin transacción (`src/data/indicators.js` › `assignCustodian`, `src/data/roles.js`).
- **M-03, custodio:** INSERT y UPDATE de `commitments` con umbral negociado y paquete por categoría (`src/data/commitments.js`).
- **M-04, custodio:** captura manual e importación CSV de `measurements` (hasta 1 MB y 5000 filas), validadas en `engine/measurements-input.js` y guardadas con un solo INSERT.
- **Router:** registro declarativo de rutas con subrutas por rol, y `el()` endurecido (`src/views/dom.js`).
- **Semilla:** tres usuarios ficticios nuevos (`custodio3`, `multirol` gestora+custodio, `sinrol`) y dos indicadores inactivos (CHG, LAT).

Pruebas de seguridad añadidas:
- `tests/security/front-m02-m04.test.js`: 43 casos, todos pasan en local.
  - Cat. 1 (13):
    - El plan de asignación solo toca filas `custodian` del indicador pedido.
    - Quitar el custodio no concede nada.
    - Si se corta en cualquier paso, los custodios que quedan son un subconjunto de los de antes más el elegido. Desde el primer paso solo queda el elegido.
    - Una carrera entre dos pestañas se detecta como incoherencia.
    - El orden en el código es borrar, conceder y luego la columna.
    - El borrado está acotado a `role=custodian`.
    - `src/data/**` no usa `rpc`, `upsert` ni claves privilegiadas. Solo `roles.js` borra. Nunca fija `created_by`, `created_at` ni `source: automatic`, y los errores no exponen el mensaje crudo de PostgREST.
    - Las subrutas nuevas exigen el rol.
  - Cat. 3 (20):
    - Fórmulas (`= + - @`, tabulador, CR, HYPERLINK, DDE) en cada columna de los tres tipos. También entre comillas y con espacios o NBSP delante.
    - Tipos inválidos: NaN, Infinity, `1e3`, hex, negativos, enteros enormes.
    - Fechas irreales, futuras o anteriores a 2000, y SQL en la fecha.
    - Filas que apuntan a otra unidad o a una inexistente. El lote es todo o nada.
    - `app_id` con marcado.
    - Categorías y `tipo` (`constructor`, `__proto__`).
    - Cabeceras hostiles: `__proto__`, `constructor`, `source`, `unit_id`, columnas repetidas.
    - Ninguna fila inyecta columnas de la BD.
    - Tamaño mayor de 1 MB (contado en bytes UTF-8) y más de 5000 filas.
    - Archivos patológicos: una celda de 900 KB, 900 000 separadores. Ninguno pasa de 5 s.
    - BOM, UTF-16, nulos, U+FFFD, separador `;` y comillas mal formadas.
    - Formularios de indicador y compromiso: código, categorías, límites y `__proto__` en `thresholds_by_category`.
  - Cat. 4 (6): payloads XSS en `table()`, `select()`, `messages()` y `field()` llegan solo como texto. `el()` rechaza `on*` de texto, `javascript:` y nombres de atributo inyectados. Las cinco vistas no usan sumideros HTML, `srcdoc`, `srcset`, etiquetas peligrosas ni `href` con datos.
  - Cat. 8 (4): correos `@example.test` y nombres "(ficticio/a)". Sin teléfonos, cédulas ni claves. CHG y LAT están inactivos. `sinrol` no tiene filas en `user_roles`.
- `tests/security/api/m02-m04.test.js`: 21 casos de cat. 1 contra PostgREST real. Se omiten en local y corren en `seguridad.yml` › pentest-api con `PENTEST_REQUIRE=1`.
  - `sinrol` no lee ninguna de las 10 tablas, no se da rol y no inserta mediciones ni compromisos.
  - Custodio1 no se asigna otro KPI ni borra el rol de otro custodio.
  - Custodio2 no cambia `custodian_user_id`.
  - Custodio3 no reactiva su KPI inactivo.
  - `multirol` solo escribe mediciones de LAT: ser gestora no le da escritura en mediciones de VULN. Tampoco puede fijar `source=automatic` ni un `created_by` ajeno.
  - Custodio3 no lee ni escribe datos de KPI ajenos.
- Local: `node --test 'tests/security/*.test.js'` da 411 casos y los 411 pasan. Los casos de API nuevos no se han ejecutado todavía; correrán en el próximo run de `pentest-api` cuando se suba la rama.
- **Pendiente para después:** las 5 pruebas `test.fixme` de fórmulas CSV de S-04 no se activan, porque S-04 aún no está en `main`. Hay que activarlas cuando S-04 se fusione con esta rama.

Resultados del pipeline (run de `e31beb2`, el commit revisado, sin estas pruebas nuevas):
- [Seguridad 44614923967](https://github.com/apivasa/practica_agente/actions/runs/44614923967): success en gitleaks (historial), semgrep, npm audit (producción), CodeQL (JS y Actions), tests/security y pentest API.
- [CI 44614924089](https://github.com/apivasa/practica_agente/actions/runs/44614924089): success.
- ZAP no aplica todavía: llega con S-04 y S-05.

Revisión manual:
- **Asignación no atómica.** RLS (`user_roles_insert/update/delete`: solo `kpi_manager`) impide que un rol que no es la gestora la haga. Ya lo cubre `api/rls-matrix.test.js` para los 7 roles más anónimo, y ahora también `sinrol`.
  - Ante un fallo a medias, el estado nunca tiene más permisos que antes más el elegido. Solo el orden borrar → conceder pasa por un estado sin custodio.
  - `custodian_user_id` es informativo: ninguna política ni función SQL lo usa para autorizar (`is_custodian_of` lee `user_roles`).
  - Manipular el `select` para mandar otro `user_id` solo lo puede hacer la gestora, que ya tiene ese permiso.
- **CSV.** `get()` hace `trim()` (incluye NBSP y tabuladores) antes de `FORMULA_RE`, así que un prefijo de espacios no lo evita. Los campos cerrados (fecha, valor, unidad, `cumple`, `tipo`, `app_id` y categoría con lista) tienen regex o lista blanca. El único texto libre es la categoría sin lista (H-M04-01). El parser usa `Object.create(null)` y una cabecera con lista blanca, así que no hay contaminación de prototipo.
- **XSS.** Todo dato de la BD o del archivo se pinta con `textContent` o `createTextNode`. H-F05-02 queda **corregido**. El residual está en H-M02-02 (Info).
- **Semilla.** Es ficticia y usa la contraseña local de siempre. CHG y LAT están inactivos y no alteran la evaluación programada.

Hallazgos (detalle en `docs/seguridad/hallazgos.md`):
- **H-M02-01 · Baja · 1 · `src/data/indicators.js:48-60`.** La asignación de custodio no es transaccional. Con dos pestañas de la gestora que asignan a la vez desde la misma lista quedan dos custodios con escritura.
  - Reproducción: abrir dos pestañas en `#/gestora/indicadores`, asignar A en una y B en la otra sin recargar. `user_roles` queda con A y B.
  - Mitigado: solo la gestora puede hacerlo y la pantalla lo marca como incoherente.
  - Corrección: función SQL transaccional `security invoker` con `search_path=''`, o un índice único parcial por indicador si ADR 0005 confirma un solo custodio.
- **H-M04-01 · Baja · 3 · `engine/measurements-input.js:225-228`.** La categoría libre admite controles, ancho cero (`​=1`) y marcado.
  - Hoy es inocuo: se muestra como texto y no hay exportación.
  - Corrección: regex de categorías del indicador, y neutralizar celdas en cualquier exportación futura.
- **H-M02-02 · Info · 4 · `src/views/dom.js:6`.** `URL_ATTRS` no cubre `srcdoc`, `srcset`, `poster`, `data` ni `ping`, y `isSafeUrl` acepta `//host`. Hoy no se usa con datos. Corrección: lista de permitidos y CSP (S-04).
- **H-M04-02 · Info · 1/8 · `measurements_insert`.** La API acepta mediciones futuras o de KPI inactivos. La validación de fecha futura solo existe en el front. Corrección: `check` en BD o filtro en la evaluación.

Verificado sin hallazgos:
- Cat. 1: escalada en `user_roles` e `indicators`, IDOR en mediciones y compromisos, multirol, sin rol.
- Cat. 2: rutas nuevas sin sesión van a login.
- Cat. 3: fórmulas, tipos, tamaños, codificaciones, otra unidad, cabeceras.
- Cat. 4: XSS almacenado y reflejado en las tres pantallas; sin secretos en `src/`.
- Cat. 8: semilla ficticia. Los cambios de `user_roles`, `indicators`, `commitments` y `measurements` quedan en `audit_log` por los triggers existentes.
- Las categorías 5, 6 y 7 no tienen cambios en este ítem.
