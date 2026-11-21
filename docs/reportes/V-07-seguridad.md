# V-07 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: importación de mediciones desde Excel `.xlsx` en `#/custodio/mediciones`, sin dependencias. Hay un lector ZIP propio (`engine/zip.js`), una descompresión `deflate-raw` con `DecompressionStream` y tope (`src/lib/inflate.js`), un lector XML propio (`engine/xml.js`) y la lectura de la primera hoja (`engine/xlsx.js`, con relaciones, sharedStrings, tipos de celda y fechas de serie), que entrega los datos a las mismas validaciones del CSV (`validateMeasurementRecords`). La plantilla `.xlsx` se genera en el navegador y se descarga por un `blob:` propio. No hay cambios de BD, de RLS ni de workflows. Modelo de amenazas: T-V07-01..07 en `docs/seguridad/modelo-amenazas.md`.

Pruebas de seguridad añadidas:
- `tests/security/xlsx-import-v07.test.js` (node:test, 114 casos, todos con archivos hostiles fabricados en la prueba con un armador de ZIP propio que permite mentir en cada campo; `fetch` interceptado: cualquier petición de red es un fallo):
  - Cat. 3, zip bombs (5 casos):
    - 100 MiB reales declarados como 2 KB dentro de un archivo de menos de 1 MB;
    - `inflateRaw` corta 64 MiB con un tope de 1 MiB;
    - una parte de más de 8 MiB declarada se rechaza antes de descomprimir;
    - el tope total de 20 MiB se aplica entre partes;
    - una bomba no recursiva con 995 entradas superpuestas sobre los mismos datos: como mucho 5 partes descomprimidas y 20 MiB o menos.
  - Cat. 3, XML denso de 8 MiB (1 caso): se responde en tiempo acotado.
  - Cat. 3, ZIP manipulado (21 casos): ZIP64 por tres vías, cifrado, AES y bzip2, varios discos, más de 1000 entradas, directorio central, cabecera local y datos fuera de rango, CRC, tamaño declarado menor que el real, deflate basura, partes repetidas, OLE `.xls`, truncados, más de 1 MB y bytes que no son ZIP.
  - Cat. 3, descompresor que no respeta el tope (1 caso): `readZipEntry` no confía en él; si devuelve más de 8 MiB o algo que no son bytes, la entrada se rechaza.
  - Cat. 3, fuzzing (1 caso): 600 mutaciones deterministas; nunca lanza, nunca deja filas y errores a la vez y nunca devuelve una unidad ajena.
  - Cat. 3, XML hostil:
    - DOCTYPE/ENTITY en la hoja (9 casos): billion laughs, XXE a `file:` y a 169.254.169.254, entidad de parámetro, DTD externo, `doctype` en minúsculas, `<!ENTITY>` interno, entidad no declarada y XInclude;
    - billion laughs y XXE en `_rels/.rels`, el workbook, sus relaciones y sharedStrings (4 casos);
    - 100 000 niveles de anidamiento (1 caso);
    - rendimiento y ReDoS con entradas de 4 MiB (11 casos);
    - `__proto__` y `constructor` en atributos, en el `Id` de una relación y como nombre de unidad (2 casos);
    - referencias numéricas inválidas (1 caso).
  - Cat. 3, rutas (11 casos): `..`, rutas absolutas, `TargetMode="External"` hacia http y `file:`, rutas UNC y backslashes, chartsheet, sharedStrings externo o fuera del paquete, officeDocument externo y una hoja que apunta a los propios `.rels`.
  - Cat. 3, fórmulas e inyección CSV/DDE (35 casos):
    - 8 textos con fórmula en las columnas `unidad`, `valor`, `app_id` y `categoria`;
    - las 10 vías de texto del `.xlsx`: compartido, rich text, `str`, CDATA, `&#61;`, `&#x40;`, `_x003D_`, `_x0009_`, `t="d"` y número negativo;
    - `<f>` con valor cacheado válido y fórmula compartida;
    - errores de Excel recortados.
  - Cat. 3, otros (2 casos): tamaños de hoja (más de 5000 filas, fila 1048577, filas y columnas fuera de orden, más de 50 columnas, índice compartido inexistente, tipo de celda desconocido) y bytes no UTF-8.
  - Cat. 3/4, XSS (2 casos): payloads en celdas y cabecera vuelven como texto. Una prueba estática comprueba que la vista no usa `innerHTML` y que el lector no usa DOM, `fetch`, `eval` ni `import()`.
  - Cat. 1 (3 casos):
    - una unidad fuera de `ctx.units` (por nombre, uuid, NUL o NBSP) se rechaza;
    - las columnas `indicator_id`, `unit_id`, `id` y `created_by` no se reconocen;
    - las filas tienen la misma forma que las del CSV;
    - la vista tiene una sola vía de escritura: `insertMeasurements(ind.id, pending)`, con el indicador seleccionado y RLS del custodio.
  - Cat. 4, plantilla (2 casos): se genera escapada, sin `<f>`, sin relaciones externas, sin VBA ni OLE; el `blob:` se crea y se revoca en la vista; la CSP no se relaja (`src/security/csp.js` sin `blob:` ni `unsafe-`).
  - Cat. 6 (1 caso): no hay dependencias nuevas; solo imports relativos.
  - Control (1 caso): el libro base se importa.
- `e2e/security/xlsx-import-v07.spec.js` (Playwright en Chromium real con Supabase local, 7 casos, cat. 3/4):
  - 6 archivos hostiles: fórmula en texto, `<f>` con valor cacheado, XSS en unidad, XSS en cabecera, DOCTYPE/XXE y zip bomb de 96 MiB declarada como 2 KB. Para cada uno se comprueba:
    - el error se muestra como texto;
    - el botón de guardar sigue inactivo aunque se fuerce el clic;
    - no hay escrituras a `/rest/v1/measurements` ni peticiones a hosts de prueba hostiles;
    - no hay diálogos, violaciones de CSP ni nodos inyectados;
    - la pestaña sigue respondiendo.
  - Descarga de la plantilla por `blob:` del propio origen, sin violaciones de CSP. El `.xlsx` se lee con la cabecera esperada.

Resultados del pipeline (rama `item/V-07`, SHA 78a96a7, que incluye las pruebas de d9a8555):
- Seguridad, [run 44856834567](https://github.com/apivasa/practica_agente/actions/runs/44856834567): success.
  - gitleaks (historial completo): ok.
  - semgrep (JS, secretos, Actions, SQL): ok.
  - CodeQL (javascript-typescript y actions): ok.
  - npm audit (producción): ok.
  - Pruebas de seguridad (`tests/security`): 772 pasan, 0 fallan, 0 omitidas.
  - Pentest API (PostgREST/Auth, Supabase local): ok.
  - DAST (e2e de seguridad + ZAP baseline): ok. Las 42 pruebas e2e pasan, incluidas las 7 de V-07.
  - S-05 fase A y fase B: omitidas por diseño (solo a demanda).
- CI, [run 44856834647](https://github.com/apivasa/practica_agente/actions/runs/44856834647): success.
- La regresión previa `e2e/security/csv-injection.spec.js` sigue verde con el nuevo rótulo «Importar CSV o Excel».

Hallazgos (registrados en `docs/seguridad/hallazgos.md`; ninguno bloquea):
- H-V07-01 · Info · 3 · `engine/zip.js:126`:
  - Qué pasa: `readZipEntry` pasa al descompresor el tope `min(8 MiB, presupuesto)` y no el tamaño declarado de la entrada. Una zip bomb que declara 2 KB se descomprime hasta 8 MiB antes del rechazo.
  - Alcance: acotado. Medido con 100 MiB reales: corta en el tope en menos de 1 s.
  - Cómo reproducir: `xlsx-import-v07.test.js` › «zip bomb con tamaño declarado FALSO».
  - Corrección sugerida: `inflate(data, Math.min(maxBytes, entry.size))`.
- H-V07-02 · Info · 3 · `engine/xml.js` / `engine/xlsx.js`:
  - Qué pasa: una parte de unos 7 MiB con 399 000 elementos se acepta y cuesta unos 0,65 s y 176 MiB de heap. Medido en Node 22 con `parseXml` sobre `'<b c="1" d="2">x</b>'` × 399 000.
  - Alcance: solo afecta a la pestaña de quien sube el archivo, que se lo inflige a sí mismo. No afecta a otros usuarios ni a la BD.
  - Corrección sugerida (opcional): leer `sheetData` fila a fila, o cortar al pasar de `CSV_MAX_ROWS` + 1 filas durante el análisis.
- Observación sin hallazgo:
  - El lector no compara el nombre de la cabecera local con el del directorio central y no rechaza entradas superpuestas.
  - No tiene impacto: nada se escribe en disco y solo se abren 5 partes con presupuesto total, como prueba el caso de la bomba no recursiva.
  - La unidad también se resuelve por id, pero solo contra `ctx.units`, como ya hacía el CSV de M-04. El permiso real lo da la RLS del indicador.

Verificado sin hallazgos:
- 1 · Autorización y RLS: no hay vía nueva de escritura. Mismo `insertMeasurements` con el indicador seleccionado, mismas filas validadas, sin columnas de id libres. La RLS del custodio sigue cubierta por `api/rls-matrix.test.js` e `idor-escalation.test.js`, verdes en el pentest API.
- 3 · Inyección y entradas: zip bombs, ZIP manipulado, XML (DOCTYPE/ENTITY, XXE, anidamiento, ReDoS, `__proto__`), rutas de relaciones, fórmulas e inyección CSV/DDE por todas las vías de texto, XSS en mensajes.
- 4 · Front: sin `innerHTML`; la plantilla va por un `blob:` propio sin relajar la CSP (ADR 0011) y sin violaciones de CSP en Chromium.
- 6 · Cadena de suministro: sin dependencias nuevas; gitleaks, semgrep, CodeQL y npm audit en verde.
- 7 · DAST: ZAP baseline en verde.
- No aplican a V-07 (sin cambios): 2 · Autenticación y sesión, 5 · GitHub Actions y 8 · Datos personales y auditoría. Sus regresiones siguen verdes en el pipeline.
