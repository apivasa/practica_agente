# V-07 — Informe QA

Veredicto: **VERDE**

Revisión hecha sobre `item/V-07` (código del desarrollador en ff51e7b; pruebas QA en 78a96a7). Primero leí el criterio del plan maestro y `docs/diseno.md` (punto 7, Q-02), y después el código.

## Criterio de aceptación: cumplido, punto por punto

| Punto | Estado | Evidencia |
|---|---|---|
| Unitarias y e2e: un .xlsx de ejemplo importa igual que su CSV | Cumplido | Unitarias: `deepEqual` entre el resultado del .xlsx y el del CSV equivalente con 6 fixtures de productores reales (XlsxWriter y LibreOffice) y los 3 tipos de medición. e2e: la vista previa (resumen, botón y celdas) es idéntica para el CSV y los 4 .xlsx de AVAIL, y también para OBS con booleanos de Excel |
| Un archivo con fórmulas se rechaza con mensaje | Cumplido | Fixture de XlsxWriter con fórmula y valor guardado: "Fila 3: Columna C: la celda tiene una fórmula; no se aceptan fórmulas, copia y pega solo los valores". También se detectan las fórmulas compartidas, las de matriz y las de la cabecera. El texto que empieza con `=` da el mismo mensaje que en el CSV. El botón Guardar queda deshabilitado |
| Un archivo demasiado grande se rechaza con mensaje | Cumplido | Con 1 MiB + 1 byte sale "El archivo supera 1 MB", igual que en el CSV. Con exactamente 1 MiB se acepta (probado en unitarias y e2e). Un .xlsx pequeño que se descomprime en más de 8 MiB se rechaza. 5000 filas pasan y 5001 se rechazan |
| Un archivo con columnas erróneas se rechaza con mensaje | Cumplido | Columna mal escrita, columna extra, columnas repetidas y columnas de otro tipo de indicador: los mensajes son idénticos a los del CSV equivalente (unitarias y e2e) |
| Mismas columnas, límites y validaciones que el CSV; se lee la primera hoja | Cumplido | Los fixtures traen una segunda hoja con basura y no afecta. Los errores fila a fila (fecha inexistente, unidad inexistente, negativo, texto) son idénticos a los del CSV |
| Pedidos del orquestador: fechas de serie con otra timezoneId, libro 1904, fecha con hora, plantilla reimportable | Cumplido | e2e con el navegador en `Pacific/Kiritimati` (UTC+14) y `Pacific/Pago_Pago` (UTC−11). Unitarias en procesos hijo con 4 zonas, verificando el desfase real de cada una. Horas 23:59:59, 00:00:01 y 12:00. La plantilla sin tocar solo da "El archivo no tiene filas de datos" (ningún error de cabecera). Rellena, da una vista previa válida (AVAIL) y se guarda de punta a punta (OBS) |

## Pruebas añadidas

- `tests/engine/qa-v07.test.js`: 42 casos (node:test).
  - Equivalencia .xlsx = CSV.
  - DecompressionStream frente a zlib.
  - Zonas horarias en procesos hijo.
  - Bordes de las series 1900 y 1904: 1, 59, 60, 61, 2000-01-01, 9999-12-31 y fuera de rango.
  - Fechas anteriores a 2000, futuras y de hoy; celdas `t="d"`.
  - Fórmulas: normal, compartida, de matriz y en la cabecera; error `#DIV/0!`.
  - Tamaño: 1 MiB exacto, 1 MiB + 1 y zip bomb; 5000 y 5001 filas.
  - Columnas erróneas.
  - Estructuras reales: rich text con `rPh`, `xml:space`, celdas con estilo vacías, comentarios y CDATA, ZIP con descriptor de datos (bit 3), OOXML estricto, filas en blanco intermedias.
  - .xls antiguo o CSV renombrado.
  - Plantilla de los 3 tipos: estructura, reimportación vacía y rellena, escape XML, recompresión.
- `e2e/qa-v07.spec.js`: 11 casos (Playwright, Supabase local con la semilla).
  - Control y plantilla visibles.
  - AVAIL CSV = 4 .xlsx; OBS CSV = .xlsx.
  - 2 zonas horarias del navegador.
  - Fórmula, más de 1 MiB y 1 MiB exacto, columnas erróneas, .xls y texto renombrado.
  - Plantilla AVAIL (sin tocar y rellena) y plantilla OBS guardada en la BD.
- `tests/fixtures/v07/`:
  - `generate.py`: genera los fixtures de forma reproducible con XlsxWriter y LibreOffice, no con el lector bajo prueba.
  - 9 archivos .xlsx y 5 CSV, con sharedStrings, styles.xml, rich text en varios `<r>`, libro 1904, fechas con hora, fórmula, columnas erróneas y una conversión de LibreOffice Calc.
  - `ooxml.js`: ZIP/OOXML independientes, sobre node:zlib.
  - `tz-probe.js`.

Verificación manual fuera del CI: la plantilla descargable abre con openpyxl 3.1.5 y con LibreOffice (la convertí a CSV y a xlsx). Una plantilla rellenada y guardada por openpyxl, y luego vuelta a guardar por LibreOffice, se importa sin errores. No había Microsoft Excel disponible para probarla.

## Resultado CI

Run CI de 78a96a7: https://github.com/apivasa/practica_agente/actions/runs/44856834647. Todo en éxito:
- build (lint, unit, build): 2042 pruebas unitarias, 0 fallos.
- e2e (Playwright): 112 pasadas, 0 fallos; las 11 de `qa-v07.spec.js` en verde.
- db (pgTAP): éxito.
- integración: éxito.

Seguridad: https://github.com/apivasa/practica_agente/actions/runs/44856834567 (éxito).

## Cobertura engine/

**99,19 % de líneas** en `engine/` con todas las unitarias (`--test-coverage-include='engine/**'`, ejecución local). Ramas: 93,75 %. Funciones: 100 %.

Por archivo, solo con `tests/engine`: `xlsx.js` 98,4 %, `zip.js` 97,1 %, `xml.js` 93,5 %. Las líneas sin cubrir de `xml.js` son comentarios y CDATA sin cerrar. Meta ≥ 95 %: cumplida.

## Hallazgos

Ninguno bloqueante. Todos son de severidad baja o informativos:

1. **Baja: mensaje engañoso para un número negativo en una celda numérica.** Si una celda numérica de `valor` vale `-5`, el mensaje es "valor: la celda empieza con =, +, -, @ o un carácter de control (posible fórmula); no se acepta". Es la regla heredada del CSV y el mensaje es idéntico, así que cumple "mismas validaciones". Pero en Excel esa celda es un número, no una posible fórmula. Cómo reproducirlo: hoja con `fecha,unidad,valor` y en C2 el número `-5`. Sugerencia: en celdas `kind: number` decir "debe ser un número mayor o igual que 0".
2. **Baja: series a menos de 1 ms de la medianoche.** La serie se trunca con `Math.floor`. Un valor como `46028 - 1e-9` lo importa como 2026-01-05, pero Excel lo muestra redondeado como 2026-01-06 00:00:00. Solo aparece con horas calculadas por fórmula y luego pegadas como valores. Cómo reproducirlo: `excelSerialToIsoDate(46028 - 1e-9)` devuelve `'2026-01-05'`. Sugerencia: redondear al milisegundo antes de truncar. No escribí una prueba en rojo porque es un borde de redondeo que el criterio no exige.
3. **Informativo: concordancia gramatical en el singular.** Con una sola fila válida, el resumen dice "1 filas válidas, listas para guardar." (también pasa con el CSV).
4. **Informativo: plantilla mínima.** La plantilla no trae `styles.xml` ni `docProps`. openpyxl y LibreOffice la abren bien, pero Microsoft Excel no se pudo probar en este entorno. Conviene una prueba manual con Excel antes de anunciar la plantilla a los custodios.
