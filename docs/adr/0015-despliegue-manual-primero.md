# ADR 0015 — Despliegue: manual primero, push a `main` después; orden con S-05

Estado: Aceptado (decisión técnica, 2026-11-20, ítem V-05; no contradice el diseño). Se propuso como 0014 y se renumeró al fusionarse V-04 con `0014-salud-del-sistema.md`. Fase 2 entregada en V-05b (2026-11-20, ver «Actualización V-05b»).

## Contexto
V-05 dice: "`deploy.yml` publica `dist/` en GitHub Pages y aplica migraciones a Supabase real en cada merge a `main`". Su criterio de aceptación es la primera publicación accesible y las migraciones aplicadas. El primer despliegue a producción es compuerta del usuario (CLAUDE.md §3). Además, el plan pone S-05 (pentest previo) como dependencia de V-05, pero S-05 necesita el esquema desplegado y la URL de Pages para probar contra la API real: las dos dependencias se cruzan.

## Decisión
1. **Fase 1 (V-05, este ítem):** `deploy.yml` solo tiene `workflow_dispatch` con `confirm = desplegar`, y su job `verify` exige `GITHUB_REF = refs/heads/main`. Fusionar el workflow no despliega nada. El primer run lo lanza el usuario, o el orquestador con su autorización explícita en `docs/pendientes-usuario.md`.
2. **Orden de jobs:** `verify` → `build-pages` → `migrate-plan` (dry-run) → `migrate` → `deploy-pages` → `smoke`.
   - Lo barato y reversible (configuración, build, verificación de `dist/`) falla antes que lo irreversible (`db push`).
   - `verify` comprueba además que `SUPABASE_URL` es `PRODUCTION_SUPABASE_ORIGIN` (ADR 0011), para no migrar una base equivocada.
   - Las migraciones van antes de publicar el front y deben ser compatibles hacia delante: el front viejo sigue funcionando con el esquema nuevo.
3. **Configuración de Auth fuera de `db push`:** `supabase db push` no aplica `supabase/config.toml`. El registro cerrado (`enable_signup = false`, H-F03-06) y la *Site URL* del proyecto real se configuran en el panel de Supabase. `verify` comprueba `GET /auth/v1/settings` (clave publicable) y falla si `disable_signup` no es `true`. No se usa `supabase config push`, porque arrastraría al proyecto real los valores locales por defecto (por ejemplo `site_url = http://127.0.0.1:3000`).
4. **Orden con S-05:** primer despliegue (fase 1) → S-05 contra Pages y la API real con usuarios de prueba ficticios → solo con S-05 en VERDE se activan las evaluaciones (P-05, `EVALUATION_ENABLED`) y se anuncia la URL. Si S-05 encuentra un hallazgo alto o crítico, se retira el sitio (Settings → Pages → *Unpublish*) hasta corregirlo. S-05 sigue siendo la compuerta de la *puesta en uso*, no la del primer `db push`.
5. **Fase 2 (ítem de seguimiento, tras la primera publicación aprobada):** se activa `push: branches: [main]`. Antes hay que cumplir estas condiciones:
   - el environment `produccion` existe con regla de ramas de despliegue = `main`;
   - los secretos están en ese environment;
   - `evaluacion-mensual.yml` y `ritmo-diario.yml` declaran `environment: produccion` (hecho en V-05);
   - `deploy.yml` no lee `SUPABASE_SECRET_KEY` (hecho en V-05).
6. **Sin revisor requerido en `produccion`.** Ese environment lo usan también los crons de evaluación, y un revisor dejaría cada run programado en `waiting`. Así, la escalada y las alertas dejarían de ser automáticas (H-V05-QA-05, H-V05-02).
   - En la fase 1, la parada humana es el propio disparo manual con `confirm`, más el dry-run de `migrate-plan` en el log.
   - Si en la fase 2 se quiere una aprobación antes de `db push`, se crea un environment aparte, `produccion-migraciones`, con regla `main` y revisor. Ahí van solo `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` (desde V-05b ya no hace falta `SUPABASE_ACCESS_TOKEN`), y solo `migrate` lo declara.
   - Separar los environments también aísla la clave secreta (solo en `produccion`) de las credenciales de la BD (solo en el otro).
   - Crear environments y mover secretos es compuerta del usuario.

## Consecuencias
- V-05 queda `Hecho` cuando se cumple su criterio (primera publicación y migraciones). El "en cada merge a `main`" se entrega en el ítem de fase 2, que el orquestador agrega al plan.
- Mientras el environment `produccion` no exista con regla de ramas, GitHub lo crea vacío en el primer run. Los secretos de repositorio siguen accesibles, así que el despliegue funciona, pero esa configuración no protege nada. Es aceptable solo porque el disparo es manual y lo hace el usuario.
- Si un día cambia el proyecto Supabase, hay que cambiar a la vez los secretos, `PRODUCTION_SUPABASE_ORIGIN` (ADR 0011) y la configuración de Auth del nuevo proyecto.

## Actualización V-05b (fase 2, 2026-11-20)
Estado de la fase 2: **activada** en V-05b. No cambia ninguna decisión confirmada del diseño: el stack, el orden de jobs y la regla «sin revisor en `produccion`» siguen iguales.

1. **Disparo.** `deploy.yml` corre en `push` a `main` y sigue aceptando `workflow_dispatch` con `confirm = desplegar`. En `push`, `verify` no pide `confirm`, pero sí exige `refs/heads/main`, los secretos, el origen de producción y el registro cerrado.
2. **`paths-ignore: docs/**, **/*.md`.** Se acepta como lectura de «en cada merge a `main`». Un commit con solo esos archivos no cambia `dist/` ni `supabase/migrations/`: son el candado, el latido o un PR del documentador. Ningún `.md` fuera de `docs/` es entrada del build (`README.md`, `CHANGELOG.md`, `CLAUDE.md`, `engine/*.md`, `.claude/agents/*.md`). Un commit mixto despliega completo. Para redesplegar sin cambios de código, se usa el disparo manual.
3. **Concurrencia `despliegue-produccion` sin cancelar.** Un `db push` nunca se interrumpe. Si llegan varios merges, GitHub reemplaza el run en cola por el más reciente, que contiene a los anteriores. Es lo deseado.
4. **Migraciones sin token de cuenta (H-V05-01).** No se usan `supabase link` ni `SUPABASE_ACCESS_TOKEN`. `scripts/ci/db-url.sh` arma `postgresql://postgres.<ref>:<contraseña codificada>@<pooler>:5432/postgres` (pooler de sesión, IPv4; el runner no llega por IPv6 al host directo). Enmascara la contraseña codificada y la URL, y rechaza un host que no sea `aws-N-<región>.pooler.supabase.com`. CLI 3.2.0: `db push --db-url` (con `--dry-run` y con `--yes`) y `migration list --db-url`.
   - El host llega en la variable no secreta `vars.SUPABASE_DB_POOLER_HOST`, en el environment `produccion` o en el repositorio. Si falta, `verify` falla antes de cualquier efecto.
   - `SUPABASE_ACCESS_TOKEN` queda sin uso. Lo retira la usuaria (compuerta de secretos) después del primer despliegue continuo en verde.
5. **Condiciones del punto 5.**
   - Secretos y variable en el environment `produccion` con regla de ramas `main`: lo declara la usuaria. Las sesiones de Claude reciben 403 en la API de environments y no pueden comprobarlo.
   - Evaluaciones con `environment: produccion` y ningún job de `deploy.yml` con `SUPABASE_SECRET_KEY`: se mantienen. Además, ahora ningún job lee `SUPABASE_ACCESS_TOKEN`.
6. **Puerta de CI.** `deploy.yml` no espera al run de CI del commit fusionado en `main`. La garantía es que el orquestador solo fusiona con el CI del PR en verde (CLAUDE.md, paso 9), y ese CI corre sobre el merge con `main` del último push. Riesgo aceptado: dos PR fusionados seguidos, cada uno verde por separado, pueden combinar migraciones que nunca se probaron juntas. Mitigaciones: el dry-run de `migrate-plan` en el log, la fusión de un PR a la vez y el ítem de seguimiento propuesto en `docs/reportes/V-05b-arquitectura.md` (H-ARQ-V05b-01).
7. **Contraseña mínima de 12 (H-S03-02).** Rige en local y en CI por `supabase/config.toml`. En producción hay que fijarla en el panel de Auth (punto 3: `config.toml` no se aplica con `db push`). `/auth/v1/settings` no expone esa política, así que `verify` no puede comprobarla.

### Consecuencias de la fase 2
- Cada merge con código o migraciones a `main` llega a producción sin intervención humana. La parada humana está ahora en la revisión del PR (QA, seguridad y arquitectura) y en el CI del PR.
- Revertir un PR que añadió una migración borra el archivo del repo. Entonces `db push` falla: la versión remota ya no está en local. Se revierte solo el código y se corrige la BD con una migración nueva (runbook, `docs/operacion.md`).
- Un fallo de `deploy.yml` en `main` todavía no lo vigila `salud.yml` (H-ARQ-V05b-02).

## Enmienda S-05b (2026-11-20, arquitecto-SRE; no contradice el diseño)
El punto 4 pedía la fase B "con usuarios de prueba ficticios" antes de P-05. Se precisa la compuerta en dos escalones, que es lo que ya fija el plan (S-05b) y el criterio de cierre de `docs/seguridad/pentest-preproduccion.md`:
1. **P-05 (`EVALUATION_ENABLED = true`)** requiere la fase B en modo `anonimo` en VERDE (hecho: run 44839422473). Activar las evaluaciones no abre superficie nueva para usuarios: solo pone a correr `ritmo-diario` y `evaluacion-mensual` con la clave secreta desde el environment `produccion`, y enciende los checks `pages` y `supabase` de `salud.yml` (ADR 0014 punto 4), que además evitan la pausa del plan gratuito.
2. **Alta de usuarios reales y anuncio de la URL** requieren, además: fase B en modo `roles` en VERDE (cuentas de prueba y `S05_TEST_USERS`, compuerta del usuario), H-S05-01 completo (Site URL, redirecciones y política de contraseñas en el panel) y H-C03-02 sin copias de `SUPABASE_SECRET_KEY` a nivel de repositorio. La RLS por rol ya se probó con las mismas migraciones en la fase A y en `pentest-api`; lo que solo se ve en producción (`jwt_expiry`, `pg_graphql` con sesión) solo importa cuando hay sesiones reales.
