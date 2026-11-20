# F-07 — Informe QA
Veredicto: VERDE

Rama revisada: `item/F-07`. Código en `13d670a`, arquitectura en `731d550` y `seguridad.yml` en `1e03204`. Las pruebas QA van en `2663475` más la restauración `cd8d959` (ver nota del proceso).
Referencias: criterio de F-07 en `docs/plan-maestro.md` ("Paso intermitente registrado en operacion.md deja de requerir relanzar a mano"); CLAUDE.md 4 ("No desactives pruebas, linters ni pasos de CI para que algo pase").

## Criterio de aceptación
- **El paso intermitente deja de requerir relanzar a mano: cumplido.**
  - Los dos intermitentes registrados en `docs/operacion.md` ocurrieron en `seguridad.yml`, en el job pentest-api (puertos 54322 y 54324).
  - En `1e03204`, seguridad cambió los tres `supabase start` de `seguridad.yml` (pentest-api, dast, S-05) a `scripts/ci/supabase-start.sh`. `ci.yml` ya lo usaba en db, integración y e2e.
  - Con esto se cierra el hallazgo ROJO 1 del informe de arquitectura. Lo confirma una prueba QA que primero era `todo` y ahora pasa.
- **Un fallo real sigue fallando y no se oculta nada: cumplido.**
  - Si el error no es de puerto (p. ej. una migración rota), se reintenta, pero al final sale con su código. El mensaje de error de cada intento queda en el log.
  - Sale con el código del último intento (137, 4...), nunca 0.
  - Si `supabase stop` falla entre intentos, el resultado no cambia.
  - Los intentos tienen tope: con el máximo de 5 son 5 arranques y 4 `stop`.
  - Cuando un reintento absorbe una intermitencia, deja un `::notice::` con el número de intento y un `::warning::` por cada fallo previo.
  - Si arranca a la primera, no escribe anotaciones.
  - Ningún paso que arranca Supabase tiene `continue-on-error` ni `|| true`.
  - El diagnóstico muestra quién ocupa 54322 y 54324 (`ss -ltnp`, `docker ps -a`) y no confunde otros puertos como 5432 o 543221.

## Pruebas añadidas
- `tests/scripts/qa-f07.test.js`: 9 casos, todos pasan. Usa una CLI `supabase` falsa y `ss`, `sudo` y `docker` falsos en PATH, sin Docker real.

## Resultado CI
- CI run 44686826487 y Seguridad run 44686826472 sobre `cd8d959`: **success** los dos.
- Los jobs db, integración, e2e, pentest-api, dast y S-05 muestran «Intento 1 de 3»: el script está en uso y arrancó a la primera.
- El último commit (este informe y quitar el `todo`) se valida en el run siguiente.

## Cobertura engine/
No aplica: el ítem no toca `engine/`. La suite completa mantiene 99,9 % de líneas.

## Hallazgos
- **H-F07-QA-01: cerrado** en `1e03204` (seguridad.yml sin reintento).
- **Observación (baja, no bloquea).** El script reintenta cualquier fallo, no solo `address already in use`. Ante una migración rota, el job tarda unos 3 minutos más antes de fallar, pero falla igual y con el mensaje a la vista. Una mejora posible es reintentar solo si la salida contiene `address already in use`.

## Nota del proceso
Mi primer commit QA (`2663475`) deshizo sin querer `1e03204`. Otro worktree tenía la misma rama abierta y mi índice estaba desactualizado. En `cd8d959` restauré los dos archivos tal como los dejó seguridad. `git diff 1e03204 cd8d959` contiene solo `tests/scripts/qa-f07.test.js`.
