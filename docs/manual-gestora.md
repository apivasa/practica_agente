# Manual de la gestora de KPIs

Qué ve y qué puede hacer la gestora de KPIs en la app. Solo describe lo que está construido (2026-11-20).

> La app todavía no está publicada en GitHub Pages (V-05). Hoy se usa en local; ver [README](../README.md#correr-en-local). En local entra con `gestora@example.test`.

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

### Inicio (`#/gestora`)

Muestra el nombre del rol y un texto con lo que haces en la app. No tiene datos: usa el menú para ir a Indicadores o Completitud.

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

## Qué no puedes hacer desde la app (hoy)

- Cargar mediciones o compromisos. Eso es del custodio. Si necesitas corregir datos, pide el rol de custodio del indicador.
- Cargar las metas mensuales (`targets`). No hay pantalla. Vulnerabilidades no las necesita: su meta sale del paquete trimestral (M-06). Solo las usaría un indicador de meta acumulada sin categorías.
- Crear usuarios ni asignar roles de líder o comité.
- Ver la bandeja de alertas ni aprobar excepciones: son del comité y del líder.

## Cómo leer los colores

El color siempre va con su texto: **Verde**, **Amarillo**, **Rojo** o **Sin evaluar**. El detalle de cómo se calcula está en [docs/indicadores.md](indicadores.md#5-cómo-se-decide-el-color).
