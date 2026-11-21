# S-05b — Informe QA
Veredicto: VERDE

Revisión de la rama `item/S-05b` (commit `eec6a5d`). El constructor es seguridad y el ítem solo cambia documentación: no hay cambios en `src/`, `engine/`, `supabase/`, `tests/` ni `.github/` entre `7610aba` (el commit del run) y `eec6a5d`. Por eso el log del run corresponde exactamente al código que hay en la rama.

## Criterio de aceptación
Criterio (`docs/plan-maestro.md`, S-05b): «Sin hallazgos altos ni críticos; solo entonces P-05». Lo que pidió el orquestador: fase B en modo `anonimo`, con el run 44839422473 enlazado y documentado.

| Punto | Estado | Evidencia |
|---|---|---|
| Fase B lanzada por `workflow_dispatch` desde `main` tras el primer despliegue | Cumplido | Run 44839422473: `event = workflow_dispatch`, `head_branch = main`, `head_sha = 7610aba`, `conclusion = success`. El paso «Solo desde main» pasa. |
| Modo `anonimo` | Cumplido | El job 136643913606 recibe `S05_MODE: anonimo`, `S05_REQUIRE: 1` y `S05_TEST_USERS` vacío. |
| Sin hallazgos altos ni críticos | Cumplido | node:test da `tests 28 · pass 28 · fail 0 · cancelled 0 · skipped 0 · todo 0`. ZAP da `FAIL-NEW: 0 · WARN-NEW: 7 · PASS: 136`. Alertas con `riskcode ≥ 3`: 0. Ninguna URL queda fuera del alcance. El job no tiene anotaciones `::warning::` ni `::error::` (la API de *annotations* del check run devuelve una lista vacía). |
| Run enlazado y documentado | Cumplido | El enlace aparece en `docs/reportes/S-05b-seguridad.md`, en `docs/seguridad/pentest-preproduccion.md` (tabla de fases y «Resultados de la fase B»), en `docs/seguridad/hallazgos.md` (H-C03-02, H-S05-01, H-S05-03) y en `docs/seguridad/modelo-amenazas.md`. |
| La suite `roles` se salta por diseño y no por desactivación | Cumplido | En `fase-b.test.js:259` está `describe(..., { skip: MODE !== 'roles' && 'S05_MODE=anonimo' })`. El log muestra `ok 4 - API REST con los 4 roles (usuarios de prueba) # SKIP S05_MODE=anonimo`. Es un salto condicionado al input `fase_b` del dispatch: con `fase_b=roles` la suite corre, y si falta el secreto, el `before` falla. No hay `skip` fijo ni `.only`, y no se cambió ninguna prueba. |

## Lo escrito frente al log
- **28/28:** coincide con el log. Hay 6 casos del front, 3 de Auth y 19 de la API anónima: 1 de OpenAPI, 10 lecturas, 4 escrituras, 1 de RPC, 1 de esquemas, 1 de GraphQL y 1 de JWT. Así se reparten los 28 por categoría en el informe de seguridad: 17 de la cat. 1, 4 de la cat. 2 y 6 + 1 de la cat. 4. La fila «Arranque» de `pentest-preproduccion.md` es el `before` (bundle → URL del proyecto y una sola clave `sb_publishable_`). No se cuenta como caso, y que haya pasado se deduce de que las pruebas corrieron.
- **«0 omitidos»:** coincide con el log (`# skipped 0`). node:test no cuenta como omitidas las pruebas de una suite saltada. El documento lo aclara: «la suite `roles` se omite por `S05_MODE=anonimo`».
- **ZAP FAIL 0 · WARN 7 · PASS 136, 3 URL:** coincide (`Total of 3 URLs`). Las 7 WARN son 10020, 10021, 10055, 10063, 10098, 40040 y 90004 (×2: COOP y COEP). El JSON del paso de comprobación lista COOP y COEP por separado. El documento las agrupa bien como «90004 COOP/COEP». También coinciden los riesgos y confianzas de la tabla (10098 Medio/Medio, 40040 Medio/Alto, 10055 Medio/Alto, etc.) y las informativas 10109, 10050, 10049 y 10015.
- **H-C03-02:** coincide. El log da `deployment_branch_policy: {"protected_branches":false,"custom_branch_policies":true}`. El texto `::warning::... (H-C03-02)` solo aparece en el eco del script (línea `if`) y no hay anotación. La residual (los secretos a nivel de repositorio no se pueden verificar) queda bien declarada.
- **Artefacto `s05-fase-b-zap`:** coincide (id 14679713747, retención de 90 días).
- **Los demás jobs del run** (gitleaks, semgrep, npm audit, CodeQL ×2, `tests/security`, pentest API, DAST): todos dan `success`. La fase A da `skipped`, como corresponde. Coincide con el informe.

## Cobertura del criterio por `tests/security/prod/fase-b.test.js`
La batería cubre lo que la fase B promete para el modo anónimo:
- La lista blanca de hosts y el tope de peticiones (no destructiva).
- Front: HTTPS, HSTS, CSP, ausencia de secretos y claves legadas, ausencia de terceros, archivos de desarrollo y source maps.
- Auth: registro cerrado, sin anónimos ni OAuth, admin cerrado.
- RLS anónima sobre las 10 tablas.
- RPC `private`, esquemas internos, GraphQL y JWT forjados.

El modo `roles` (IDOR, escalada, auditoría inmutable, `jwt_expiry`) queda como seguimiento declarado y no forma parte del criterio de S-05b.

Hay dos puntos débiles en la fuerza de algunas aserciones (ver hallazgos). Ninguno contradice el criterio.

## Pruebas añadidas
Ninguna. `tests/security/` pertenece a seguridad, la batería ya existía (S-05) y solo se puede ejecutar contra producción por dispatch, que el orquestador no autorizó en esta revisión. Los hallazgos se proponen para que seguridad los corrija.

## Resultado CI
[Seguridad 44839422473](https://github.com/apivasa/practica_agente/actions/runs/44839422473): todos los jobs en verde y la fase A omitida por diseño. Job de la fase B: 136643913606, `success`, con todos los pasos en `success`.

## Cobertura engine/
No aplica: el ítem no toca `engine/`.

## Hallazgos
- **H-QA-S05b-01 · Baja · aserción débil en 3 de las 4 sondas de escritura anónima.**
  - El problema: `fase-b.test.js:227` envía `{ name: 's05-fase-b' }` a `units`, `exceptions`, `audit_log` y `user_roles`, y acepta `400`. Solo `units` tiene columna `name` (`20261119120000_data_model.sql:22`). En las otras tres, lo previsible es que PostgREST responda `400 PGRST204` (columna inexistente en la caché del esquema) antes de llegar a la comprobación de privilegios de PostgreSQL. Entonces el caso pasaría aunque `anon` tuviera INSERT.
  - Consecuencia: la frase «rechazado por privilegio» de `pentest-preproduccion.md` y del informe de seguridad no está demostrada para esas tres tablas. El log no imprime los cuerpos de respuesta, así que no se puede confirmar desde el run.
  - Por qué no bloquea: la denegación a `anon` está cubierta en otras pruebas. `hardening.sql:163-167` aplica `revoke all ... from anon` a todas las migraciones, las mismas que se aplicaron en producción, y lo prueban pgTAP, la fase A y `pentest-api`. Las 10 lecturas anónimas también dan denegado o vacío.
  - Corrección sugerida (seguridad): usar una columna que exista en cada tabla (`reason` en `exceptions`, `action` en `audit_log`, `role` en `user_roles`) y exigir `401/403` o `"code":"42501"`, en vez de aceptar cualquier `400`.
  - Reproducción: en local, con `GRANT INSERT ON public.audit_log TO anon` temporal, `POST /rest/v1/audit_log` con `{"name":"x"}` y la clave publicable. Se espera `400 PGRST204` y el caso pasaría igual.
- **H-QA-S05b-02 · Info · la prueba de enumeración en el login es parcial.**
  - El problema: el caso «login: sin enumeración de usuarios (correo inexistente ≡ clave errónea)» solo prueba un correo inexistente y acepta `400` o `429`. No compara esa respuesta con la de una cuenta existente y una clave errónea, así que la equivalencia que anuncia el nombre no se verifica.
  - Lo que sí demuestra: no se emite token. En el modo `roles` se podría hacer la comparación con una cuenta de prueba, sin fuerza bruta.
  - La documentación dice «Login con correo inexistente → 400». Es exacto respecto a lo que se probó, pero el resumen «sin enumeración de usuarios» va un poco más allá.

No hay hallazgos altos ni críticos. El criterio de aceptación se cumple.
