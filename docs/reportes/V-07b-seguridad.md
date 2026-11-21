# V-07b — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. Endurece la importación `.xlsx` de V-07 (ADR 0018): el tope del descompresor pasa a `min(maxBytes, entry.size)` (`engine/zip.js`), la hoja se lee fila a fila con `parseXml(..., { onClose })` y se corta al pasar de `XLSX_MAX_SHEET_ROWS` = cabecera + 5001 filas con datos (`engine/xml.js`, `engine/xlsx.js`), cambia el mensaje de negativos en `valor` (`engine/measurements-input.js`) y el redondeo de fechas de serie. Modelo de amenazas: sección "Superficie nueva (V-07b)" (T-V07b-01..03).

Revisado sobre `a64dfda` (diff `origin/main...origin/item/V-07b`).

## Pruebas de seguridad añadidas
`tests/security/xlsx-import-v07b.test.js`: 21 casos, todos de la categoría 3 (entradas). Los archivos maliciosos se arman en memoria con un ZIP propio de la prueba que deja mentir en el tamaño declarado.

- **Zip bomb y tamaños declarados mentirosos (H-V07-01), 6 casos:**
  - una bomba de 100 MiB que declara 2 KB: el descompresor recibe un tope de 2048, el archivo se rechaza como dañado y la respuesta tarda menos de 3 s;
  - tamaño declarado 0 con datos que sí producen bytes;
  - tamaño declarado 1 byte menor que el real, y tamaño declarado mayor que el real;
  - tamaño declarado mayor que 8 MiB: se rechaza sin llamar al descompresor;
  - un `inflate` hostil que ignora el tope: `readZipEntry` nunca le pasa un tope mayor que el declarado o que `maxBytes`.
- **Corte de la hoja y procesado por fila (H-V07-02), 12 casos:**
  - el valor de la constante;
  - la frontera: 5000 filas se aceptan, 5001 dan el mensaje del CSV y 5002 cortan durante la lectura;
  - el corte llega antes de leer el resto: un XML mal formado, un `DOCTYPE`/`ENTITY` o 100 000 niveles de anidamiento después de la fila 5003 no se llegan a analizar;
  - una hoja de unos 8 MiB con 300 000 filas, en tiempo acotado;
  - 380 000 filas vacías no cuentan para el tope, se recorren en tiempo acotado y no se retienen. Con más de 400 000 elementos sigue saltando el tope de elementos;
  - el árbol de la hoja se queda sin filas después de procesarlas;
  - filas en una segunda `sheetData`, en `extLst` o anidadas dentro de otra fila: no evaden el corte ni entran como datos. Una raíz que no es `worksheet` se rechaza;
  - el corte funciona también con prefijos `x:row` / `x:sheetData`;
  - un atributo `r` inválido o fuera de orden se detecta mientras se procesa cada fila;
  - filas enormes: una celda de 7 MiB, o una fila con 120 000 celdas;
  - XML de 200 000 niveles dentro de una fila: lo corta `XML_MAX_DEPTH` sin desbordar la pila;
  - después de un corte no queda estado a medias.
- **Mensaje de negativos (QA-V07-1), 2 casos:**
  - `-5`, `-0,5`, `-0.25` y ` -7 ` se rechazan con el mensaje "≥ 0". Los valores que empiezan por `-` pero no son un número negativo simple (`-1+1`, una carga DDE, `-SUM(A1)`, `-1e5`, `--5`, `-5;=1`, `-0x10`) se siguen rechazando como fórmula;
  - en otros campos, `-5` sigue tratándose como posible fórmula;
  - un valor negativo no llega a las filas que se guardan, ni por CSV ni por Excel.
- **Redondeo de fechas (QA-V07-2), 1 caso:** 22 series raras en los sistemas 1900 y 1904 (NaN, ±Infinity, ±1e308, `-0`, el 60, los bordes de 9999-12-31, `BigInt`, cadena, objeto) devuelven `null` o una fecha válida y nunca lanzan. 46028 − 1e-9 da 2026-01-06.

Resultado local con Node 22.23: 21/21 pasan. La regresión local `tests/engine/*.test.js` + `tests/security/xlsx-*.test.js` + `tests/security/engine-*.test.js` da 1173 pasan, 0 fallan, 0 omitidas.

Medición de memoria: 399 000 filas vacías en la hoja ocupan unos 14 MiB de heap, y se parsean en 344 ms. En V-07 se midieron unos 176 MiB para una parte de tamaño parecido.

## Resultados del pipeline
- Sobre `a64dfda`:
  - **CI:** success, https://github.com/apivasa/practica_agente/actions/runs/44868386790
  - **Seguridad** (gitleaks, semgrep, npm audit, ZAP baseline, pentest RLS/API): success, https://github.com/apivasa/practica_agente/actions/runs/44868386726
- Sobre `754c35e` (lo empujó otro revisor después de `a64dfda`), CI y Seguridad seguían en curso al cerrar este informe:
  - CI: https://github.com/apivasa/practica_agente/actions/runs/44870386824
  - Seguridad: https://github.com/apivasa/practica_agente/actions/runs/44870386847
- Las pruebas de este informe corren en el próximo run de la rama.

## Hallazgos
- **H-V07b-01 · Info · 3 Entradas · `engine/xlsx.js` `parseSharedStrings`**
  - Qué pasa: `sharedStrings.xml` se sigue leyendo como un árbol completo.
  - Cómo reproducir: un archivo con 133 000 `<si><t>a</t></si>` (unos 2,2 MiB y 399 000 elementos) tarda unos 0,4 s y usa unos 126 MiB de heap transitorio.
  - Impacto: solo afecta a la pestaña de quien sube el archivo. Lo acotan los topes de 8 MiB y de 400 000 elementos. No afecta a otros usuarios ni a la BD.
  - Corrección sugerida (opcional): procesar `<si>` con `onClose`, o poner un tope de cadenas compartidas.
  - Registrado en `docs/seguridad/hallazgos.md`, sin ítem.
- Cambios de estado en `docs/seguridad/hallazgos.md`:
  - **H-V07-01:** Corregido.
  - **H-V07-02:** Corregido en la hoja. Lo que queda en sharedStrings es H-V07b-01.

## Verificado sin hallazgos
- **Categoría 3 (entradas).** Comprobado:
  - las zip bombs con tamaño declarado mentiroso;
  - que el corte por filas no se puede evadir;
  - que XML malicioso, `DOCTYPE`/`ENTITY` o XML profundo, antes o después del corte, no sirven para atacar;
  - que el mensaje nuevo de negativos no abre una vía para fórmulas;
  - que las fechas de serie extremas no hacen fallar la lectura.
- **Categorías 1, 2, 4, 5, 6 y 8.** No las toca el ítem:
  - no hay tablas, RPC, auth, vista, workflows ni dependencias nuevas;
  - las filas siguen pasando por el mismo insert con RLS de V-07;
  - la regresión completa corre en `seguridad.yml`.
