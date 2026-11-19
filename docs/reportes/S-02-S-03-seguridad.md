# S-02 + S-03 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna de la app. El ítem añade el job `pentest-api` en `seguridad.yml`: levanta Supabase local efímero (CLI 3.2.0, migraciones + seed) y ataca la API real (`/rest/v1`, `/auth/v1`) con los 7 usuarios del seed y como anónimo. Las claves locales las genera la CLI; no se usan secretos del repo ni hosts externos.

Intento 1 salió `ROJO` por H-S03-00, un defecto de configuración que impedía iniciar sesión. El desarrollador lo corrigió en `main`, la rama se rebasó sobre `main` y ahora `pentest-api` pasa con la configuración real. Sin hallazgos altos ni críticos en la API ni en la capa de datos.

## S-02: modelo de amenazas
`docs/seguridad/modelo-amenazas.md` tiene ahora:
- un diagrama de confianza;
- STRIDE por componente: front en Pages (T-FE-01..08), Supabase Auth (T-AUTH-01..08), PostgREST/RLS (T-API-01..11), Actions programadas con la clave secreta (T-JOB-01..08) y CI/CD (T-CI-01..10);
- una tabla de trazabilidad de cada amenaza de riesgo Alto a su prueba (archivo › caso).

Hay prueba activa para todas las amenazas altas salvo tres, que dependen de código que aún no existe y quedan asignadas al ítem que lo construye:
- T-FE-02 y T-FE-07 (XSS almacenado): S-04, `e2e/security/xss.spec.js`. Todavía no hay UI que muestre datos.
- T-CI-10 (`deploy.yml`): V-05.

## Pruebas de seguridad añadidas
| Archivo | Casos | Categoría |
|---|---|---|
| `tests/security/api/_lib.js`, `matrix.js` | Utilidades y matriz esperada (ADR 0005) | — |
| `tests/security/api/rls-matrix.test.js` | 320 (10 tablas × 8 actores × GET/POST/PATCH/DELETE) + 5 de catálogo + 48 de RPC | 1 |
| `tests/security/api/idor-escalation.test.js` | 43: IDOR por filtros (`eq`/`in`/`or`/`neq`/`not`/`and`, HEAD con `count=exact`), embebidos (`select=`, `!inner`, salto a `auth`), escalada (`user_roles`, `leader_user_id`, columnas inmutables, excepciones, evaluaciones), upsert (`Prefer resolution` + `on_conflict`), `Accept-Profile`/`Content-Profile` en 6 esquemas, inyección en filtros | 1, 3 |
| `tests/security/api/auth-jwt.test.js` | 15: formato de claves, 12 variantes de JWT manipulado × 10 tablas, token vencido con control vigente, claims de rol inventados con firma válida, `apikey`, registro cerrado, contraseña errónea, API admin, `app_metadata`, logout | 2 |
| `tests/security/workflows.test.js` | +1: el job `pentest-api` existe, usa la CLI fijada, `PENTEST_REQUIRE=1` y no usa secretos | 5 |

Total en el job: 428 casos, ninguno omitido. Con `PENTEST_REQUIRE=1`, si falta configuración el job falla en vez de omitir las pruebas. Fuera del job (por ejemplo `npm run test:unit` en `ci.yml`) las suites de API se omiten, porque allí no hay Supabase.

Criterio "cualquier tabla sin RLS hace fallar el job": el caso › catálogo consulta `pg_class`. Falla si hay una tabla sin `relrowsecurity`, una vista sin `security_invoker`, una tabla sin fila en la matriz, una función en `public` fuera de `RPC_ALLOWLIST` (vacía) o una ruta de OpenAPI no prevista.

## Resultados del pipeline
- Rama `item/S-02-S-03` (62981c9):
  - CI verde: https://github.com/apivasa/practica_agente/actions/runs/44604284071
  - Seguridad: https://github.com/apivasa/practica_agente/actions/runs/44604283956. gitleaks, semgrep, npm audit, CodeQL y tests/security en verde. `pentest-api` en rojo por H-S03-00 (`login gestora: 422 email_provider_disabled`).
- Ensayo `ensayo/s03-pentest` (= la rama + quitar `[auth.email] enable_signup`): https://github.com/apivasa/practica_agente/actions/runs/44604291312. Los 7 jobs en verde; `pentest-api` con 428 pass, 0 fail, 0 skipped.
- ZAP: no aplica (S-04).

## Hallazgos
**H-S03-00 · Alta (disponibilidad) · 2 Auth · `supabase/config.toml:9-10` — Corregido en `main`**
- Causa: `[auth.email] enable_signup = false` la CLI lo traduce a `GOTRUE_EXTERNAL_EMAIL_ENABLED=false`, lo que apaga el proveedor de correo entero, también el inicio de sesión.
- Reproducción:
  ```
  curl -s -X POST "$API/auth/v1/token?grant_type=password" \
    -H "apikey: $PUBLISHABLE" -H 'Content-Type: application/json' \
    -d '{"email":"gestora@example.test","password":"Local-Only-Pass-2026"}'
  ```
  Respuesta: `{"code":422,"error_code":"email_provider_disabled","msg":"Email logins are disabled"}`.
- Impacto: nadie puede iniciar sesión, lo que bloquea F-05, y el pentest no puede autenticar a los roles. No expone datos.
- Corrección (desarrollador): borrar las dos líneas `[auth.email]` / `enable_signup = false`. `[auth] enable_signup = false` ya cierra el registro: `api/auth-jwt.test.js` › "registro abierto deshabilitado" pasa con el cambio.

**Medios y bajos** (registrados en `docs/seguridad/hallazgos.md`):
- H-S03-01 · Baja: el access token sigue siendo válido en PostgREST tras el logout hasta que vence (≤ 1 h). Es residual y está aceptado.
- H-S03-02 · Baja: no hay política de contraseñas (mínimo 6, sin complejidad). Se corrige en S-05.
- H-S03-03 · Info: con un JWT de usuario válido, el gateway local no valida la `apikey`. No da más privilegios; se verifica en S-05.
- H-S03-04 · Baja: un miembro del comité puede tomar la excepción firmada por otro y extender su vigencia sin tope. Queda auditado. Pasa a C-02.

Estados actualizados: H-F03-01, H-F03-02, H-F03-03 y H-F03-06 pasan a corregidos y los verifica la API. H-F03-04 queda corregido para tablas y secuencias, con residual en funciones.

## Verificado sin hallazgos
- Categoría 1 completa contra la API real:
  - la matriz por rol y anónimo coincide con ADR 0005 en las 10 tablas;
  - sin fugas por IDOR (filtros, conteos, embebidos);
  - sin escalada (`user_roles`, `leader_user_id`, columnas inmutables, excepciones, evaluaciones, alertas, auditoría);
  - sin upsert indebido;
  - los esquemas `private`, `auth`, `pg_catalog`, `information_schema`, `extensions` y `storage` no están expuestos;
  - las funciones `security definer` no se pueden invocar por `/rpc`.
- Categoría 2:
  - las 12 variantes de JWT manipulado dan 401, y el vencido da `PGRST303`;
  - los claims de rol con firma válida no dan acceso;
  - la clave publicable sola no da acceso a nada;
  - la API admin rechaza tokens de usuario;
  - el registro está cerrado;
  - el logout revoca el refresh token.
- Categoría 3: la inyección SQL por filtros, `select=` y `order=` no prospera.
- Categoría 5: el job nuevo cumple todas las reglas de `workflows.test.js` (SHA, permisos mínimos, sin secretos, claves locales fuera de las cabeceras de env del log).
