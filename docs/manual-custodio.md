# Manual del custodio de indicador

Qué ve y qué puede hacer un custodio en la app. Solo describe lo que está construido (2026-11-20).

> La app está publicada en https://apivasa.github.io/practica_agente/ desde el 2026-11-20 (V-05), pero todavía no tiene usuarios reales: el alta espera la fase B del pentest con roles (ADR 0015). Hoy se usa en local; ver [README](../README.md#correr-en-local). En local: `custodio1@example.test` (VULN) o `custodio2@example.test` (AVAIL, MTTR, OBS).

## Tu rol

Eres dueño de uno o más KPIs. Negocias con cada unidad sus umbrales y compromisos, y cargas las mediciones. Solo ves y editas compromisos y mediciones **de tus indicadores**.

## Entrar

1. Abre la app y entra con tu correo y contraseña en **Iniciar sesión**.
2. La app te lleva a `#/custodio`.

Si tienes más de un rol, eliges en `#/inicio`. En la barra superior tienes **Cambiar de rol** y **Cerrar sesión**. Si intentas abrir una ruta de otro rol, vuelves a la tuya.

## Menú

| Pantalla | Ruta |
|---|---|
| Inicio | `#/custodio` |
| Compromisos | `#/custodio/compromisos` |
| Mediciones | `#/custodio/mediciones` |

En Compromisos y Mediciones solo aparecen tus indicadores **activos**. Si no tienes ninguno, ves "No custodias indicadores activos."

### Inicio (`#/custodio`)

Muestra "Indicadores a tu cargo: N" (cuenta tus asignaciones de custodio, activas o no) y un texto con lo que haces en la app. Usa el menú para ir a tus pantallas.

### Compromisos (`#/custodio/compromisos`)

1. Elige el **Indicador**.
2. Arriba ves el **Umbral general** del indicador.
3. La tabla **Compromisos y umbrales efectivos** muestra por compromiso: Unidad, Periodo, Verde, Amarillo, Origen (**Negociado** o **General**) y Paquete.

**Registrar o editar un compromiso.**
1. Elige la **Unidad**.
2. Escribe el **Periodo**: trimestre `2027-Q1` o mes `2027-03`.
3. Opcional: **Umbral verde negociado** y **Umbral amarillo negociado**. Van juntos. Vacíos = rige el general.
4. En indicadores de meta acumulada: **Paquete** por cada categoría (entero ≥ 0).
5. Opcional: **Notas** (hasta 500 caracteres).
6. Pulsa **Guardar compromiso**.

Si ya existe un compromiso para esa unidad, indicador y periodo, se actualiza. Si no, se crea. **Editar** en una fila llena el formulario con sus datos.

Los umbrales negociados, cada paquete y la suma del paquete deben ser menores que 2^53 (9007199254740992) en valor absoluto (M-13). Si no, ves por ejemplo "Paquete de P0P1: fuera de rango, …" o "Paquete total: fuera de rango, la suma debe ser …", y no se guarda.

Reglas y errores frecuentes: ver [docs/indicadores.md, sección 3](indicadores.md#3-compromisos-con-umbral-negociado).

### Mediciones (`#/custodio/mediciones`)

1. Elige el **Indicador**.
2. Abajo ves **Últimas mediciones** (las 20 más recientes): Fecha, Unidad y Dato.

**Captura manual.** Llena los campos y pulsa **Guardar medición**. Los campos cambian según el tipo:
- Promedio en ventana: Fecha, Unidad, Valor.
- Cobertura: Fecha, Unidad, Aplicación (`app_id`), Cumple.
- Meta acumulada: Fecha, Unidad, Valor (lo de ese día, no el acumulado), Categoría, Tipo (**Resuelta** o **Detectada (nueva)**).

La fecha no puede ser futura.

**Importar CSV o Excel.**
1. En **Archivo CSV o Excel (.xlsx)** elige el archivo. La pantalla te recuerda la cabecera que espera ese indicador.
2. La app lo valida sin guardar nada:
   - Con errores: ves "El archivo tiene N errores; no se guardó nada." y la lista "Fila N: ...". Corrige el archivo y vuelve a elegirlo.
   - Sin errores: ves "N filas válidas, listas para guardar." y una vista previa de hasta 50 filas.
3. Pulsa **Guardar N mediciones**. Se guardan todas o ninguna.

Formato de columnas, ejemplos y errores frecuentes: [docs/indicadores.md, sección 4](indicadores.md#4-carga-de-mediciones).

**Usar la plantilla Excel (V-07).**
1. Elige el **Indicador**.
2. Pulsa **Descargar plantilla Excel (.xlsx)**. Baja `plantilla-mediciones-<tipo>.xlsx` con la cabecera de ese tipo en la fila 1 (por ejemplo `fecha`, `unidad`, `valor`). Se genera en tu navegador.
3. Ábrela en Excel o LibreOffice y llena una medición por fila, desde la fila 2.
4. Guárdala como **Libro de Excel (.xlsx)**.
5. Impórtala como arriba, en **Archivo CSV o Excel (.xlsx)**.

Si importas la plantilla sin llenar ves "El archivo no tiene filas de datos".

**Reglas del Excel.**
- Se lee **solo la primera hoja**. Las demás se ignoran.
- Mismo formato que el CSV: mismas columnas en la fila 1, mismos valores, mismos mensajes de error y mismo "todo o nada".
- **Fecha:** una fecha de Excel o un texto `AAAA-MM-DD`. La hora se descarta. Una hora a menos de medio milisegundo de la medianoche cuenta como el día siguiente, como la muestra Excel (V-07b). No escribas la fecha como número suelto (`20261120`): se lee como fecha de Excel y se rechaza. Usa texto `2026-11-20` o formato de fecha.
- **Sin fórmulas.** Una celda con fórmula se rechaza con "Fila N: Columna X: la celda tiene una fórmula; no se aceptan fórmulas, copia y pega solo los valores". Copia la hoja y usa **Pegar valores**. Una celda con error de Excel (`#DIV/0!`, etc.) también se rechaza.
- Un texto que empieza con `=`, `+`, `-` o `@` se rechaza, igual que en el CSV.
- Un número negativo en `valor` (`-5`, `-0,5`) se rechaza con "valor: "-5" debe ser un número ≥ 0 (no se aceptan negativos ni fórmulas)". En meta acumulada dice "un entero ≥ 0". Vale igual en el CSV y en la captura manual (V-07b). Un `-` seguido de algo que no es un número simple (`-A1`, `-1+2`) sigue cayendo en el mensaje de fórmula.
- Máximo **1 MB** y **5000 filas** de datos, como el CSV. Las filas vacías no cuentan. Con 5001 filas ves el mismo mensaje del CSV: "El archivo tiene 5001 filas; el máximo es 5000". Con más, la lectura se corta en cuanto pasa del tope y ves "El archivo tiene más de 5001 filas; el máximo es 5000". Divide el archivo en partes de hasta 5000 filas.
- Si ves "El archivo Excel está dañado: es demasiado grande al descomprimirlo (supera el tamaño declarado)", una parte interna del archivo no coincide con lo que declara. Ábrelo en Excel y guárdalo de nuevo como **Libro de Excel (.xlsx)**, o expórtalo a CSV UTF-8.
- **No se aceptan** los `.xls` antiguos ni los libros con contraseña. Ves "Es un Excel antiguo (.xls) o un archivo protegido; guárdalo como libro de Excel .xlsx sin contraseña". En Excel usa *Guardar como → Libro de Excel (.xlsx)*, sin contraseña.
- **Navegador:** Chrome o Edge 103, Firefox 113 o Safari 16.4, o posteriores. En uno más antiguo ves "Este navegador no puede leer archivos Excel; usa CSV o actualiza el navegador". El CSV sigue funcionando.
- Si ves "El archivo Excel es demasiado grande al descomprimirlo" o "tiene demasiadas partes internas", quita hojas, imágenes o tablas dinámicas, o guárdalo como CSV UTF-8.

Más casos para operación: [docs/operacion.md, «Importación de mediciones desde Excel»](operacion.md#importación-de-mediciones-desde-excel-v-07-adr-0018).

**Vulnerabilidades.** Además de las resueltas, carga las P0/P1 nuevas como **Detectada**. Registra en Compromisos el paquete trimestral por `P0P1` y `P2P3`: sin él no se calcula el ritmo. Ver [sección 6](indicadores.md#6-caso-vulnerabilidades).

Desde M-08 la base de datos también revisa cada medición de un indicador de meta acumulada con categorías: la categoría debe ser `P0P1` o `P2P3` y el valor un entero ≥ 0. Desde M-09 ese entero no puede pasar de 2^53 − 1, y en cualquier indicador la BD rechaza valores `NaN` o `Infinity`. La pantalla ya valida lo mismo antes de guardar. Desde M-12 la BD también rechaza, en cualquier indicador, valores de 2^53 o más (en valor absoluto). Desde M-13 la pantalla revisa ese tope en todos los tipos, a mano y en el CSV: ves "valor: fuera de rango, debe ser menor que 2^53 (9007199254740992) en valor absoluto" (en el CSV, "Fila N: valor: fuera de rango …") y no se guarda nada. Escribe los números sin notación exponencial: `1e20` se rechaza como "debe ser un número mayor o igual que 0" (o "entero" en meta acumulada). Si la BD rechaza una fila igual (por ejemplo, un indicador con otras categorías), ves "No se pudo guardar. Inténtalo de nuevo." y no se guarda nada del lote.

## Qué no puedes hacer desde la app (hoy)

- Editar o borrar una medición ya guardada. No hay pantalla para eso.
- Borrar un compromiso.
- Cargar mediciones de indicadores que no custodias, ni con fuente "automática".
- Ver los tableros de colores, las alertas o las excepciones.

## Cuándo cuentan tus datos

- La evaluación mensual corre el día 1 a las 06:07 (Guayaquil) y cierra el mes anterior. Carga antes de esa hora. Hoy todavía no corre en producción: espera la activación (P-05).
- Si cargas tarde o corriges un dato, el mes se puede reprocesar a mano (lo hace operación, ver [docs/operacion.md](operacion.md#reprocesar-un-mes)).
- La gestora ve en su tablero de completitud qué unidades te faltan.
