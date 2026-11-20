# M-12 — Informe QA
Veredicto: VERDE

Rama `item/M-12`. Revisado el commit del desarrollador b61059f; pruebas QA en b8ef30f.

## Criterio de aceptación (plan-maestro M-12: "pgTAP por clave y por columna; verificación previa a producción")

| Punto | Estado | Evidencia |
|---|---|---|
| H-M11-01 `indicators.thresholds_by_category`: objeto de objetos con exactamente `green`/`yellow` numéricos y \|v\| < 2^53 | Cumplido | 112 (13 casos) + 113: INSERT y UPDATE por la gestora bajo RLS, valor malo en la segunda categoría y en `yellow`, 2^53 en notación exponencial, booleano, objeto anidado, `Green`, categoría `null`, raíz escalar o cadena con 23514; nombres libres, decimales y ±(2^53 - 0,5) aceptados |
| H-M11-02 `measurements.value`: \|v\| < 2^53 | Cumplido | 112 + 113: UPDATE a 2^53 y 1e400 y INSERT `9.007199254740992e15` rechazados; 2^53 - 0,5 aceptado en un promedio; 2^53 sigue rechazado y 2^53 - 1 aceptado en una meta acumulada con categorías |
| H-M11-03 `package_by_category`: cada valor entero ≥ 0 | Cumplido | 112 + 113: INSERT con -1 en la segunda clave, 0,5, -0,5 y 2^53 - 1,5 rechazados; `1.0` y `1e2` aceptados (JSON.parse los lee como enteros); `{}`, NULL, claves libres y `total` aceptados |
| Por clave y por columna | Cumplido | Cada CHECK se prueba en su tabla (113 comprueba `conrelid` y `convalidated`) y sobre claves que no son la primera |
| Verificación previa a producción | Cumplido | 113 corre tal cual las tres consultas comentadas de la migración: dan 0 filas sobre la semilla y, quitando los CHECK dentro de la transacción (se revierte), **detectan** 3 indicadores, 1 medición y 1 compromiso malos. Así la consulta no da 0 filas en todos los casos sin comprobar nada |
| RLS por rol (CLAUDE.md 4) | Cumplido | Custodio, líder, comité y anónimo no escriben `thresholds_by_category`; custodio ajeno, líder y gestora no escriben mediciones ajenas; custodio ajeno, gestora y comité no escriben `package_by_category` |
| Semilla y e2e m07 | Cumplido | En CI la semilla carga, `e2e (Playwright)` está en verde (incluye `m07-targets.spec.js` con clave `total`) y la integración también |

### Decisión sobre las claves de `package_by_category`: la acepto
El front arma las claves con las categorías del indicador, que la gestora nombra libremente (`src/lib/indicator-form.js`, regex `[A-Za-z0-9_/ -]{1,50}`), o con `total` cuando no hay categorías (`src/views/custodian/commitments.js:15`). Si la BD solo aceptara `P0P1` y `P2P3`, ese flujo dejaría de funcionar. `tests/front/qa-m12.test.js` lo fija. Para el orquestador: la redacción del plan ("claves válidas") y la fila 26n de "Orden de ejecución" ("claves P0P1/P2P3") deberían alinearse con esta decisión. Ver también la observación H-QA-M12-03.

## Pruebas añadidas o modificadas
- `supabase/tests/113_qa_m12.test.sql` (nuevo): 51 casos.
- `tests/front/qa-m12.test.js` (nuevo): 5 casos. Lo que arma el formulario de indicadores cumple la forma `{green, yellow}`, y el formulario de compromisos rechaza negativos y fracciones y deja pasar claves libres y `total`.
- `supabase/tests/091_qa_m09.test.sql` prueba 17: antes aceptaba un promedio de 9007199254740992.25. Con el nuevo criterio debe rechazarlo con `measurements_value_safe`. El plan sigue en 18.
- `supabase/tests/111_qa_m11.test.sql` prueba 31: antes aceptaba decimales y negativos en el paquete. Ahora acepta enteros ≥ 0 bajo el tope, con una clave libre. El plan sigue en 41.

## Resultado CI (b8ef30f)
- CI https://github.com/apivasa/practica_agente/actions/runs/44723154888: success. Pasaron `build (lint, unit, build)`, `db (pgTAP)` (35 archivos, 873 pruebas, PASS, con 091, 111, 112, 113, 049 y 050 en ok), `integración` y `e2e (Playwright)`.
- Seguridad https://github.com/apivasa/practica_agente/actions/runs/44723154848: success.
- Pruebas unitarias en local (`node --test`): 1654 en total, 1651 pasan, 0 fallan.

## Cobertura engine/
99,9 % de líneas: todo al 100 % salvo `commitment.js`, con 99,26 % (falta la línea 36). M-12 no toca `engine/`.

## Hallazgos (ninguno bloquea)
- **H-QA-M12-01 (Baja, UX).** El front no limita a \|v\| < 2^53 lo que la BD ahora rechaza.
  - En `buildIndicatorRow`, un umbral de categoría `99999999999999999999` sale como `{"A":{"green":100000000000000000000,...}}`, con `ok: true`. Lo mismo pasa con el umbral general `9007199254740993`, aunque ese lo rechaza la BD desde M-11.
  - En el importador de mediciones (`engine/measurements-input.js:187`), un valor de promedio solo pasa `Number.isFinite`.
  - El resultado es un error 23514 de la BD en lugar de un mensaje del formulario. No tiene impacto en datos ni en colores.
  - Reproducir: `node -e "import('./src/lib/indicator-form.js').then(m=>console.log(m.buildIndicatorRow({code:'X',name:'x',measurement_type:'window_average',direction:'higher_is_better',green:'96',yellow:'90',categories:[{name:'A',green:'99999999999999999999',yellow:'1'}]})))"`.
  - Sugerencia: validar `Math.abs(n) < 2**53` en el motor (`validateIndicator`, `measurements-input`).
- **H-QA-M12-02 (Info).** La BD acepta cosas que el front y el motor no producen:
  - `thresholds_by_category` acepta una categoría con nombre vacío (`{"": {...}}`) y umbrales diminutos como `1e-16000` (unos 16 KB, que JSON.parse lee como 0).
  - `package_by_category` acepta las claves `""` y `" "`, que `validateCommitment` rechaza (`engine/commitment.js:84`).
  - Solo escriben estos valores roles que ya controlan la columna. No cambia ningún color.
  - Reproducir: como gestora, `update indicators set thresholds_by_category='{"": {"green":1,"yellow":0}}'`, que se acepta.
- **H-QA-M12-03 (Info, anterior a M-12).** Las categorías de los indicadores son libres, pero el guardia de mediciones (`20261124120000_hardening_m09.sql:46`) solo admite `P0P1`/`P2P3` en metas acumuladas con categorías.
  - Una meta acumulada con la categoría "Alta" se puede crear y comprometer, pero no se le pueden registrar mediciones.
  - No lo introduce M-12, pero confirma que restringir las claves del paquete no es el lugar donde cerrar esto. Si se quiere coherencia, el sitio es la regla de categorías del indicador (decisión de diseño).
- **Nota de proceso.** El checkout compartido `/home/claude/practica_agente` cambió de rama mientras trabajaba: lo usaban seguridad y arquitectura. Mi commit local quedó apuntado por `arq/M-12`. Publiqué con cherry-pick desde un worktree aparte, sin force push y sin tocar los cambios de los demás.
