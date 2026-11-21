# ADR 0018 — Importación de mediciones desde Excel (.xlsx) con parser propio

Estado: Aceptado (decisión técnica, 2026-11-20, ítem V-07; amplía ADR 0010 punto 5; no contradice el diseño ni ADR 0009/0011)

Numeración: se usa 0018 porque C-05 está en curso en paralelo y su revisión de arquitectura puede ocupar el 0017.

## Contexto
Q-02 (2026-11-20, `docs/diseno.md` §7) fija que las mediciones llegan por ahora en un archivo de Excel. M-04 ya importa CSV con validación en `engine/measurements-input.js` (ADR 0010 punto 5). Para leer un .xlsx en el navegador había dos caminos: una librería (SheetJS, exceljs), que es una dependencia de front nueva (ADR 0009 punto 1 exige un ADR) y un historial de CVE en el parseo de archivos que no son de confianza, o un lector propio del subconjunto de OOXML que hace falta: ZIP, XML y la primera hoja.

## Decisión
1. **Parser propio, sin dependencias.** `engine/zip.js` (directorio central, CRC-32, ZIP almacenado), `engine/xml.js` (árbol mínimo) y `engine/xlsx.js` (libro, relaciones, textos compartidos, primera hoja, plantilla). Son funciones puras en `engine/`, sin DOM ni APIs de Node. Así las puede usar una Action en el futuro sin duplicarlas.
2. **Descompresión inyectada.** El motor recibe `inflate(data, maxBytes) => Promise<Uint8Array>`. En el front, `src/lib/inflate.js` usa `DecompressionStream('deflate-raw')`, una API nativa y sin red. Corta la lectura apenas la salida supera el tope. En Node, una Action podría pasar `zlib.inflateRawSync` con `maxOutputLength`. Requiere Chrome/Edge 103, Firefox 113 o Safari 16.4. Si el navegador no tiene la API, el mensaje pide usar CSV, que sigue disponible.
3. **Una sola validación.** CSV y Excel terminan en `validateMeasurementRecords(records, indicator, ctx)`: mismas columnas (`CSV_COLUMNS`), límites (1 MiB, 5000 filas), mensajes y regla de "todas o ninguna". El lector de Excel solo convierte celdas a texto. No repite reglas de negocio.
4. **Alcance acotado del formato.** Lee solo la primera hoja (orden de `<sheets>`). Rechaza fórmulas y errores de Excel indicando fila y columna. También rechaza .xls (OLE) y .xlsx cifrados (el contenedor es OLE), además de ZIP cifrado, ZIP64 y nombres repetidos.
5. **Fechas sin `styles.xml`.** En la columna `fecha`, un número se toma siempre como serie de Excel (sistemas 1900 y 1904 según `workbookPr/@date1904`). Se descarta la hora y no se aplica desplazamiento de zona. Fuera de `fecha`, un número es un número. Se acepta el riesgo de que una fecha escrita como número suelto (p. ej. `20261120`) dé una fecha fuera de rango. Ese caso lo rechaza la validación común (fecha futura o con formato inválido), así que no entra un dato erróneo en silencio.
6. **Topes defensivos (zip bomb, XML).** Máximo 1000 entradas, 8 MiB descomprimidos por parte y 20 MiB en total (se comprueba contra el tamaño declarado y contra el real). Sin `DOCTYPE`/`ENTITY`, solo entidades predefinidas y numéricas, hasta 400 000 elementos y 64 niveles.
7. **Plantilla generada en el motor.** `buildXlsxTemplate(columns)` arma un ZIP sin compresión con la cabecera del tipo de medición. La vista la descarga como `blob:` local y no necesita archivos estáticos nuevos.

## Coherencia con otros ADR
- **ADR 0009:** no agrega dependencias de front. `src/lib/inflate.js` es lógica sin DOM ni red y tiene pruebas con `node:test`. La vista no llama a Supabase directamente y la inserción sigue en `src/data/measurements.js`.
- **ADR 0011 (CSP):** no cambia la política. `DecompressionStream` no es una petición de red (no afecta a `connect-src`). La descarga de la plantilla con `<a download href="blob:...">` es una descarga, no una carga de recurso, y `default-src 'none'` no la bloquea. No se usa `innerHTML`, `eval`, `Worker` ni `wasm`, así que no hace falta `worker-src` ni `'wasm-unsafe-eval'`.
- **ADR 0001:** todo ocurre en el navegador. No hay servidor ni función de borde.

## Consecuencias
- Mantenimiento: el subconjunto de OOXML queda a cargo del proyecto. Si se necesitan varias hojas, estilos o .xls, hará falta ampliar el parser o adoptar una librería, con un ADR nuevo y revisión de seguridad.
- La detección de formato de la vista (`isExcelFile`, por firma o extensión) puede moverse a `engine/` (`looksLikeZip`) si otra pantalla la necesita.
- Navegadores anteriores a los indicados en el punto 2 solo pueden importar CSV.
