# S-05 — Informe QA
Veredicto: VERDE (intento 2)

## Intento 2 (commits `f96881b`, `eb33a27`)

Criterio de aceptación: **cumplido**. Los puntos del intento 1 se mantienen y el que estaba en ROJO ya pasa.

| Hallazgo | Estado | Cómo se verificó |
|---|---|---|
| QA-S05-01 (medio) | **Corregido** | Ahora hay dos barreras contra lanzar la fase B fuera de `main`. **1)** El `if` del job exige `github.ref == 'refs/heads/main'`. **2)** La guarda tiene `id: main-guard`, y «ZAP full scan de Pages» y «Sin alertas de riesgo alto (Pages)» solo corren con `!cancelled() && steps.main-guard.outcome == 'success'`. Pruebas: el evaluador del `if` con `github.ref` cubre desde `main`, `item/S-05`, `main-falsa` y un tag (solo `main` corre la fase B). La guarda falla con cualquier ref que no sea `main`. Ningún paso que contacta producción usa `always()` |
| QA-S05-02 (bajo) | Aclarado, no bloquea | En el run 44664594826, «Lecturas base con 200: 10»: las 10 tablas responden 200 con `curl`. Aun así, ZAP solo obtiene 3 × 2xx. El informe ahora dice que el API scan prueba autenticación y ausencia de 5xx, no inyección en las 10 tablas, que queda cubierta por `api/preprod-s05.test.js`. El umbral sigue en `ok ≥ 1`; aceptado |
| QA-S05-03 (bajo) | Corregido | Exclusión global de ZAP con `^https?://(?!<host>/practica_agente/).*$` en ambas fases. Los pasos de alertas fallan si alguna URI queda fuera del subárbol. Pruebas: la regex excluye otro repo, la raíz de `apivasa.github.io` y `supabase.co`, y no excluye `/practica_agente/`. Los pasos fallan con una URI fuera del subárbol, tanto en la fase A (gateway `:54321`) como en Pages. En la fase A real el full scan pasó de 15 a 6 URL |
| QA-S05-04 (info) | Corregido | Si el log está vacío o falta Kong, el paso falla con su `::error::` propio. Las pruebas comprueban ahora ese mensaje |
| H-ARQ: fase A sin `push` | Verificado | La fase A corre en `pull_request`, `schedule` y `workflow_dispatch` con `fase_b = no`, y no en `push`. El PR de S-05 la ejecutará |

**La fase A sigue sin ser un verde vacío.** Run [44664594826](https://github.com/apivasa/practica_agente/actions/runs/44664594826) (`workflow_dispatch`, `f96881b`), job `s05-fase-a` en verde:
- Full scan del front: `Total of 6 URLs`, `FAIL-NEW: 0 WARN-NEW: 5 PASS: 138`, código 0.
- API scan: `Total of 80 URLs`, `FAIL-NEW: 0 WARN-NEW: 4 PASS: 116`, código 0.
- PostgREST: `Peticiones a PostgREST: 43850 · 2xx: 3 · 401: 0 · 5xx: 0`, con los mismos conteos por estado que el intento 1.

Los 71 casos de `tests/workflows/qa-s05.test.js` ejecutan los scripts reales de esa versión del workflow y confirman que cada control falla cuando debe.

**Pruebas (intento 2):** `tests/workflows/qa-s05.test.js` pasa de 57 a 71 casos:
- Bloque de eventos: 11 casos con `github.ref`, incluidos un `push` y un `dispatch` desde otra rama.
- 1 caso de URI fuera del subárbol en la fase A.
- 8 casos de los pasos de ZAP contra Pages: dependencia de `main-guard`, alerta alta, 3 URI fuera de alcance, sin informe y la regex de exclusión.
- Se recuperan los mensajes de QA-S05-04.
- Resultado local: 71/71 pasan.

**Hallazgo nuevo:**
- **QA-S05-05 (bajo, proceso):** `f96881b` borra `docs/reportes/S-05-arquitectura.md`, el informe del arquitecto-SRE (`039b5c2`, 81 líneas). Seguridad no tiene permiso de escritura ahí (CLAUDE.md §1) y el commit no lo menciona. Parece un efecto secundario de que dos worktrees compartan la rama `item/S-05`. El PR necesita los tres informes enlazados: el orquestador o el arquitecto deben restaurarlo (`git checkout 039b5c2 -- docs/reportes/S-05-arquitectura.md`) o volver a emitirlo para el intento 2. QA no lo toca. No afecta al criterio de S-05.

**Resultado CI (intento 2), commit `43e75c1`:**
- [CI 44668471546](https://github.com/apivasa/practica_agente/actions/runs/44668471546): **verde**. 1227 tests, 0 fallos; los 3 que no cuentan como pasados son TODO u omitidos ya conocidos.
- [Seguridad 44668471544](https://github.com/apivasa/practica_agente/actions/runs/44668471544): **verde**. Los 8 jobs previos pasan. `s05-fase-a` y `s05-fase-b` se omiten, como corresponde a un push.
- La fase A en verde de referencia es la del dispatch 44664594826, y el PR la vuelve a ejecutar.

---

## Intento 1 (`a397b1c`): ROJO

Rama `item/S-05`, revisada sobre `363265f` (informe de seguridad) y `039b5c2` (informe de arquitectura). Constructor: seguridad.

## Criterio de aceptación: no cumplido (por punto)

Criterio del plan: *informe `docs/seguridad/pentest-preproduccion.md` sin hallazgos altos ni críticos abiertos.* Verificaciones que pidió el orquestador:

| Punto | Estado | Evidencia |
|---|---|---|
| El informe no tiene hallazgos altos ni críticos abiertos | Cumplido | Tabla de hallazgos: 2 medios (H-C03-02, H-S05-01), 4 bajos y 1 informativo. H-C02-01 (alto) figura corregido, y `security-tests` pasa |
| La fase A corre de verdad | Cumplido | Job `S-05 fase A` en verde en los runs 44661334199 (`37a440d`) y 44662765886 (`039b5c2`): se levanta Supabase local, se compila el build de producción y corren ZAP full scan y ZAP API scan |
| Los pasos de la fase A fallan cuando deben | Cumplido | `tests/workflows/qa-s05.test.js` ejecuta los `run:` reales del workflow con un docker simulado. Falla con una alerta alta (front, API o un segundo `site`), si falta el informe, con algún 401 (sin sesión o sesión caducada a mitad), si no hay ningún 2xx, ante cualquier 5xx (500 y 503), con 999 peticiones (con 1000 pasa), si el log del gateway está vacío, si falta Kong y si ZAP sale con 1, 2 o 3. Los 401 y 5xx de antes del escaneo no cuentan. Además, los runs 44658636807, 44659480795 y 44660504593 de la rama quedaron en ROJO por la verificación de autenticación del API scan: el control no es un verde vacío |
| Las cifras del informe coinciden con los logs de CI | Cumplido | Run 44661334199, comprobado otra vez en 44662765886. Full scan: `Total of 15 URLs`, `FAIL-NEW: 0 WARN-NEW: 5 PASS: 138`. API scan: `Total of 80 URLs`, `FAIL-NEW: 0 WARN-NEW: 4 PASS: 116`, `Peticiones a PostgREST: 43850 · 2xx: 3 · 401: 0 · 5xx: 0` y 3790 × `GET 406`. `pentest-api`: 531 tests, 0 fallos, 0 omitidos. `security-tests`: 485, 0, 0 |
| La fase B solo corre desde `main` | **No cumplido** | Hallazgo QA-S05-01: el paso que lanza el ZAP activo contra Pages tiene `if: always()` y se ejecuta aunque falle la guarda «Solo desde main» |
| La fase B no usa la clave secreta | Cumplido | El job no referencia `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN` ni `SUPABASE_DB_PASSWORD`. Su único secreto es `S05_TEST_USERS`, y el token tiene `permissions: contents: read` |
| La fase B solo ataca hosts del proyecto | Cumplido (con una observación, QA-S05-03) | Se probó `allowed()` de `fase-b.test.js` con su código real. Admite Pages `/practica_agente/` y `<ref>.supabase.co` por https. Rechaza http, otro repo de `apivasa.github.io`, la raíz del dominio, otro ref de Supabase, sufijos engañosos, otro puerto y 127.0.0.1 |
| La fase B no es destructiva | Cumplido | Las escrituras de la fase B son sondas que la BD debe rechazar, con filtros imposibles o una FK inexistente. Si la escalada prospera, se revierte. ZAP corre con 1 hilo, 300 ms de retardo y un máximo de 15 min, sin API scan ni AJAX spider |
| No se rompió ningún job previo de `seguridad.yml` | Cumplido | El diff del workflow solo añade líneas. Siguen los 7 jobs previos sin `if` nuevo y con los mismos disparadores. En el run 44662765886 gitleaks, semgrep, npm audit, los dos CodeQL, `security-tests`, `pentest-api` y DAST están en verde |

## Pruebas añadidas
- `tests/workflows/qa-s05.test.js`: 57 casos en 8 bloques. Corre con `npm run test:unit` (job `build` de CI) y no tiene dependencias: usa bash, jq y un `docker` simulado en `PATH`.
  - A1: el paso «Sin alertas de riesgo alto» (6 casos).
  - A2: el ZAP API scan y la comprobación de autenticación, 5xx y volumen (13).
  - A3: el código de salida del ZAP full scan (5).
  - B1: qué fase corre en cada evento (7).
  - B2: la guarda de `main` (7). **1 falla: QA-S05-01.**
  - B3: la lista blanca de hosts (15).
  - B4: sin clave secreta y ZAP acotado (3).
  - C: no regresión de los jobs previos (3).
- Resultado local: 57 casos, 56 pasan y 1 falla («ningún paso que contacta producción corre si falla la comprobación de main»).

## Resultado CI
- Seguridad, [run 44662765886](https://github.com/apivasa/practica_agente/actions/runs/44662765886) (`039b5c2`): verde. 9 jobs en verde y `s05-fase-b` omitido, como corresponde a un push.
- El run 44662205558 (`363265f`) quedó cancelado por `concurrency: cancel-in-progress` cuando llegó el push del informe de arquitectura. No es un fallo.
- CI, run 44662765832: verde. Con este commit, `build` (unit) **debe quedar en ROJO** por la prueba de QA-S05-01 hasta que se corrija el workflow.

## Cobertura engine/
No aplica: S-05 no toca `engine/`.

## Hallazgos

### QA-S05-01: la guarda «solo desde main» de la fase B no impide el ZAP activo contra producción
- Severidad: **media**. Bloquea, porque es un punto explícito de la verificación.
- Ubicación: `.github/workflows/seguridad.yml` › `s05-fase-b`, paso «ZAP full scan de Pages (1 hilo, con retardo, duración acotada)», que lleva `if: always()`.
- Problema: en Actions, `always()` ejecuta el paso aunque haya fallado un paso anterior. Si la fase B se lanza desde una rama que no es `main`, ocurre lo siguiente:
  - «Solo desde main» falla.
  - El pentest de `fase-b.test.js` se omite, como corresponde.
  - El ZAP full scan **activo** contra `https://apivasa.github.io/practica_agente/` corre igual.
- El único freno que queda es la regla de ramas del environment `produccion`, que según H-C03-02 no se sabe si existe. La fase B también podría lanzarse antes del primer despliegue, que es una compuerta de la usuaria. El paso informativo «Configuración del repositorio» y el pentest sí quedan bien protegidos.
- Reproducción:
  - `gh api -X POST repos/apivasa/practica_agente/actions/workflows/seguridad.yml/dispatches -f ref=item/S-05 -f 'inputs[fase_b]=anonimo'`. **No lanzado por QA**: ejecutaría el escaneo contra Pages.
  - Alternativa sin red: `node --test tests/workflows/qa-s05.test.js` falla en «S-05 fase B · solo desde main › ningún paso que contacta producción corre si falla la comprobación de main».
- Corrección sugerida, para seguridad: cualquiera de estas dos.
  - Condición a nivel de job: `if: github.event_name == 'workflow_dispatch' && inputs.fase_b != 'no' && github.ref == 'refs/heads/main'`. En ese caso hay que actualizar la regex de `tests/security/preprod-s05.test.js`.
  - Cambiar el `if` del paso ZAP por `if: ${{ !cancelled() && steps.<id-guarda>.outcome == 'success' }}`, dando un `id` a «Solo desde main».
- Los pasos «Sin alertas de riesgo alto (Pages)» y «Guardar informes» pueden seguir con `always()`: solo leen archivos locales.

### QA-S05-02: la cobertura del ZAP API scan es menor de lo que sugiere el informe
- Severidad: baja.
- El log de 44661334199 y 44662765886 muestra:
  - Solo **3** respuestas 200 en total. El OpenAPI tiene 10 tablas, así que como mucho 3 lecturas base son válidas; el resto de los GET dan 400 (7866) o 406 (3790).
  - **Ningún** POST ni PATCH 2xx: 8284 POST 400, 11931 PATCH 400, 3162 POST 403 y 8781 PATCH 403.
- En la mayoría de los endpoints, ZAP ataca una petición base que PostgREST ya rechaza. Las cifras «unas 44 000 sondas de ZAP sin ningún 5xx» (`S-05-seguridad.md` › Verificado, punto 3) y «3 × 200 en las lecturas base» (`pentest-preproduccion.md` › 2) son ciertas, pero no prueban resistencia a la inyección en esas tablas. Sí prueban que ZAP llegó autenticado: 0 × 401 y 403 en las tablas sin privilegio.
- En el commit `37a440d`, la verificación pasó de exigir varios 2xx a exigir ≥ 1, después de tres runs en ROJO. El nuevo criterio, «sin 401», es válido para la autenticación. Lo que se pierde es la señal de cobertura.
- La inyección sí está cubierta por las 1050 sondas con operador válido de `tests/security/api/preprod-s05.test.js`, que pasan en `pentest-api`. Por eso no bloquea.
- Sugerencia:
  - Precisar en el informe cuántas tablas tienen una base 2xx.
  - O ajustar el OpenAPI (por ejemplo, `select` y filtros por tipo de columna) para que las 10 lecturas base respondan 200.
  - Fijar el umbral en «2xx ≥ número de tablas leíbles por la gestora».

### QA-S05-03: el spider de ZAP en la fase B no está limitado a `/practica_agente/`
- Severidad: baja o informativa (por confirmar).
- `zap-full-scan.py -t https://apivasa.github.io/practica_agente/` no fija un contexto ni `subtreeOnly`, así que la araña tradicional puede seguir enlaces a otras rutas de `apivasa.github.io`: otros repos del mismo dueño, fuera del alcance del proyecto. El escaneo activo, en cambio, recorre desde la URL objetivo.
- Hoy el front no enlaza fuera del repo, así que no hay impacto conocido.
- Sugerencia: limitar la araña al subárbol (opción de subárbol de la araña de ZAP; confirmar el nombre exacto en la versión fijada) o un contexto con `include` `https://apivasa.github.io/practica_agente/.*`. Revisar en el primer run de la fase B que todas las URL del informe estén bajo `/practica_agente/`.

### QA-S05-04: falla cerrado, pero sin mensaje propio (informativo)
- Si el log de Kong no trae líneas `/rest/v1` o no existe el contenedor Kong, el paso del API scan falla correctamente. El motivo es `pipefail` en el `grep`, así que el fallo no lleva el mensaje `::error::` previsto («ZAP apenas atacó la API», «no se encontró el contenedor Kong»).
- No afecta al veredicto. Solo dificulta el diagnóstico.
