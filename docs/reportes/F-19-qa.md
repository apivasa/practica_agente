# F-19 — Informe QA

Veredicto: VERDE

Revisión independiente (el tester no escribió el código). Rama `item/F-19`, commit revisado a4b1f79.

## Criterio de aceptación (fila F-19, `docs/plan-maestro.md`)

| Punto | Estado |
|---|---|
| (1) H-F18-01 / H-ARQ-F18-01: `maxDurationMin` valida `run_started_at` y `updated_at` del candidato con `parseApiTime`. Si una fecha es ilegible, futura o falta, da `fail` (ritmo-diario en success con `updated_at` ilegible ya no da `ok`) | Cumplido |
| (2) H-F18-02 / QA-F18-01: `checkWorkflows` pide los jobs al candidato que elige `assessWorkflow` (`pickWorkflowCandidate`). Jobs vacíos, paso ausente u omitido, o jobs de otro run dan `fail` con producción activa | Cumplido |
| `listJobs` pide `per_page=100`, pagina según `total_count` y tiene un número de páginas acotado | Cumplido |

## Pruebas añadidas

- `tests/scripts/qa-f19.test.js`: 59 casos, todos en verde.
  - **(1) Duración, por cada regla con duración máxima (ritmo-diario, evaluacion-mensual, correo-alertas):**
    - fecha ilegible en `updated_at` o en `run_started_at` (9 valores malos);
    - campo ausente;
    - `updated_at` futura;
    - `updated_at` anterior a `run_started_at`;
    - duración máxima exacta da `ok` y un segundo más da `fail`.
  - **(1) Otros casos de duración:**
    - borde `FUTURE_SKEW_MIN`: aceptado; un segundo más da `fail`;
    - solo cuentan las fechas del candidato;
    - seguridad-semanal y ci-main no se ven afectadas;
    - sin producción, el check se omite.
  - **(2) assessWorkflow, por cada regla con paso requerido:**
    - jobs vacíos;
    - paso renombrado;
    - paso `skipped`;
    - jobs de otro run;
    - job sin steps o `null`;
    - paso de otra regla ("Evaluar" en correo-alertas y "Enviar correos" en ritmo-diario).
  - **(2) checkWorkflows:**
    - con la API desordenada, pide los jobs del run más nuevo y no del primero de la lista;
    - si el run nuevo omitió el paso, da `fail`;
    - si el candidato está en failure, no pide jobs;
    - un cancelado no es candidato;
    - en la regla mensual, pide los jobs del cierre del mes en curso;
    - si la API devuelve jobs vacíos, da `fail`;
    - si el id no es entero, no pide jobs y da `fail`;
    - un error de listJobs aísla el fallo en su check;
    - sin producción, no pide jobs.
  - **(3) Datos realistas:** con un historial realista de las 5 reglas y producción activa, todas dan `ok`. Los jobs se piden exactamente a los 3 candidatos.
  - **listJobs:**
    - el paso está en la 2.ª página de 150 jobs: se pide `per_page=100&page=1` y luego `page=2`;
    - una página corta hace una sola llamada;
    - con 100 jobs exactos no pide una página vacía;
    - con un `total_count` enorme se detiene en un número acotado de páginas;
    - un runId no numérico no inyecta ruta.
- **Datos de prueba actualizados.** Las pruebas existentes no traían jobs reales. Se completaron sus datos y no se cambió ninguna aserción ni se marcó ningún skip o todo:
  - `tests/scripts/health.test.js`:
    - `fakeFetch` ahora responde `/actions/runs/<id>/jobs` con jobs reales de ese run: lleva su `run_id` y el paso requerido de la regla de su workflow ("Enviar correos" en correo-alertas), más `total_count`;
    - «runs cancelados no cuentan» recibe `evalJobs()`.
  - `tests/scripts/qa-v04.test.js`: los casos «30 h exactas ok» y «5 min exactos ok» reciben los jobs del run 1 con "Evaluar".
  - `tests/scripts/qa-c06.test.js`: el run lleva `id` y el caso `ok` recibe los jobs con "Enviar correos".
  - `tests/scripts/qa-f18.test.js`: el empate de ritmo-diario y el historial realista (3) reciben los jobs del candidato (id mayor o cierre del mes).

## Resultado local

No hubo `npm install` y se corrió `node --test` por partes:
- `health`, `qa-v04`, `qa-c06` y `qa-f18`: 116 de 116 pasan. Antes del ajuste fallaban 8 casos hoja; los 9 citados por el orquestador incluyen un `describe` padre.
- Los demás archivos que importan `scripts/health` (fixes F-11 a F-19, qa-f11 a f17, qa-v04b, health-deploy y `tests/security/health-*`): 696 de 696 pasan.
- `qa-f19`: 59 de 59 pasan.
- `tests/engine`: 855 de 855 pasan.

Resultado CI: pendiente del run de la rama `item/F-19` tras el push. Se consulta con `gh api 'repos/apivasa/practica_agente/actions/runs?branch=item/F-19&per_page=5'`.

## Cobertura engine/

99,33 % de líneas (`tests/engine`). F-19 no modifica `engine/`.

## Hallazgos

Ninguno bloqueante.

- **QA-F19-01 (info).** Si el paso requerido aparece en varios jobs y solo algunos quedaron `skipped`, el check da `ok`, porque solo falla cuando todas las apariciones están omitidas. Es coherente con el texto del criterio («omitido»), pero conviene confirmarlo si algún día un workflow tiene el paso en una matriz.
- **QA-F19-02 (info).** Los jobs sin `run_id` se aceptan (`run_id !== undefined`). La API real siempre lo incluye y solo afecta a datos simulados. Si se quisiera la variante más estricta, sería exigir `run_id === candidate.id`.
