# M-12 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0005-modelo-datos-y-rls.md`. Se fija el formato de `thresholds_by_category`, que debe copiar el futuro `thresholds_by_category_override`. También se fijan los valores enteros ≥ 0 y las claves libres de `package_by_category`. No hay ADR nuevo: M-12 no toma ninguna decisión técnica nueva, porque repite el patrón de M-10 y M-11 (CHECK con jsonpath, sin funciones propias).
Salud: el CI de la rama (`b61059f`) está en rojo, solo en `db (pgTAP)`. Falla el caso 17 de `supabase/tests/091_qa_m09.test.sql`, una prueba del tester que daba por bueno el comportamiento anterior. Ver H-1. Pasaron `build`, `integración` y `e2e`, y también el workflow `Seguridad`. En `main`, los últimos CI y Seguridad están en verde. Los workflows programados siguen sin producción (P-02/P-03): la salud se prueba en CI contra Supabase local, sin cambios en `salud.yml`.

## Verificación
- **Stack y modelo:** M-12 añade tres CHECK a tablas que ya existen (`indicators`, `measurements`, `commitments`). No crea tablas, columnas, funciones, grants ni superficie RPC. La lógica de cálculo sigue en `engine/`, sin duplicados: la BD solo valida la forma y el rango, igual que M-09, M-10 y M-11.
- **Coherencia con el front y el motor:**
  - La forma `{ cat: { green, yellow } }` es la que produce `src/lib/indicator-form.js` (los dos campos son obligatorios) y la que consumen `toEngineIndicator`, `engine/indicator.js`, `engine/color.js` y `engine/rows.js`.
  - Ningún consumidor espera otras claves por categoría. El `min_sample` por categoría de ADR 0016 sale del indicador, no del JSON.
  - Lo que el CHECK de `package_by_category` acepta coincide con `buildCommitmentFields` y `validateCommitment`: `Number.isInteger(n) && n >= 0`.
- **Decisión sobre claves del paquete (correcta):**
  - `src/views/custodian/commitments.js` (`packageCategories`) toma las claves de `thresholds_by_category`, que la gestora nombra libremente, o `total` si no hay categorías.
  - Limitarlas a `P0P1`/`P2P3` rompería M-03 y M-07 en los indicadores de meta acumulada que no son VULN.
  - ADR 0016 punto 5 ya asume que el motor de vulnerabilidades solo lee `P0P1`/`P2P3` y que generalizarlo es otro ítem. Queda registrado en ADR 0005.
- **Futuro `thresholds_by_category_override` (ADR 0005):** ADR 0005 pide "el mismo formato". Ahora ese formato es exigible por catálogo y no solo por el front. En ADR 0005 queda la regla de copiar el mismo CHECK. No se crea una función compartida, para no abrir superficie RPC.
- **Semántica de jsonpath, probada en PostgreSQL 16 local con tablas temporales:**
  - `thresholds_by_category` acepta `{}`, el formato de la semilla y valores negativos o fraccionarios con |v| < 2^53.
  - Rechaza 10 de 10 variantes malas: `1e400`, falta `yellow`, clave extra, arreglo, texto, `null`, objeto anidado, arreglo como valor, `{}` por categoría y escalar como categoría.
  - `package_by_category` acepta `null`, `{}`, `total`, claves libres, `-0` y `2.0`.
  - El CHECK `_whole` rechaza `-1`, `1.5`, `1e-16000` y `9007199254740991.9999`. `1e400` y `"x"` los rechaza antes el CHECK `_safe` de M-11.
- **Orden de los CHECK frente a M-09, M-10 y M-11:** PostgreSQL evalúa los CHECK en orden alfabético de nombre.
  - `measurements_value_finite` va antes que `measurements_value_safe`.
  - `commitments_package_by_category_safe` va antes que `commitments_package_by_category_whole`.
  - `indicators_thresholds_by_category_check` (el original de tipo objeto) va antes que `indicators_thresholds_by_category_safe`.
  - Los mensajes de error que ya existían no cambian.
- **Producción con datos:**
  - Es aditiva y no destructiva.
  - `ADD CONSTRAINT` valida las filas existentes en la misma transacción: si hay datos que no cumplen, falla sin aplicar nada.
  - El bloqueo `ACCESS EXCLUSIVE` es breve con estos volúmenes. Como con las demás migraciones, no conviene aplicarla a la hora del cron mensual.
  - Las tres consultas de verificación previa al final del archivo son de solo lectura, usan las mismas expresiones que los CHECK y deben devolver 0 filas.
  - El procedimiento y la corrección de cada caso quedan en `docs/operacion.md` › Despliegue.

## Hallazgos
- **H-1 (bloquea el merge, lo corrige el tester; no es una desviación):** el caso 17 de `091_qa_m09.test.sql` afirma que «un promedio finito mayor que 2^53 no lo bloquea el CHECK». M-12 cierra justo eso (H-M11-02), tal como se propuso en M-11. El tester debe invertir la aserción: esperar 23514 de `measurements_value_safe`. El desarrollador no debe tocarla (CLAUDE.md §1).
- **H-2 (proceso, menor):** el commit del desarrollador edita `supabase/tests/security/049_security_numeric_safe_cap_m11.test.sql`, que es área de seguridad. El cambio quita la exclusión de `measurements.value`, así que endurece la prueba y no la debilita. Aun así, seguridad debe ratificarlo en su informe.
- **H-3 (residual, sin acción en M-12):**
  - La coherencia de `green`/`yellow` por categoría con `direction` sigue validándose solo en `validateIndicator`, igual que los overrides generales (ADR 0005).
  - Una clave `__proto__` en cualquiera de los dos JSON pasa el CHECK. El front y el motor ya la filtran.
  - Si hiciera falta reforzarlo en la BD, sería un ítem propio.
- **H-4 (informativo):** el trigger de M-09 que ponía tope a `measurements.value` en indicadores con categorías queda redundante con `measurements_value_safe`. Es inofensivo y no hace falta quitarlo, porque eso sería una migración más sin beneficio.
