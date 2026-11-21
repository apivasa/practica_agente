# Indicadores, compromisos, mediciones y candados

Guía para la gestora de KPIs, los custodios y el comité. Explica cómo se describe un indicador, cómo se negocia un umbral, cómo se cargan las mediciones, cómo se calcula el color y qué candado recibe una unidad.

> **Estado (2026-11-20).** Todo lo descrito aquí está construido y probado: pantallas de indicadores (M-02), compromisos (M-03) y mediciones (M-04), el motor (`engine/`) y la evaluación programada (C-03, C-04). La evaluación programada todavía no corre en producción: espera la activación (P-05). Las metas mensuales (`targets`) de los indicadores de meta acumulada sin categorías se cargan en **Metas** (`#/gestora/metas`, M-07); VULN no las necesita desde M-06. Detalle técnico: [`engine/README.md`](../engine/README.md) y [`engine/ESCALATION.md`](../engine/ESCALATION.md).

## 1. Los 7 atributos de un indicador

Cualquier indicador, incluso uno que no existe hoy, se describe con estos 7 atributos. No hace falta programar nada para un indicador nuevo. La gestora los llena en **Indicadores** (`#/gestora/indicadores`, ver [manual de la gestora](manual-gestora.md)).

| # | Atributo | En pantalla | Valores | Por defecto |
|---|---|---|---|---|
| 1 | Tipo de medición | Tipo de medición | Promedio en ventana, Cobertura, Meta acumulada | Promedio en ventana |
| 2 | Sentido | Sentido | Más es mejor, Menos es mejor | Más es mejor |
| 3 | Ventana de cálculo | Ventana (días) | entero mayor que 0 | 30 |
| 4 | Umbrales | Umbral verde, Umbral amarillo, Umbrales por categoría | números | obligatorio |
| 5 | Frecuencia | Frecuencia | Mensual, Semanal, Trimestral | Mensual |
| 6 | Mínimo de muestra | Mínimo de muestra | entero ≥ 0 | 0 |
| 7 | Fuente de datos | Fuente | Manual, Automática | Manual |

Además: código (único; letras, números, `-` y `_`; máx. 40), nombre, descripción, custodio y si está activo.

Notas:

- **Umbrales.** Se dan dos límites: verde y amarillo. Rojo es todo lo que queda peor que amarillo.
  - Con "más es mejor", verde debe ser mayor o igual que amarillo.
  - Con "menos es mejor", verde debe ser menor o igual que amarillo.
  - Si no se cumple, la pantalla rechaza el indicador con un mensaje en español. La BD también lo impide.
  - Cada umbral, general o por categoría, debe ser menor que 2^53 (9007199254740992) en valor absoluto. La pantalla lo revisa antes de guardar (M-13) y la BD también (M-11, M-12). Mensaje: "Umbral verde: fuera de rango, debe ser menor que 2^53 (9007199254740992) en valor absoluto".
  - Los números se escriben sin notación exponencial: `1e20` da "debe ser un número".
- **Meta acumulada solo admite "más es mejor"** (M-08). Con "menos es mejor" la pantalla muestra "Sentido: una meta acumulada (cumulative_target) solo admite higher_is_better (más es mejor)". La BD también lo impide (check `indicators_cumulative_direction`).
- **Umbrales por categoría** (opcional): nombre de categoría, verde y amarillo. Para vulnerabilidades usa exactamente `P0P1` y `P2P3` (ver sección 6). En un indicador de meta acumulada con categorías, la BD solo acepta mediciones con categoría `P0P1` o `P2P3` y valor entero ≥ 0 y ≤ 2^53 − 1 (M-08, tope desde M-09): otras categorías no sirven para ese tipo.
- **Frecuencia y fuente** hoy solo se guardan. La evaluación programada corre igual para todos (mensual). Las fuentes automáticas no existen todavía (V-07, espera Q-02).
- **Activo.** Solo los indicadores activos entran en la evaluación y en el tablero de completitud. Desactivar no borra nada.

### Cómo se calcula el valor según el tipo

La ventana incluye el día de evaluación y los `ventana − 1` días anteriores. La evaluación mensual usa como día de evaluación el último día del mes. Las mediciones fuera de la ventana no cuentan.

- **Promedio en ventana:** promedio de los valores de la ventana.
- **Cobertura:** % de aplicaciones distintas que cumplen. De cada aplicación cuenta solo su **última** medición en la ventana.
- **Meta acumulada:** suma de lo resuelto en el trimestre hasta el fin del mes × 100 / meta acumulada del mes.
  - **Con umbrales por categoría** (caso vulnerabilidades): se calcula por categoría, con la meta que sale del paquete del compromiso trimestral. No usa la tabla `targets`. Ver sección 6, «Color mensual».
  - **Sin categorías:** la meta del mes sale de la tabla `targets`, que carga la gestora en **Metas** (ver «Metas mensuales de un indicador sin categorías» en la sección 2). Sin meta del mes, queda **sin evaluar** ("falta la meta del periodo").
  - Meta 0: el resultado es 100 %.
  - Las mediciones de tipo "detectada" no suman a lo resuelto.

## 2. Ejemplos

Los umbrales son los de la semilla y son ilustrativos. Los reales los fija la gestora (Q-01 sigue abierta).

### Disponibilidad (`AVAIL`): promedio en ventana, más es mejor

Ventana 30 días, verde 99,9, amarillo 99,5. Mediciones: 99,95 · 99,80 · 99,95. Promedio 99,9 → **verde** (empate con el umbral verde).

### MTTR (`MTTR`): promedio en ventana, menos es mejor, con mínimo de muestra

Ventana 30 días, verde 4 h, amarillo 8 h, mínimo de muestra 3.

- 2 incidentes (3 h y 6 h): **sin evaluar**, "Muestra insuficiente: 2 de 3 requeridas".
- 3 incidentes (3 h, 6 h y 9 h): promedio 6 h → **amarillo**.

### Observabilidad (`OBS`): cobertura, más es mejor

Ventana 30 días, verde 90 %, amarillo 75 %. Cuatro aplicaciones: A no cumplía el día 3 pero sí el día 20 (cuenta lo último: cumple). B y C cumplen, D no. Resultado 3 de 4 = 75 % → **amarillo**.

### Vulnerabilidades (`VULN`): meta acumulada

Ventana 90 días, verde 96, amarillo 90, categorías `P0P1` (96 / 90) y `P2P3` (85 / 75). Ver sección 6.

### Metas mensuales de un indicador sin categorías

Un indicador de meta acumulada **sin** umbrales por categoría se mide contra la meta del mes guardada en `targets`. La gestora la carga en **Metas** (`#/gestora/metas`, ver [manual de la gestora](manual-gestora.md#metas-gestorametas)).

- La meta es **acumulada del trimestre**: lo que debe estar resuelto desde el día 1 del trimestre hasta el cierre del mes.
- **Proponer un tercio** la calcula desde el paquete total (P) del compromiso trimestral de la unidad: mes 1 = ceil(P/3), mes 2 = ceil(2P/3), mes 3 = P, sin superar nunca P.
- La pantalla muestra el color de cada unidad con esa meta como vista previa. El color oficial lo guarda la evaluación programada.

Ejemplo: indicador de meta acumulada, más es mejor, verde 90, amarillo 80, sin categorías. La unidad tiene un compromiso trimestral con paquete 30.
- Sin meta del mes 1: **sin evaluar**.
- Propuesta para el mes 1: ceil(30/3) = 10. Con 10 resueltas: 100 % → **verde**.
- Si la meta se cambia a 20, las mismas 10 resueltas dan 50 % → **rojo**.

## 3. Compromisos con umbral negociado

El custodio registra los compromisos en **Compromisos** (`#/custodio/compromisos`, ver [manual del custodio](manual-custodio.md)). Un compromiso es de una unidad, un indicador y un periodo.

- **Periodo:** trimestre `AAAA-Qn` (ej. `2027-Q1`) o mes `AAAA-MM` (ej. `2027-03`).
- **Qué compromiso aplica a un mes:** primero el del mes; si no hay, el del trimestre de ese mes.
- **Umbral negociado:** verde y amarillo juntos, o los dos vacíos. Deben ser coherentes con el sentido del indicador. Si están, reemplazan a los umbrales generales para esa unidad y periodo. Si están vacíos, rige el umbral general.
- **Paquete por categoría:** solo en meta acumulada. Un entero ≥ 0 por categoría del indicador. El total se guarda solo.
- **Tope numérico** (M-13): umbrales negociados, cada paquete y su total deben ser menores que 2^53 (9007199254740992) en valor absoluto.
- **Notas:** hasta 500 caracteres.

La tabla de la pantalla muestra, por compromiso, el umbral efectivo y su origen: **Negociado** o **General**.

Ejemplo de la semilla: AVAIL tiene verde 99,9 y amarillo 99,5. La Unidad Gamma negoció para `2027-01` verde 99,5 y amarillo 99,0. En enero, Gamma con 99,6 queda **verde** (con el general sería amarillo). En el motivo de la evaluación aparece "umbral del compromiso".

Errores frecuentes:
- "Umbral negociado: indica verde y amarillo, o deja los dos vacíos".
- "Umbral negociado: con "más es mejor" el verde debe ser mayor o igual que el amarillo".
- "Periodo: usa el formato AAAA-Qn (trimestre, ej. 2027-Q1) o AAAA-MM (mes, ej. 2027-03)".
- "Paquete de P0P1: fuera de rango, debe ser menor que 2^53 (9007199254740992) en valor absoluto" o "Paquete total: fuera de rango, la suma debe ser …".

El umbral negociado reemplaza los umbrales generales. No cambia los umbrales por categoría.

## 4. Carga de mediciones

El custodio carga en **Mediciones** (`#/custodio/mediciones`): a mano, de a una, o con un archivo CSV. Solo para los indicadores activos que custodia.

### Captura manual

Campos según el tipo:

| Tipo | Campos |
|---|---|
| Promedio en ventana | Fecha, Unidad, Valor (número ≥ 0) |
| Cobertura | Fecha, Unidad, Aplicación (`app_id`), Cumple (Sí/No) |
| Meta acumulada | Fecha, Unidad, Valor (entero ≥ 0, **incremental**), Categoría, Tipo (Resuelta o Detectada) |

La fecha no puede ser futura (fecha de America/Guayaquil) ni anterior al año 2000.

### Formato del CSV

- Primera fila: cabecera con los nombres de columna. El orden no importa.
- Separador: coma. Si la cabecera usa `;` y no tiene comas, el separador es punto y coma.
- Cabecera sin distinguir mayúsculas ni tildes (`Categoría` = `categoria`).
- Celdas entre comillas dobles cuando contienen el separador o saltos de línea. `""` es una comilla dentro de la celda.
- Máximo 1 MB y 5000 filas de datos. Las líneas en blanco se ignoran.
- **Todo o nada:** si una fila tiene un error, no se guarda ninguna. La pantalla muestra una vista previa con las primeras 50 filas válidas y el botón "Guardar N mediciones".

Columnas por tipo (las de `engine/measurements-input.js`):

| Tipo | Obligatorias | Opcionales |
|---|---|---|
| Promedio en ventana | `fecha`, `unidad`, `valor` | — |
| Cobertura | `fecha`, `unidad`, `app_id`, `cumple` | — |
| Meta acumulada | `fecha`, `unidad`, `valor` | `categoria`, `tipo` |

Valores:

- `fecha`: `AAAA-MM-DD`, fecha real.
- `unidad`: nombre de la unidad (sin distinguir mayúsculas) o su id.
- `valor`: número ≥ 0. Decimales con punto o coma (con coma decimal usa `;` como separador o pon el valor entre comillas). En meta acumulada, entero.
- `app_id`: letras, números y `. _ : / -`; máx. 100.
- `cumple`: `sí`, `si`, `true`, `1`, `cumple`, `yes` o `no`, `false`, `0`, `no cumple`.
- `categoria`: obligatoria si el indicador tiene umbrales por categoría, y debe ser una de ellas. Si no tiene, es libre (máx. 50).
- `tipo`: `resuelta` o `detectada` (también `resolved`, `detected` y plurales). Vacío = resuelta.

Ejemplos:

```csv
fecha,unidad,valor
2027-01-15,Unidad Alfa,99.95
2027-01-15,Unidad Beta,99.60
```

```csv
fecha,unidad,app_id,cumple
2027-01-31,Unidad Alfa,app-alfa-01,sí
2027-01-31,Unidad Beta,app-beta-01,no
```

```csv
fecha;unidad;valor;categoria;tipo
2027-01-31;Unidad Alfa;450;P0P1;resuelta
2027-01-31;Unidad Alfa;250;P2P3;resuelta
2027-02-10;Unidad Alfa;200;P0P1;detectada
```

Errores frecuentes (la fila 1 es la cabecera):

| Mensaje | Causa |
|---|---|
| `Cabecera: faltan columnas ...` | Falta una columna obligatoria o está mal escrita. |
| `Cabecera: columnas no reconocidas ...` | Sobra una columna (por ejemplo `valor` en un indicador de cobertura). |
| `Cabecera: columnas repetidas ...` | Dos columnas con el mismo nombre. |
| `Fila N: Tiene X columnas y la cabecera Y` | Separador de más o de menos; típico con coma decimal y separador coma. |
| `fecha: "..." no es una fecha real con formato AAAA-MM-DD` | Formato `15/01/2027` o una fecha que no existe (30 de febrero). |
| `fecha: ... es futura` | Fecha posterior a hoy. |
| `unidad: "..." no existe` | Nombre mal escrito. |
| `valor: "..." debe ser un entero mayor o igual que 0` | Decimal o negativo en meta acumulada. |
| `valor: fuera de rango, debe ser menor que 2^53 ...` | Valor de 2^53 (9007199254740992) o más en cualquier tipo (M-13). |
| `valor: "..." debe ser un número mayor o igual que 0` | Texto, negativo o notación exponencial como `1e20`, que no se admite. En meta acumulada el mensaje dice "entero". |
| `... la celda empieza con =, +, -, @ ...` | Celda con forma de fórmula de hoja de cálculo. Se rechaza; un valor negativo como `-1` también cae aquí. |
| `categoria: "..." no es una de P0P1, P2P3` | Categoría distinta a las del indicador (por ejemplo `P0/P1`). |
| `cumple: "..." debe ser sí o no` | Valor no reconocido. |
| `Comillas sin cerrar` | Una comilla doble abierta sin cerrar. |
| `El archivo supera 1 MB` / `... el máximo es 5000` | Divide el archivo. |

## 5. Cómo se decide el color

1. Si no hay datos en la ventana → **sin evaluar**.
2. Si falta la meta (meta acumulada) → **sin evaluar**.
3. Si la muestra es menor que el mínimo → **sin evaluar**.
4. Si no, se compara con los umbrales efectivos:
   - Alcanza el umbral verde → **verde**.
   - Alcanza el umbral amarillo → **amarillo**.
   - Si no → **rojo**.

**Empates.** Un valor igual al umbral recibe el color mejor. 96 % con verde en 96 es verde. 8 h con amarillo en 8 es amarillo. Se toleran diferencias mínimas de redondeo: 99,89999999999999 cuenta como 99,9.

Cada color viene con un motivo en español, por ejemplo `Valor 6 <= amarillo 8`. Las pantallas lo muestran junto al color.

### Color de la unidad

El color de la unidad en un mes es el **peor** de sus indicadores evaluados. Los indicadores sin evaluar no cuentan. Si ninguno se pudo evaluar, la unidad queda sin evaluar.

## 6. Caso vulnerabilidades

### Configuración

- Indicador de **meta acumulada**, más es mejor, con categorías `P0P1` y `P2P3`. Los nombres deben ser exactamente esos: el cálculo del paquete y del ritmo solo reconoce esas dos claves.
- Ventana: 90 días. La evaluación la amplía sola al trimestre completo cuando el trimestre tiene 92 días.
- El umbral verde de cada categoría es el % de cumplimiento exigido del paquete. El diseño fija **96 % para P0/P1 y 85 % para P2/P3** (son los valores por defecto si no se configuran).

### Datos que carga el custodio

1. **Compromiso trimestral** (periodo `AAAA-Qn`) con el paquete por categoría. Ejemplo: `P0P1` 1500, `P2P3` 500. El paquete siempre sale del compromiso trimestral, aunque haya también uno mensual. Sin paquete, el ritmo diario se omite para esa unidad y el color mensual queda **sin evaluar**.
2. **Mediciones incrementales** con categoría y tipo:
   - **Resuelta:** cuántas se resolvieron ese día.
   - **Detectada:** P0/P1 nuevas del escaneo de ese día.

### Paquete efectivo y arrastre

- Las P0/P1 detectadas en los meses 1 y 2 del trimestre se suman al paquete.
- Las detectadas en el mes 3 pasan al paquete del trimestre siguiente.
- Lo no resuelto al cierre también pasa al siguiente.

Ejemplo del diseño: paquete de 2.000. Entran 120 P0/P1 en enero, 80 en febrero y 40 en marzo.
- Paquete efectivo: 2.000 + 120 + 80 = **2.200**.
- Se resuelven 2.100. Pasan al siguiente: (2.200 − 2.100) + 40 = **140**.

### Metas mensuales y ritmo

- **Meta parcial mensual** del motor: un tercio, dos tercios y el total del paquete efectivo, acumulados, con redondeo hacia arriba en los meses 1 y 2, topado en el total.
- **Ritmo esperado:** pendiente / semanas restantes del trimestre. Se recalcula cuando entran P0/P1 nuevas.
- **Atraso:** se compara lo resuelto con la meta acumulada a la fecha. Dentro del mes, la meta se prorratea por días: al día 10 de un mes de 30 se espera la meta del mes anterior más 10/30 de la del mes en curso. P0/P1 y P2/P3 se miden por separado: lo resuelto de una no compensa la otra. Basta que una vaya atrasada para que la unidad esté **Atrasada**.
- Las P0/P1 del mes 3 que se resuelven en el mismo trimestre cuentan para su cumplimiento.

Estas tres últimas reglas son valores por defecto mientras no se responda Q-06 ([ADR 0006](adr/0006-ritmo-vulnerabilidades.md)).

El líder ve el estado "Al día" o "Atrasada" con el detalle en su pantalla. El ritmo diario genera alertas `pace_behind` (al pasar a atrasada) y `critical_intake` (cuando entran P0/P1 que cambian la meta).

### Color mensual

Desde M-06 ([ADR 0016](adr/0016-color-mensual-por-criticidad.md)), el color mensual de VULN se calcula **por criticidad**. Ya no usa la tabla `targets`.

1. **Meta acumulada del mes**, por categoría: 1/3, 2/3 y 3/3 del paquete **efectivo** (con las P0/P1 detectadas en los meses 1 y 2), con redondeo hacia arriba en los meses 1 y 2.
2. **Cumplimiento** por categoría: lo resuelto del trimestre hasta el último día del mes × 100 / meta del mes. Puede pasar de 100 % si la unidad va adelantada.
3. **Color** por categoría, con sus propios umbrales (`P0P1` 96 / 90 y `P2P3` 85 / 75 en la semilla) y su mínimo de muestra.
4. **Color del indicador:** el **peor** de sus categorías. El valor guardado es el de la categoría con peor color. El motivo detalla todas, por ejemplo `P0/P1 92.59 % (1050 de 1134, meta acumulada de 2027-02): ...`.
5. **Categoría que no se puede evaluar** (sin paquete en el compromiso, categoría no reconocida o muestra insuficiente): el indicador nunca sale verde. Si las demás son verdes, queda **sin evaluar**; si alguna es amarilla o roja, conserva ese color.
6. **Mediciones malformadas** (categoría distinta de `P0P1`/`P2P3` o valor no entero ≥ 0):
   - Desde M-08 la BD no deja cargarlas: el trigger `measurements_category_guard` rechaza la fila (ver [modelo de datos](modelo-datos.md#measurements--mediciones)).
   - Las que ya estaban antes, o las de un indicador que recibió categorías después, se descartan una por una con la misma regla en la evaluación mensual, en el ritmo diario y en el ritmo que ve el líder. El motivo lo dice: "N medición(es) descartada(s) por categoría o valor inválido". El mes no se anula y el ritmo se sigue calculando; el estado diario guarda el conteo en `details.discarded` (ver [`docs/operacion.md`](operacion.md)).
7. **Umbral negociado:** el verde y el amarillo negociados en un compromiso **no** se aplican a las categorías.

Ejemplo de la semilla (Unidad Alfa, febrero de 2027). Paquete P0/P1 1500 + 200 detectadas en febrero = 1700 → meta de febrero 1134. P2/P3 500 → meta 334. Resueltas: P0/P1 1050 (92,6 %, amarillo) y P2/P3 350 (verde). Color del indicador: **amarillo**.

Estas reglas (peor color, valor de la peor categoría, sin overrides por categoría, sin verde con una categoría sin evaluar) son valores por defecto mientras no se responda Q-07.

Los indicadores de meta acumulada **sin** categorías siguen usando `targets`. La gestora carga esas metas en **Metas** (`#/gestora/metas`); VULN no aparece en esa pantalla.

## 7. Candados (escalada)

El candado depende de cuántos meses seguidos lleva la unidad fuera de verde dentro del **trimestre calendario** y del color del último mes.

| Situación | Candado | En pantalla | Restricciones |
|---|---|---|---|
| Mes en verde, sin evaluar o sin meses | Normal | Operación normal | ninguna |
| Mes 1 en amarillo o rojo | Restringido | Restringida | No se inicia change nuevo · No se agrega al backlog · Capacidad dedicada al RUN |
| Mes 2 o 3 seguido, en rojo | Congelado | Congelada | Se frena todo el change · Toda la capacidad va al RUN |
| Mes 2 o 3 seguido, en amarillo | Restringido (por defecto, Q-03) | Restringida | Igual que el mes 1 |
| Excepción "todo" vigente | Excepción | En excepción | ninguna |

Reglas de conteo:

- Un mes **verde** corta la racha. Un mes **sin evaluar** también ([ADR 0003](adr/0003-reglas-escalada.md)).
- La racha **no cruza trimestres**: abril es "mes 1" aunque marzo cerrara en rojo. Lo que se arrastra es el pendiente, no el candado.
- El candado depende del último mes: tras dos meses en rojo, un tercero en amarillo baja a restringido.

Ejemplos (trimestre enero–marzo):

- Enero amarillo → restringida.
- Enero amarillo, febrero rojo → congelada.
- Enero rojo, febrero amarillo → restringida (con Q-03 en su valor por defecto).
- Enero rojo, febrero verde, marzo rojo → restringida (marzo es mes 1 otra vez).

**Q-03.** Mientras no se responda, amarillo en mes 2 o 3 no congela. Es configurable en un solo punto (`YELLOW_MONTH2_ESCALATES_LIKE_RED` en `engine/lock.js`, que usan la evaluación mensual y los tableros).

### Excepciones del comité

El comité las aprueba en **Excepciones** (`#/comite/excepciones`, ver [manual del comité](manual-comite.md)). Dos alcances:

- **Suspende todas las restricciones (`all`):** la unidad queda "En excepción", sin restricciones.
- **Inicio puntual de change (`change_start`):** autoriza iniciar un change concreto (se indica su referencia).
  - Con la unidad **restringida**, quita "No se inicia change nuevo".
  - Con la unidad **congelada**, no levanta el congelamiento. El motor la reporta como inicio puntual autorizado. Ese dato no se guarda en la evaluación; los tableros lo muestran en el candado de hoy como "Inicio autorizado: REF", con la unidad todavía "Congelada".

Vigencia:

- Vigente hasta la fecha de vencimiento **incluida** (America/Guayaquil). Máximo 90 días desde que se crea.
- Al día siguiente se ignora.
- El candado guardado (el oficial del cierre) solo lo recalcula la evaluación mensual. Una excepción aprobada, vencida o revocada a mitad de mes se refleja en él en el siguiente cierre o al reprocesar el mes.
- El **candado vigente hoy** de los tableros (comité: columna "Candado hoy"; líder: "Candado vigente hoy") se calcula al abrir la pantalla con `lockToday` del motor: el último cierre global guardado (del mes en curso o del anterior) y las excepciones tal como están hoy. Así una excepción aprobada o revocada hoy se ve hoy. No guarda nada ni envía alertas. Si no hay cierre del mes en curso ni del anterior, muestra "Sin cierre vigente"; pasa cada día 1 hasta que corre la evaluación mensual (06:07 Guayaquil).
- Una excepción **revocada** deja de aplicar desde el día de la revocación.
- El ritmo diario genera una alerta `exception_expired` el día que vence y otra cuando ya venció. El vencimiento queda en `audit_log`. Las revocadas no generan esta alerta.
