# V-07b — Informe QA

Veredicto: VERDE

Rama `item/V-07b`, commit revisado `a64dfda`. El tester no escribió el código.

## Criterio de aceptación (plan-maestro, fila 28b), punto por punto

| Punto | Estado | Evidencia |
|---|---|---|
| H-V07-01: inflar con tope `min(maxBytes, entry.size)` | Cumplido | En un .xlsx real (XlsxWriter), cada parte deflate se infla con tope igual a su tamaño declarado y sale exactamente ese tamaño, sin cortes. Bomba de 64 MiB que declara 4 KB: el `DecompressionStream` real corta con tope 4096 y el archivo se rechaza como "dañado … supera el tamaño declarado" en menos de 5 s. Pasa lo mismo con zlib. Tamaño declarado 0 → rechazo. Inflar 1 byte más de lo declarado → `invalid`. Declarar más que el tope → `limit` sin llamar al descompresor |
| QA-V07-1: negativos numéricos dicen «debe ser un número ≥ 0» y no «posible fórmula» | Cumplido | En Excel, `-5`, `-0.5` (también `-0,5` en CSV) y `-3` en cumulative_target ("un entero ≥ 0") dan el mensaje nuevo, sin "posible fórmula". CSV y Excel devuelven el mismo resultado. El negativo se sigue rechazando y `0` sigue siendo válido. `-1+2`, `-A1` y `-5` en `unidad` siguen avisando "posible fórmula" |
| QA-V07-2: redondear la serie al milisegundo antes de truncar | Cumplido | `46028 - 1e-9` → 2026-01-06. Bordes: 0,4 ms antes de la medianoche → día siguiente; 0,6 ms antes → mismo día. Lo mismo en el sistema 1904. 60 sigue nulo, `61 - 1e-9` da 1900-03-01, 9999-12-31,5 es válido, el desborde da nulo y ±1e300 da nulo. De punta a punta, la celda `46027.9999999999` se importa como 2026-01-06 |
| H-V07-02: cortar la hoja al superar 5001 filas | Cumplido | Con 5000 filas se importa todo, igual que el CSV. Con 5001, el resultado y el mensaje son idénticos al CSV. Con 5002 da un error de archivo con el máximo. El corte ocurre durante el análisis: un XML roto después de la fila 5003 nunca se llega a leer. Una hoja de 130 000 filas (390 000 elementos, menos de 1 MB) se rechaza por filas. Las filas vacías no cuentan. Se siguen validando las fórmulas y el orden de las filas |
| No romper V-07 ("mismas columnas, límites y validaciones que el CSV") | Cumplido | La suite completa de V-07 (`qa-v07`, `xlsx-v07`, `measurements-input`, etc.) está verde |

Mensaje de QA-V07-1: el texto `valor: "-5" debe ser un número ≥ 0 (no se aceptan negativos ni fórmulas)` cumple mi hallazgo. El motivo real va primero y ya no dice "posible fórmula" ni "empieza con =, +, -". La coletilla es correcta, así que no pido cambiarla. Mantengo `measurements-input.test.js:48`, que sigue verde.

## Pruebas añadidas

`tests/engine/qa-v07b.test.js` tiene 24 casos: 6 de H-V07-01, 6 de QA-V07-1, 5 de QA-V07-2 y 7 de H-V07-02. Los .xlsx se arman con el generador de fixtures de V-07 (`tests/fixtures/v07/ooxml.js`, estructura de Excel), no con el helper del desarrollador.

Para comprobar que las pruebas detectan el problema, corrí el mismo archivo contra `origin/main`, que todavía no tiene V-07b: 13 de los 24 casos fallan allí, y en esta rama pasan todos.

## Resultado

- Local (Node 22.23): `tests/engine/*.test.js` dio 832/832 en verde. La suite completa de unitarias (`tests/**`) dio 2194 pruebas: 2191 pasan, 0 fallan y 3 se omiten por entorno.
- CI de la rama: queda pendiente del push de este informe. Lo revisa el orquestador antes del merge.

## Cobertura engine/

Líneas: **99,32 %** (meta ≥ 95 %).

| Archivo | Líneas | Ramas |
|---|---|---|
| `xml.js` | 100 % | 84,8 % |
| `zip.js` | 97,2 % | 78,6 % |
| `xlsx.js` | 98,5 % | 89,8 % |
| `measurements-input.js` | 100 % | 95,8 % |

## Hallazgos

Ninguno bloquea.

1. **Info: un negativo minúsculo de Excel en notación científica sigue diciendo "posible fórmula".**
   - Qué pasa: `numberText` conserva el texto crudo cuando `String(n)` sale con `e`, y `NEGATIVE_NUMBER_RE` no acepta exponentes.
   - Cómo reproducirlo: celda numérica `<v>-9.9999999999999995E-8</v>` (o `-1E+21`) en `valor` da `valor: la celda empieza con =, +, -, @ o un carácter de control (posible fórmula); no se acepta`.
   - Impacto: la fila se rechaza igual, solo cambia el mensaje. Es muy improbable en indicadores reales.
   - Sugerencia: que en celdas `kind: number` con valor `< 0` se use el mensaje de "≥ 0", sin importar el texto.
2. **Info: `-0` se trata distinto en CSV y en Excel.**
   - Qué pasa: en CSV, `-0` se rechaza ("debe ser un número ≥ 0"). En Excel, la celda numérica `-0` se importa como 0, porque `String(-0) === "0"`.
   - Origen: el comportamiento ya existía en V-07, no lo introduce este ítem. Excel normalmente guarda 0 y no -0.
   - Impacto: ninguno práctico, el valor 0 es válido en los dos casos.
