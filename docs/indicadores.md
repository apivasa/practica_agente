# Indicadores y candados

Guía para la gestora de KPIs y el comité de delivery. Explica cómo se describe un indicador, cómo se calcula su color y qué candado recibe una unidad.

> **Estado actual (2026-11-19).** Lo que se describe aquí es el **motor de cálculo** (`engine/`), ya construido y probado. Todavía no hay pantallas para dar de alta indicadores (M-02), registrar compromisos (M-03), cargar mediciones (M-04) ni aprobar excepciones (C-02). Tampoco existe el cálculo mensual automático (C-03) ni las alertas (C-04). Los ejemplos muestran la configuración tal como la recibe el motor. Detalle técnico: [`engine/README.md`](../engine/README.md) y [`engine/ESCALATION.md`](../engine/ESCALATION.md).

## 1. Los 7 atributos de un indicador

Cualquier indicador, incluso uno que no existe hoy, se describe con estos 7 atributos. No hace falta programar nada para un indicador nuevo.

| # | Atributo | Campo | Valores | Por defecto |
|---|---|---|---|---|
| 1 | Tipo de medición | `measurementType` | `window_average` (promedio en ventana), `coverage` (cobertura), `cumulative_target` (meta acumulada) | obligatorio |
| 2 | Sentido | `direction` | `higher_is_better` (más es mejor), `lower_is_better` (menos es mejor) | obligatorio |
| 3 | Ventana de cálculo | `windowDays` | entero mayor que 0, en días | 30 |
| 4 | Umbrales | `thresholds`, `thresholdsByCategory` | `{ green, yellow }`, opcionalmente por categoría | obligatorio |
| 5 | Frecuencia | `frequency` | `monthly`, `weekly`, `quarterly` | `monthly` |
| 6 | Mínimo de muestra | `minSample` | entero mayor o igual que 0 | 0 |
| 7 | Fuente de datos | `source` | `manual`, `automatic` | `manual` |

Notas:

- **Umbrales.** Se dan dos límites: `green` y `yellow`. Rojo es todo lo que queda peor que amarillo.
  - Con "más es mejor", verde debe ser mayor o igual que amarillo.
  - Con "menos es mejor", verde debe ser menor o igual que amarillo.
  - Si no se cumple, el motor rechaza el indicador con un mensaje en español.
- **Umbrales por categoría.** Si una categoría tiene umbrales propios, se usan esos. Si no, se usan los generales.
- **Frecuencia y fuente** hoy solo se validan. Las usarán el cálculo programado (C-03) y la captura de datos (M-04).
- **Custodio.** Lo asigna la gestora en la tabla de indicadores (M-02). No es parte del motor.

### Cómo se calcula el valor según el tipo

La ventana incluye el día de evaluación y los `windowDays - 1` días anteriores. Las mediciones fuera de la ventana no cuentan.

- **Promedio en ventana:** promedio de los valores de la ventana. Los valores negativos o no numéricos se ignoran.
- **Cobertura:** % de aplicaciones distintas que cumplen. De cada aplicación cuenta solo su **última** medición en la ventana.
- **Meta acumulada:** suma de lo resuelto × 100 / meta del periodo.
  - Meta 0: el resultado es 100 % (no había nada que resolver).
  - Sin meta registrada: queda **sin evaluar** ("falta la meta del periodo").
  - El resultado puede pasar de 100 %; eso no cambia el color.

## 2. Ejemplos

Los umbrales de estos ejemplos son ilustrativos. Los reales los fija la gestora y los negocia cada custodio (Q-01 sigue abierta).

### Disponibilidad (promedio en ventana, más es mejor)

```js
{
  measurementType: 'window_average',
  direction: 'higher_is_better',
  windowDays: 30,
  thresholds: { green: 99.9, yellow: 99.5 },
  frequency: 'monthly',
  source: 'manual',
}
```

Mediciones de noviembre: 99,95 · 99,80 · 99,95. Promedio 99,9 → **verde** (empate con el umbral verde).

### MTTR (promedio en ventana, menos es mejor, con mínimo de muestra)

```js
{
  measurementType: 'window_average',
  direction: 'lower_is_better',
  windowDays: 30,
  thresholds: { green: 4, yellow: 8 }, // horas
  minSample: 3,                         // al menos 3 incidentes
}
```

- 2 incidentes (3 h y 6 h): **sin evaluar**, "Muestra insuficiente: 2 de 3 requeridas".
- 3 incidentes (3 h, 6 h y 9 h): promedio 6 h → **amarillo** (más de 4, hasta 8).

### Cobertura de observabilidad (cobertura, más es mejor)

```js
{
  measurementType: 'coverage',
  direction: 'higher_is_better',
  windowDays: 30,
  thresholds: { green: 90, yellow: 75 }, // % de aplicaciones
}
```

Cuatro aplicaciones en la ventana. La app A no cumplía el día 3 pero sí el día 20: cuenta lo último, cumple. B y C cumplen, D no. Resultado: 3 de 4 = 75 % → **amarillo** (empate con el umbral amarillo).

### Vulnerabilidades (meta acumulada por criticidad)

El diseño fija el cumplimiento por criticidad: **96 % para P0/P1** y **85 % para P2/P3**. Los límites amarillos (90 y 70) son de ejemplo.

```js
{
  measurementType: 'cumulative_target',
  direction: 'higher_is_better',
  windowDays: 90, // el trimestre
  thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: {
    'P0/P1': { green: 96, yellow: 90 },
    'P2/P3': { green: 85, yellow: 70 },
  },
}
```

Cada medición lleva su categoría (`P0/P1` o `P2/P3`). Al calcular se elige una categoría y solo cuentan sus mediciones.

- P0/P1: resueltas 100 + 80 + 12 = 192 de una meta de 200 → 96 % → **verde**.
- P0/P1 con 180 de 200 → 90 % → **amarillo**. El mismo 90 % en P2/P3 sería verde.
- P2/P3: resueltas 900 + 800 = 1.700 de 2.000 → 85 % → **verde**.
- Sin meta del periodo → **sin evaluar**.

Todavía no está construido el resto del caso (M-05): el ritmo esperado (pendiente / semanas restantes) y la meta parcial mensual. El arrastre al cierre sí existe (ver sección 4).

## 3. Cómo se decide el color

1. Si no hay datos en la ventana → **sin evaluar**.
2. Si falta la meta (meta acumulada) → **sin evaluar**.
3. Si la muestra es menor que el mínimo → **sin evaluar**.
4. Si no, se compara con los umbrales (de la categoría, si tiene):
   - Alcanza el umbral verde → **verde**.
   - Alcanza el umbral amarillo → **amarillo**.
   - Si no → **rojo**.

**Empates.** Un valor igual al umbral recibe el color mejor. 96 % con verde en 96 es verde. 8 h con amarillo en 8 es amarillo, no rojo. El motor tolera las diferencias mínimas de redondeo del cálculo: un promedio que da 99,89999999999999 cuenta como 99,9.

Cada color viene con un motivo en español, por ejemplo `Valor 6 <= amarillo 8`.

### Color de la unidad

El color de la unidad en un mes es el **peor** de sus indicadores evaluados (rojo peor que amarillo, amarillo peor que verde). Los indicadores sin evaluar no cuentan. Si ninguno se pudo evaluar, la unidad queda sin evaluar.

## 4. Candados (escalada)

El candado depende de cuántos meses seguidos lleva la unidad fuera de verde dentro del **trimestre calendario** y del color del último mes.

| Situación | Candado | Qué significa |
|---|---|---|
| Mes en verde, sin evaluar o sin meses | **Normal** | Operación normal. |
| Mes 1 en amarillo o rojo | **Restringido** | No se inicia change nuevo ni se agrega al backlog. Se continúa lo planeado del trimestre y se prioriza el RUN. |
| Mes 2 o 3 seguido, en rojo | **Congelado** | Se frena todo el change. Toda la capacidad va al RUN. |
| Mes 2 o 3 seguido, en amarillo | **Restringido** (por defecto) | Igual que el mes 1. Ver Q-03. |

Reglas de conteo:

- Un mes **verde** corta la racha: el siguiente mes fuera de verde vuelve a ser "mes 1".
- Un mes **sin evaluar** también corta la racha (decisión revisable, [ADR 0003](adr/0003-reglas-escalada.md)).
- La racha **no cruza trimestres**: abril es "mes 1" aunque marzo cerrara en rojo. Lo que se arrastra al trimestre siguiente es el pendiente, no el candado.
- El candado depende del último mes. Si tras dos meses en rojo el tercero es amarillo, se baja de congelado a restringido.

Ejemplos (trimestre enero–marzo):

- Enero amarillo → restringido.
- Enero amarillo, febrero rojo → congelado.
- Enero rojo, febrero amarillo → restringido (con Q-03 en su valor por defecto).
- Enero rojo, febrero verde, marzo rojo → restringido (marzo es mes 1 otra vez).

### Q-03: amarillo en el mes 2

El diseño no dice si un amarillo en el mes 2 congela como un rojo. Está abierta como pregunta Q-03. Mientras no se responda:

- **Por defecto:** amarillo en mes 2 o 3 mantiene la restricción del mes 1. No congela.
- Es una opción de configuración (`yellowMonth2EscalatesLikeRed`). Si se activa, amarillo en mes 2 o 3 congela igual que rojo.

### Excepciones del comité

El comité puede aprobar una excepción con fecha de vencimiento. Hay dos alcances:

- **Todo (`all`):** suspende el candado completo. La unidad queda en estado **excepción**, sin restricciones. El resultado guarda qué restricciones quedaron suspendidas.
- **Inicio de change (`change_start`):** permite iniciar change estando **restringido**. No levanta un **congelado**.

Si hay una de cada alcance vigentes, manda la de alcance "todo".

Vigencia:

- Está vigente hasta su fecha de vencimiento **incluida** (fecha de America/Guayaquil).
- Al día siguiente se ignora y el candado vuelve. El resultado lista las excepciones vencidas para que se puedan auditar y alertar.

Ejemplo: enero amarillo, febrero rojo (congelado). Con una excepción "todo" que vence el 15 de marzo, el 1 de marzo la unidad queda en excepción. Desde el 16 de marzo vuelve a congelado.

Lo que todavía no existe: registrar el motivo, aprobar desde la app y la visibilidad para todo el comité (C-02).

### Arrastre al cierre del trimestre (vulnerabilidades)

- Las P0/P1 nuevas de los meses 1 y 2 se suman al paquete del trimestre.
- Las P0/P1 nuevas del mes 3 pasan al paquete siguiente.
- Lo no resuelto al cierre también pasa al paquete siguiente.

Ejemplo del diseño: paquete de 2.000. Entran 120 P0/P1 en enero, 80 en febrero y 40 en marzo.

- Paquete efectivo del trimestre: 2.000 + 120 + 80 = **2.200**.
- Se resuelven 2.100. Pasan al siguiente: (2.200 − 2.100) + 40 = **140**.
- Si se resuelve más que el paquete, el pendiente no baja de 0; solo pasan las del mes 3.
