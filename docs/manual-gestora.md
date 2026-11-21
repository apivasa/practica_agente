# Manual de la gestora de KPIs

Qué ve y qué puede hacer la gestora de KPIs en la app. Solo describe lo que está construido (2026-11-20).

> La app está publicada en https://apivasa.github.io/practica_agente/ desde el 2026-11-20 (V-05), pero todavía no tiene usuarios reales: el alta espera la fase B del pentest con roles (ADR 0015). Hoy se usa en local; ver [README](../README.md#correr-en-local). En local entra con `gestora@example.test`.

## Tu rol

Defines las reglas de juego: das de alta los indicadores, les asignas custodio y vigilas que cada mes estén los datos listos para el comité.

## Entrar

1. Abre la app. Si no tienes sesión, ves **Iniciar sesión** (`#/login`).
2. Escribe tu correo y tu contraseña y pulsa **Entrar**.
3. La app te lleva a `#/gestora`.

- Si el correo o la contraseña no son correctos, ves "Correo o contraseña incorrectos." El mensaje no dice cuál de los dos falló.
- No hay registro abierto ni recuperación de contraseña en la app.
- Si también tienes otro rol (por ejemplo, custodio), primero ves **Elige con qué rol entrar** (`#/inicio`). En la barra superior tienes **Cambiar de rol** y **Cerrar sesión**.
- Si intentas abrir una ruta de otro rol, la app te devuelve a la tuya.
- Una cuenta sin rol ve **Sin acceso** (`#/sin-rol`) con el aviso "Tu cuenta no tiene un rol asignado. Pide a la gestora de KPIs que te asigne uno." Asignar roles no se hace desde la app (ver abajo).

## Menú

| Pantalla | Ruta |
|---|---|
| Inicio | `#/gestora` |
| Indicadores | `#/gestora/indicadores` |
| Completitud | `#/gestora/completitud` |
| Metas | `#/gestora/metas` |

### Inicio (`#/gestora`)

Muestra el nombre del rol y un texto con lo que haces en la app. No tiene datos: usa el menú para ir a Indicadores, Completitud o Metas.

### Indicadores (`#/gestora/indicadores`)

**Lista.** Tabla con Código, Nombre, Tipo, Estado (Activo o Inactivo), Custodio y Acciones.

**Crear un indicador.**
1. Pulsa **Nuevo indicador**.
2. Llena los 7 atributos: Tipo de medición, Sentido, Ventana (días), Umbral verde, Umbral amarillo, Frecuencia, Mínimo de muestra y Fuente. Ver [docs/indicadores.md](indicadores.md) para el significado de cada uno.
3. Llena Código (único, ej. `CHG-FAIL`), Nombre y, si quieres, Descripción.
4. Opcional: **Agregar categoría** para umbrales por categoría (nombre, verde, amarillo). **Quitar** elimina una fila. Para vulnerabilidades usa `P0P1` y `P2P3`.
5. Elige el **Custodio** o deja "Sin custodio".
6. Marca o desmarca **Activo**.
7. Pulsa **Guardar indicador**. **Cancelar** cierra el formulario sin guardar.

Si algo no cuadra, ves la lista de errores arriba del formulario. Por ejemplo: "Umbral verde: obligatorio" o umbrales incoherentes con el sentido. Una meta acumulada con "Menos es mejor" se rechaza: "Sentido: una meta acumulada (cumulative_target) solo admite higher_is_better (más es mejor)".

Cada umbral, general o por categoría, debe ser menor que 2^53 (9007199254740992) en valor absoluto (M-13). Si no, ves por ejemplo "Umbral verde: fuera de rango, debe ser menor que 2^53 (9007199254740992) en valor absoluto" o "Umbral de la categoría P0P1.green: fuera de rango, …", y no se guarda. Escribe los números sin notación exponencial: `1e20` da "debe ser un número".

**Editar.** Pulsa **Editar** en la fila. El formulario se abre con los valores actuales.

**Activar o desactivar.** Pulsa **Desactivar** o **Activar** en la fila. Un indicador inactivo no entra en la evaluación mensual ni en el tablero de completitud. No se borra nada.

**Custodio.**
- Al guardar, el custodio elegido recibe los permisos sobre ese indicador y se quitan los del anterior.
- El selector solo muestra usuarios que ya tienen al menos un rol de custodio. Se identifican por los códigos que custodian y un fragmento de su identificador, no por correo (la app no expone correos).
- Dar el primer rol de custodio a un usuario nuevo no se hace desde la app: es parte del alta de usuarios.
- Si ves "(permisos incoherentes: vuelve a guardar el custodio)", el custodio que se muestra y los permisos reales no coinciden. Abre **Editar** y pulsa **Guardar indicador**.

### Completitud (`#/gestora/completitud`)

Te dice qué datos faltan para el comité del mes.

1. Elige el **Mes a evaluar**: el mes en curso o el anterior.
2. Por cada custodio ves un bloque "<custodio>: N % cargado" y una tabla por KPI:
   - **Unidades con datos:** "X de Y".
   - **% cargado:** en verde si es 100 %, resaltado si falta algo.
   - **Faltan:** nombres de las unidades sin datos, o "Completo".
3. Los indicadores sin custodio salen agrupados como "Sin custodio".

Una unidad cuenta como cargada para un KPI si tiene al menos una medición con fecha dentro del mes. Solo cuentan los indicadores activos.

### Metas (`#/gestora/metas`)

Cargas la meta mensual de los indicadores de **meta acumulada sin categorías**. Sin meta del mes, ese indicador queda **Sin evaluar**.

- Solo aparecen los indicadores activos de meta acumulada sin umbrales por categoría.
- VULN no aparece: tiene categorías y su meta sale del paquete trimestral (ver [docs/indicadores.md](indicadores.md#color-mensual)).
- Si no hay ninguno, ves "No hay indicadores activos de meta acumulada sin categorías…".

**Elegir qué ver.**
1. Elige el **Indicador**.
2. Escribe el **Mes** con formato `AAAA-MM`. Por defecto es el mes en curso. Un formato inválido muestra "Mes: usa el formato AAAA-MM (ej. 2026-10)".

**Tabla del mes.** Una fila por unidad:

| Columna | Qué muestra |
|---|---|
| Unidad | Nombre de la unidad. |
| Paquete del trimestre | `Paquete total` del compromiso trimestral (`AAAA-Qn`) de la unidad, o "—" si no hay. |
| Meta acumulada del mes | La meta guardada, o "Sin meta". |
| Color con la meta | Verde, Amarillo, Rojo o Sin evaluar. |
| Motivo | Por qué salió ese color. |
| Acciones | **Editar** carga la unidad y su meta en el formulario. |

El color es una **vista previa**: usa la misma regla que la evaluación mensual. El color oficial lo guarda la evaluación programada al cerrar el mes.

**Registrar o editar una meta.**
1. Elige la **Unidad** (o pulsa **Editar** en su fila).
2. Escribe la **Meta acumulada del mes**: lo que debe estar resuelto desde el día 1 del trimestre hasta el cierre del mes. Número ≥ 0; acepta decimales.
3. Opcional: pulsa **Proponer un tercio** (ver abajo).
4. Pulsa **Guardar meta**. Ves "Meta de <unidad> para <mes> guardada: <valor>." y la tabla se recalcula.

Si ya hay meta para esa unidad y mes, se actualiza su valor. No se crea una segunda. Una meta no se puede mover a otra unidad o a otro mes: para eso registra una meta nueva con esa unidad y ese mes.

**Proponer un tercio.** Calcula la meta desde el paquete del compromiso trimestral de la unidad (P):

| Mes del trimestre | Propuesta (acumulada) |
|---|---|
| 1 | ceil(P/3) |
| 2 | ceil(2P/3) |
| 3 | P |

Ejemplo: P = 100 → 34, 67 y 100. La propuesta nunca supera P: con un paquete decimal, como P = 0,5, propone 0,5 en los tres meses. Es la misma regla que usa el motor para vulnerabilidades. La propuesta solo llena el campo: tienes que pulsar **Guardar meta**.

Si la unidad no tiene compromiso trimestral, ves "<unidad>: Sin compromiso trimestral (AAAA-Qn) para proponer la meta.". Si el compromiso no tiene paquete, el aviso lo dice.

Errores frecuentes:
- "Meta acumulada del mes: es obligatoria".
- "Meta acumulada del mes: debe ser un número mayor o igual que 0".
- "Meta acumulada del mes: el valor es demasiado grande".

**Meta de un mes ya cerrado.** Puedes guardar la meta de cualquier mes. Si el mes ya se evaluó, la evaluación guardada no cambia sola: hay que reprocesar ese mes (ver [docs/operacion.md](operacion.md)). Si cargas la meta antes del día 1 del mes siguiente, no hace falta.

Todo alta o cambio de meta queda en `audit_log`. Solo la gestora puede crear o editar metas: la BD lo impide a los otros roles.

## Qué no puedes hacer desde la app (hoy)

- Cargar mediciones o compromisos. Eso es del custodio. Si necesitas corregir datos, pide el rol de custodio del indicador.
- Borrar una meta mensual. Solo se crea o se edita su valor.
- Cambiar la unidad, el indicador o el mes de una meta ya creada.
- Crear usuarios ni asignar roles de líder o comité.
- Ver la bandeja de alertas ni aprobar excepciones: son del comité y del líder.

## Cómo leer los colores

El color siempre va con su texto: **Verde**, **Amarillo**, **Rojo** o **Sin evaluar**. El detalle de cómo se calcula está en [docs/indicadores.md](indicadores.md#5-cómo-se-decide-el-color).
