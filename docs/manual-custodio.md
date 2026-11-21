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

**Importar CSV.**
1. En **Archivo CSV** elige el archivo. La pantalla te recuerda la cabecera que espera ese indicador.
2. La app lo valida sin guardar nada:
   - Con errores: ves "El archivo tiene N errores; no se guardó nada." y la lista "Fila N: ...". Corrige el archivo y vuelve a elegirlo.
   - Sin errores: ves "N filas válidas, listas para guardar." y una vista previa de hasta 50 filas.
3. Pulsa **Guardar N mediciones**. Se guardan todas o ninguna.

Formato de columnas, ejemplos y errores frecuentes: [docs/indicadores.md, sección 4](indicadores.md#4-carga-de-mediciones).

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
