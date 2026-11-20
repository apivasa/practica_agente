# Manual del comité de delivery

Qué ve y qué puede hacer el comité en la app. Solo describe lo que está construido (2026-11-19).

> La app todavía no está publicada en GitHub Pages (V-05). Hoy se usa en local; ver [README](../README.md#correr-en-local). En local entra con `comite@example.test`.

## Tu rol

Ves todas las unidades, recibes las alertas y apruebas excepciones a los candados.

## Entrar

1. Abre la app y entra con tu correo y contraseña en **Iniciar sesión**.
2. La app te lleva a `#/comite`.

Si tienes más de un rol, eliges en `#/inicio`. En la barra superior tienes **Cambiar de rol** y **Cerrar sesión**.

## Menú

| Pantalla | Ruta |
|---|---|
| Inicio (matriz, excepciones vigentes y alertas) | `#/comite` |
| Excepciones | `#/comite/excepciones` |

### Inicio (`#/comite`)

**Mes.** Elige el mes en el selector. Ofrece los meses ya evaluados y el mes en curso. Por defecto muestra el más reciente evaluado.

**Matriz unidad × indicador.** Una fila por unidad:
- **Color de la unidad:** el peor de sus indicadores evaluados.
- **Escalada:** el candado que guardó la evaluación mensual del mes elegido, con sus restricciones (ver abajo).
- **Candado hoy:** el candado vigente hoy (ver "Candado hoy" más abajo).
- Una columna por indicador (código en la cabecera; el nombre aparece al pasar el cursor). Cada celda trae el color y el valor. Al pasar el cursor ves el motivo del color.

Salen los indicadores activos más los que tuvieron evaluación ese mes.

**Candado hoy.** Usa el último cierre mensual guardado y las excepciones tal como están hoy (America/Guayaquil). No depende del mes elegido en el selector. Muestra:
- El nivel (**Operación normal**, **Restringida**, **Congelada** o **En excepción**) y sus restricciones.
- "Inicio autorizado: REF" por cada inicio puntual vigente con la unidad congelada. La unidad sigue "Congelada". Si la excepción no tiene referencia, dice "Inicio autorizado: sin referencia".
- Debajo, la base del cálculo: "Según el cierre de AAAA-MM y las excepciones vigentes al AAAA-MM-DD".

Una excepción que apruebas o revocas hoy se ve hoy en esta columna, tras recargar la página. Esta columna no guarda nada ni envía alertas: el candado oficial sigue siendo el del cierre (columna **Escalada**).

Avisos posibles en lugar del nivel:
- "Sin cierre vigente: no hay evaluación mensual de AAAA-MM ni de AAAA-MM": no hay cierre del mes en curso ni del anterior. Pasa cada día 1 desde las 00:00 hasta que corre la evaluación mensual (06:07 Guayaquil), o más si esa evaluación falla o se retrasa.
- "No se pudo calcular el candado de hoy con los datos guardados": algún dato guardado de la unidad no es válido.

**Excepciones vigentes.** Tabla con Unidad, Alcance, Motivo, Ref. de change y Vence. El alcance se lee **Inicio puntual de change** o **Suspende todas las restricciones**, igual que en la pantalla Excepciones. Debajo, el enlace **Aprobar o revocar una excepción** lleva a `#/comite/excepciones`.

**Alertas recientes.** Tus últimas 30 alertas, la más reciente arriba, con el contador "Sin leer: N".
- Cada alerta muestra el tipo, la fecha y hora de envío y el mensaje.
- Las de severidad alta (color rojo o unidad congelada) van resaltadas.
- **Marcar como leída** la pasa a leída.

Tipos de alerta:

| Tipo | Cuándo llega |
|---|---|
| Cambio de color | Al cerrar un mes, si cambia el color de la unidad o su candado. |
| Atraso frente al ritmo | Cuando una unidad pasa de "al día" a "atrasada" en vulnerabilidades. |
| Ingreso de P0/P1 | Cuando entran P0/P1 nuevas que cambian la meta del trimestre. |
| Vencimiento de excepción | El día que vence una excepción y cuando ya venció. |

Las alertas solo se ven dentro de la app. No hay correo ni otro canal externo todavía (C-05, espera Q-04). Hoy se generan solo en local: la evaluación programada se activa en producción después del despliegue (V-05).

### Excepciones (`#/comite/excepciones`)

**Aprobar una excepción.**
1. Elige la **Unidad**.
2. Elige el **Alcance**:
   - **Inicio puntual de change:** autoriza iniciar un change concreto. Escribe su identificador en **Change autorizado** (obligatorio, hasta 200 caracteres).
   - **Suspende todas las restricciones:** la unidad queda "En excepción" mientras esté vigente.
3. Escribe el **Motivo** (obligatorio, hasta 2000 caracteres).
4. Elige **Vence el**: desde hoy y como máximo 90 días. El día de vencimiento cuenta como vigente.
5. Pulsa **Aprobar excepción**.

Si falta algo, el error aparece junto al campo. Si la BD rechaza la excepción, ves "La excepción no cumple las reglas: ...".

**Excepciones registradas.** Todas las del comité, de todas las unidades: primero las vigentes (la más próxima a vencer arriba), luego vencidas y revocadas. Columnas: Unidad, Alcance, Change, Motivo, Vence, Estado (**Vigente**, **Vencida** o **Revocada** con su fecha), Aprobó (**Tú** u **Otro miembro del comité**) y Acción.

**Revocar.** El botón **Revocar** solo aparece en las vigentes que aprobaste tú. La excepción deja de aplicar desde ese día. No se borra: queda en la lista como revocada. En las de otro miembro ves "Solo quien la aprobó puede revocarla".

Hoy la pantalla no permite editar una excepción ya aprobada (cambiar motivo o vencimiento). Para terminarla antes, revócala.

## Cómo leer colores y candados

Colores (siempre con texto): **Verde**, **Amarillo**, **Rojo**, **Sin evaluar**. Sin evaluar significa que faltan datos, falta la meta o no se alcanzó el mínimo de muestra.

Candados de la unidad:

| En pantalla | Cuándo | Restricciones que muestra |
|---|---|---|
| Operación normal | Mes verde o sin evaluar | — |
| Restringida | Mes 1 fuera de verde; o mes 2–3 en amarillo | No se inicia change nuevo · No se agrega al backlog · Capacidad dedicada al RUN |
| Congelada | Mes 2 o 3 seguido en rojo | Se frena todo el change · Toda la capacidad va al RUN |
| En excepción | Excepción "todo" vigente | — |
| Sin evaluación | La unidad no tiene evaluación ese mes | — |

- La racha se cuenta dentro del trimestre calendario. Un mes verde o sin evaluar la corta.
- Una excepción de inicio puntual con la unidad restringida quita "No se inicia change nuevo". Con la unidad congelada no la descongela: sigue "Congelada" y la columna **Candado hoy** agrega "Inicio autorizado: REF".
- La columna **Escalada** es el candado que guardó la evaluación mensual de ese mes. Una excepción que apruebas o revocas hoy no la cambia hasta el siguiente cierre mensual o un reproceso del mes. La columna **Candado hoy** sí la refleja el mismo día.

Reglas completas: [docs/indicadores.md, sección 7](indicadores.md#7-candados-escalada).

## Qué no puedes hacer desde la app (hoy)

- Cambiar a mano el candado de una unidad: lo calcula la evaluación.
- Editar indicadores, compromisos o mediciones.
- Ver las alertas dirigidas a otras personas desde la pantalla (la bandeja muestra solo las tuyas).
