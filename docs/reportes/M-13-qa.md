# M-13 — Informe QA

Veredicto: **VERDE**

Rama `item/M-13`. Se revisó el commit del desarrollador 45778d4; las pruebas QA están en a2262d5.

## Criterio de aceptación

Criterio: "Unitarias: umbral 1e20 y medición 2^53 rechazados con mensaje". El encargo añade que 2^53-1 se acepta. Origen: H-QA-M12-01.

| Punto | Estado | Evidencia |
|---|---|---|
| Umbral 1e20 rechazado con mensaje: general y por categoría, en motor y pantalla | Cumplido | `validateIndicator` devuelve `thresholds.green: fuera de rango, debe ser menor que 2^53 …`. `buildIndicatorRow` lo traduce a `Umbral verde: …` y `Umbral de la categoría A.green: …`. La repro literal de H-QA-M12-01 (`99999999999999999999`) ya da `ok: false`. |
| Medición 2^53 rechazada con mensaje, en formulario y CSV | Cumplido | Promedio y meta acumulada dan `valor: fuera de rango …`. En CSV el error sale fila a fila y no se guarda ninguna fila. |
| 2^53-1 aceptado | Cumplido | ±(2^53-1) pasan en umbrales, umbrales por categoría, overrides, paquete, `package_total` y mediciones. El valor guardado es exactamente 9007199254740991. |
| Compromisos: overrides, `package_by_category` y suma `package_total` | Cumplido | 2^53 se rechaza en cada caso. 2^52 + 2^52 da un único mensaje, el de `Paquete total`. (2^53-2) + 1 se acepta. |
| Mismo tope que la BD (`abs(v) < 9007199254740992`, exclusivo) | Cumplido | `isSafeMagnitude` coincide con una réplica literal del CHECK en todos los bordes ±, -0, `MIN_VALUE` y `MAX_VALUE`. Un barrido de 2^53 ± 3 y de decimales junto al borde no deja pasar ningún valor que la BD rechace. |
| Pantallas muestran el mensaje (e2e) | Cumplido | Gestora: un umbral 2^53 muestra un `alert` con el mensaje de rango y el indicador no se crea. Custodio: una medición manual 2^53 da `alert` y en el CSV aparece `Fila 3: valor: fuera de rango` con "Guardar" deshabilitado. Compromiso: un paquete P0P1 2^53 da `alert` con el mensaje de rango. |

## Pruebas añadidas

- `tests/engine/qa-m13.test.js`, con 29 casos:
  - tope y bordes ±, incluido -0;
  - valores no numéricos (NaN, ±Infinity, string, bigint, `Object(1)`);
  - umbrales generales y por categoría;
  - si los dos umbrales están fuera de rango, solo sale el mensaje de rango, sin el de coherencia;
  - `buildIndicatorRow` con notación exponencial (`1e20`, `1E20`, `1e400`, `-1e400`, `9.007199254740992e15`) y con decimal con coma que redondea a 2^53;
  - overrides en camelCase y snake_case, paquete y total en sus bordes, `buildCommitmentFields`;
  - mediciones: 2^53, 2^53+1, `1e20`, `1e400`, 400 dígitos y -0;
  - CSV con `"1e400"` entre comillas, separador `;` con coma decimal, y meta acumulada con categorías.
- `e2e/qa-m13.spec.js`, con 3 casos: gestora/indicadores, custodio/mediciones (manual y CSV) y custodio/compromisos.

En local, la suite unitaria completa pasa 1686 de 1686.

## Resultado CI (a2262d5)

- CI: success, https://github.com/apivasa/practica_agente/actions/runs/44727561281
  - Jobs en success: build (lint, unit, build), db (pgTAP), integración y e2e (Playwright), 94 passed. Los 3 casos de `qa-m13.spec.js` aparecen en verde en el log.
- Seguridad: success, https://github.com/apivasa/practica_agente/actions/runs/44727561265

## Cobertura engine/

- Líneas: **99,96 %**. Ramas: 97,86 %. Funciones: 100 %.
- `numeric.js`, `indicator.js` y `measurements-input.js` tienen 100 % de líneas. `commitment.js` tiene 99,35 %; la línea 37 sin cubrir es anterior a M-13.

## Hallazgos

- **H-QA-M13-01 (Info).** Pérdida de precisión silenciosa en decimales cercanos al tope. Es inherente a `double` y no afecta a colores ni al CHECK.
  - `9007199254740991,4` se acepta y se guarda como `9007199254740991`, sin el `,4`.
  - Más allá de unas 15 o 16 cifras significativas, el número que se ve no es el que se guarda.
  - Reproducir: `validateMeasurementInput({measurementType:'window_average'},{fecha:'2026-11-02',unidad:'u',valor:'9007199254740991,4'},{units:[{id:'u',name:'u'}]})`, que devuelve `value: 9007199254740991`.
  - Sugerencia opcional: limitar las cifras significativas del campo.
- **H-QA-M13-02 (Info).** Con notación exponencial el mensaje no es el de rango.
  - En los formularios de indicador y compromiso y en las mediciones, `1e20` y `1e400` se rechazan con "debe ser un número", no con el mensaje de rango, porque la sintaxis exponencial no se admite.
  - Se rechazan con mensaje y nunca llegan a la BD, así que el criterio se cumple.
  - El criterio "umbral 1e20" se verifica en el motor (`validateIndicator`) y en pantalla con su forma decimal `100000000000000000000`.

No hay hallazgos bloqueantes.
