# V-04 — Informe QA

Veredicto: **VERDE**

Rama `item/V-04` en `0e8fd08`.

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| La caída simulada en CI produce una alerta | Cumplido | CI run [44639874789](https://github.com/apivasa/practica_agente/actions/runs/44639874789) en verde (`0e8fd08`). El job `integración` (135967873536) ejecuta `scripts/ci/health.sh` contra Supabase local. Primero pasa con todo arriba y luego deja la web en un puerto cerrado. El log muestra `FALLA pages: sin respuesta (error de red) tras 2 intentos` y `OK: la caída simulada produce alerta (failures=pages).` El script exige código de salida 1 y `failures=pages`. |
| Runbook en `docs/operacion.md` | Cumplido | La sección «Salud del sistema» cubre: tabla de checks, qué pasa ante una falla (issue `salud` sin duplicados), diagnóstico por check (Pages, Supabase pausado o caído, workflow deshabilitado, paso «Evaluar» omitido, API de Actions), reactivación con `.../enable`, cierre del issue y auditoría. |

Fuera del criterio literal, la descripción del ítem también se cumple: hay alerta cuando un workflow programado no corrió, falló o está deshabilitado (pruebas unitarias). El registro de auditoría de las acciones automáticas se deja en `audit_log`, salvo el issue de salud, cuya justificación está en el runbook.

## Pruebas añadidas

`tests/scripts/qa-v04.test.js`: 30 casos, 5 grupos.

- **Errores de la API de Actions (5xx y 403):** 500, 502, 503 y 403. Cada check de workflow falla, el código de salida es 1 y el token no aparece en el log. Un 503 en un solo workflow no tumba a los demás. Un 404 se informa como «no existe» y no como error de API. Se rechaza un `GITHUB_REPOSITORY` sin barra.
- **Workflow que nunca corrió:**
  - Ritmo diario sin runs y workflow antiguo: falla.
  - Ritmo diario con solo un run en curso: falla.
  - Workflow nuevo: 29 h da ok y 31 h falla.
  - Seguridad sin runs por cron: falla.
  - Mensual sin runs: falla.
  - `disabled_manually`: falla.
- **Umbrales exactos:**
  - 30 h da ok; 30 h y 1 min falla.
  - 5 min da ok; 6 min falla.
  - 8 días da ok; 8 días y 1 h falla.
  - Manda el run más reciente aunque la API devuelva los runs desordenados.
- **Día 1 del mes en fin de semana** (2027-05-01, sábado):
  - Sábado día 1 sin run: ok.
  - Domingo día 2 sin run: falla.
  - Run del sábado: ok.
  - 04:00Z del día 2 sigue siendo día 1 en Guayaquil: ok.
  - Un run a las 03:00Z del 1 de mayo cuenta como abril.
  - Un run del mes en failure: falla.
  - No se exige antigüedad dentro del mes.
- **Issue ya abierto:**
  - Dos alertas seguidas dan 2 comentarios, sin issue ni etiqueta nuevos.
  - Un PR con la etiqueta `salud` no cuenta como issue.
  - La etiqueta ya existente (422) se tolera.
  - Un 403 al crear el issue lanza error (el job `alert` queda en rojo) sin filtrar el token.
  - Un 502 al buscar issues lanza error sin crear un duplicado a ciegas.
  - `guayaquilTime` cruza al día anterior.

Además existe `tests/scripts/health.test.js` del desarrollador, con unos 30 casos revisados.

## Resultado local

`npm run -s test:unit`: 1158 pruebas. 1155 pasan, 0 fallan, 2 se omiten y 1 es TODO. El TODO es H-C04-QA-01, de un ítem anterior y ajeno a V-04. Las 30 pruebas nuevas pasan.

## Resultado CI

Run 44639874789 en verde con los 4 jobs: build, db, integración y e2e. Las pruebas QA nuevas no se han ejecutado en CI todavía porque no hay commit ni push, por instrucción del orquestador.

## Cobertura

- `engine/`: alrededor del 99,9 % de líneas. Todos los archivos están al 100 % salvo `commitment.js`, con 99,26 %. Supera la meta del 95 %.
- `scripts/health/lib.js`: 97,19 % de líneas.
- `check.js` (85,96 %) e `issue.js` (75 %): sin cubrir queda solo el bloque de entrada CLI (`process.exit`).

## Hallazgos

1. **Baja.** La simulación de caída en CI comprueba la detección (código 1 y `failures=pages`), pero no ejecuta el job `alert` (`issue.js`) de punta a punta. La creación o el comentario del issue solo se prueba con fetch simulado. Esto es aceptable porque CI no debe abrir issues reales. Para reproducirlo, revisar `scripts/ci/health.sh`: no invoca `issue.js`.
2. **Informativo.** `createGitHubClient` acepta `GITHUB_REPOSITORY='../otro'`, porque la regex `^[\w.-]+\/[\w.-]+$` admite `..`. No es explotable: el valor lo pone GitHub Actions y el host sigue siendo `api.github.com`. Para reproducirlo: `createGitHubClient({ token:'x', repo:'../otro', fetchImpl })` no lanza error.
3. **Informativo.** La regla mensual exige un run desde el día 2 por calendario, aunque el día 1 caiga en fin de semana. Esto es coherente con el cron `7 11 1 * *`, que también es por calendario, y está cubierto por las pruebas.
