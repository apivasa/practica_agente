# ADR 0015 — Despliegue: manual primero, push a `main` después; orden con S-05

Estado: Aceptado (decisión técnica, 2026-11-20, ítem V-05; no contradice el diseño). Se propuso como 0014 y se renumeró al fusionarse V-04 con `0014-salud-del-sistema.md`.

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
   - Si en la fase 2 se quiere una aprobación antes de `db push`, se crea un environment aparte, `produccion-migraciones`, con regla `main` y revisor. Ahí van solo `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF`, y solo `migrate` lo declara.
   - Separar los environments también aísla la clave secreta (solo en `produccion`) de las credenciales de la BD (solo en el otro).
   - Crear environments y mover secretos es compuerta del usuario.

## Consecuencias
- V-05 queda `Hecho` cuando se cumple su criterio (primera publicación y migraciones). El "en cada merge a `main`" se entrega en el ítem de fase 2, que el orquestador agrega al plan.
- Mientras el environment `produccion` no exista con regla de ramas, GitHub lo crea vacío en el primer run. Los secretos de repositorio siguen accesibles, así que el despliegue funciona, pero esa configuración no protege nada. Es aceptable solo porque el disparo es manual y lo hace el usuario.
- Si un día cambia el proyecto Supabase, hay que cambiar a la vez los secretos, `PRODUCTION_SUPABASE_ORIGIN` (ADR 0011) y la configuración de Auth del nuevo proyecto.
