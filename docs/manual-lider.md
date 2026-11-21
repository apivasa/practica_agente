# Manual del líder de unidad

Qué ve y qué puede hacer un líder de unidad en la app. Solo describe lo que está construido (2026-11-20).

> La app está publicada en https://apivasa.github.io/practica_agente/ desde el 2026-11-20 (V-05), pero todavía no tiene usuarios reales: el alta espera la fase B del pentest con roles (ADR 0015). Hoy se usa en local; ver [README](../README.md#correr-en-local). En local: `lider1@example.test` (Unidad Alfa), `lider2` (Beta) o `lider3` (Gamma).

## Tu rol

Ves solo los datos de tu unidad: tus indicadores, su color, tu meta mensual, tu avance y tus restricciones activas. Recibes alertas. No ves otras unidades: la base de datos no te las entrega.

## Entrar

1. Abre la app y entra con tu correo y contraseña en **Iniciar sesión**.
2. La app te lleva a `#/lider`.

Si tienes más de un rol, eliges en `#/inicio`. En la barra superior tienes **Cambiar de rol** y **Cerrar sesión**.

## Tu pantalla (`#/lider`)

Es una sola pantalla. Arriba dice "Unidades a tu cargo: N". De arriba abajo:

**1. Filtros.**
- **Unidad:** solo aparece si lideras más de una.
- **Mes:** los meses ya evaluados y el mes en curso. Por defecto, el más reciente evaluado.

**2. Resumen de la unidad** ("<unidad> · <mes>").
- **Color de la unidad:** el peor de tus indicadores evaluados ese mes.
- **Restricciones del cierre de AAAA-MM:** el candado que guardó la evaluación mensual del mes elegido y su lista de restricciones (ver "Cómo leer los candados").
- **Candado vigente hoy:** el candado de hoy, con el último cierre mensual guardado y las excepciones tal como están hoy (America/Guayaquil). No depende del mes elegido. Muestra el nivel y sus restricciones; "Inicio autorizado: REF" por cada inicio puntual vigente con la unidad congelada ("sin referencia" si no tiene); y debajo, la base: "Según el cierre de AAAA-MM y las excepciones vigentes al AAAA-MM-DD".
  - "Sin cierre vigente: no hay evaluación mensual de AAAA-MM ni de AAAA-MM": no hay cierre del mes en curso ni del anterior. Pasa cada día 1 desde las 00:00 hasta que corre la evaluación mensual (06:07 Guayaquil), o más si esa evaluación falla o se retrasa.
  - "No se pudo calcular el candado de hoy con los datos guardados": algún dato guardado de tu unidad no es válido.

**3. Mis indicadores** (avance al <fecha>). Una fila por indicador:

| Columna | Qué muestra |
|---|---|
| Indicador | Código y nombre |
| Color | Color del mes y, debajo, el motivo. "Sin evaluación para este mes" si no hay cierre. |
| Valor | El valor calculado en el cierre del mes |
| Meta del mes | En vulnerabilidades: la meta acumulada del mes por criticidad, por ejemplo "Meta acumulada de 2027-02: P0/P1 1134 · P2/P3 334" (sale del paquete del trimestre). Sin paquete: "Sin meta mensual para <mes>". En otros de meta acumulada: "Meta acumulada de <mes>: N". En el resto: "Verde ≥ X; amarillo ≥ Y" (o ≤ si menos es mejor), con "(compromiso)" si es un umbral negociado con tu unidad |
| Avance vs. ritmo | Solo en vulnerabilidades: **Al día** o **Atrasada** con el detalle. "No aplica" en los demás. Si falta el paquete del trimestre, lo dice. |

La fecha del avance es hoy si miras el mes en curso, o el último día del mes si miras uno pasado.

**4. Excepciones vigentes de mi unidad.** Unidad, Alcance, Motivo, Ref. de change y Vence. "No hay excepciones vigentes." si no hay.

**5. Mis alertas.** Tus últimas 50 alertas con "Sin leer: N". Cada una con tipo, fecha y mensaje. Las de severidad alta van resaltadas. **Marcar como leída** la pasa a leída.

| Tipo | Qué significa |
|---|---|
| Cambio de color | Cambió el color de tu unidad o su candado al cerrar el mes. |
| Atraso frente al ritmo | Tu unidad pasó a ir atrasada en vulnerabilidades. |
| Ingreso de P0/P1 | Entraron P0/P1 nuevas que cambian la meta del trimestre. |
| Vencimiento de excepción | Una excepción de tu unidad vence hoy o ya venció. |

Las alertas solo se ven en la app; no hay correo todavía.

## Cómo leer los colores

- **Verde:** cumple el umbral verde.
- **Amarillo:** no llega a verde pero sí a amarillo.
- **Rojo:** peor que amarillo.
- **Sin evaluar:** faltan datos en la ventana, falta la meta del mes o no hay muestra suficiente. No cuenta para el color de la unidad.

En vulnerabilidades, P0/P1 y P2/P3 tienen cada una su color. El indicador toma el **peor** de los dos, y el motivo muestra los dos porcentajes.

Un valor justo en el umbral recibe el color mejor.

## Cómo leer los candados

| En pantalla | Qué significa para tu capacidad |
|---|---|
| Operación normal | Sin restricciones. |
| Restringida | No inicias change nuevo ni agregas al backlog. Sigues con lo planeado del trimestre y priorizas el RUN. |
| Congelada | Se frena todo el change. Toda la capacidad va al RUN. |
| En excepción | El comité suspendió los candados hasta la fecha de vencimiento. |
| Sin evaluación | El mes no tiene cierre todavía. |

- Restringida: primer mes fuera de verde del trimestre, o un segundo o tercer mes seguido en amarillo.
- Congelada: segundo o tercer mes seguido en rojo dentro del trimestre.
- Un mes verde corta la racha. Cada trimestre empieza de cero, pero lo no resuelto en vulnerabilidades pasa al trimestre siguiente.

## Cómo leer las excepciones

- **Inicio puntual de change:** el comité autorizó iniciar el change indicado en "Ref. de change". Si estás restringida, puedes iniciarlo. Si estás congelada, el congelamiento sigue: "Candado vigente hoy" muestra "Congelada" con sus restricciones y, debajo, "Inicio autorizado: REF".
- **Suspende todas las restricciones:** mientras esté vigente no tienes restricciones.
- Vigente hasta la fecha de "Vence", incluida. El día siguiente vuelven los candados.
- "Restricciones del cierre de AAAA-MM" es el candado del cierre mensual: una excepción aprobada o revocada a mitad de mes no lo cambia hasta el siguiente cierre. "Candado vigente hoy" sí la refleja el mismo día, tras recargar la página.

## Qué no puedes hacer

- Ver otras unidades.
- Cargar mediciones, compromisos ni excepciones. Las mediciones las carga el custodio de cada indicador; las excepciones las aprueba el comité.
