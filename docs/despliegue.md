# Despliegue a producción (V-05, V-05b, V-05c, F-11)

Workflow: `.github/workflows/deploy.yml` (nombre en Actions: **Despliegue**).
Destino: Supabase del proyecto de P-02 (migraciones) y GitHub Pages (`https://apivasa.github.io/practica_agente/`).

**Estado (2026-11-20).** Primer despliegue hecho (run 44838844787): migraciones aplicadas y sitio publicado. Pentest fase B en modo `anonimo` en VERDE (S-05b, run 44839422473), sin hallazgos altos ni críticos. Las evaluaciones programadas siguen apagadas hasta P-05. La fase B en modo `roles` está pendiente.
Decisiones: ADR 0015 (manual primero, orden de jobs, Auth fuera de `db push`, fase 2 = despliegue continuo).

El primer despliegue a producción ya se hizo a mano (V-05, run 44838844787). Desde V-05b el despliegue es **continuo**.

## Cuándo se dispara

- **Push a `main`** (el merge de un PR): despliega sin input manual, pero solo si el CI (`ci.yml`) del mismo commit termina en `success` (V-05c, ver «Puerta de CI»). Se excluyen los commits que solo tocan `docs/**` o archivos `*.md` (`paths-ignore`): el candado, el latido y la documentación no cambian ni `dist/` ni las migraciones. Un commit mixto (código y docs) sí despliega.
- **Disparo manual** (Actions → **Despliegue** → *Run workflow*, rama `main`): sigue disponible y exige escribir exactamente `desplegar` en `confirm`. Cualquier evento distinto de `push` exige `confirm`. El disparo manual no espera al CI: lo decide quien confirma. Desde F-12 sí pasa por «Commit vigente en main»: para volver a publicar, lanza un disparo **nuevo**; un *Re-run* de un disparo viejo falla si ya entró un commit con código.
  Por REST: `gh api -X POST repos/apivasa/practica_agente/actions/workflows/deploy.yml/dispatches -f ref=main -f 'inputs[confirm]=desplegar'`.

En los dos casos `verify` exige la rama `main`. Siempre se despliega la cabeza de `main`.

## Requisitos previos (los hace la usuaria)

1. **Secretos** (P-02), en el environment `produccion` (recomendado, H-C03-02) o en los secretos del repositorio. `deploy.yml` usa cuatro:
   `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_PASSWORD`.
   `SUPABASE_SECRET_KEY` no la lee ningún job del despliegue (H-S05-06): la usan solo `evaluacion-mensual.yml` y `ritmo-diario.yml`.
   `SUPABASE_URL` debe ser exactamente `PRODUCTION_SUPABASE_ORIGIN` de `src/security/csp.js` (ADR 0011); si no, `verify` falla antes de migrar.
2. **Variable `SUPABASE_DB_POOLER_HOST`** (no es secreta), en el environment `produccion` o en las variables del repositorio. Valor: el host de *Supabase → Connect → Session pooler*, de la forma `aws-N-<región>.pooler.supabase.com` (el proyecto está en us-east-2; copiar el valor exacto, el prefijo puede ser `aws-0` o `aws-1`). Sin ella, `verify` falla y no se toca nada.
3. **Environment `produccion`** (Settings → Environments): regla de ramas de despliegue = `main`, **sin revisor requerido**. Lo usan también los crons de evaluación: con revisor, cada run programado quedaría esperando aprobación (ADR 0015 punto 6).
4. **GitHub Pages** (P-03): Settings → Pages → Source = **GitHub Actions**.
5. **Auth del proyecto Supabase** (H-S05-01). `supabase db push` aplica solo `supabase/migrations/`, no `supabase/config.toml`. En el panel de Supabase:
   - Authentication → Sign In / Providers: **Allow new users to sign up** desactivado. `verify` lo comprueba con `GET /auth/v1/settings` y falla si `disable_signup` no es `true`.
   - Authentication → URL Configuration: **Site URL** = `https://apivasa.github.io/practica_agente/` (y la misma en *Redirect URLs*).
   - Authentication → Providers → Email: contraseña mínima de **12** caracteres con minúsculas, mayúsculas y dígitos (H-S03-02). `config.toml` fija lo mismo (`minimum_password_length = 12`, `password_requirements = "lower_upper_letters_digits"`), pero solo rige en local y CI. `verify` no puede comprobar este ajuste en producción.
   - Database → Extensions: desactivar **pg_graphql** si no se usa (H-S05-03).
   No se usa `supabase config push`: llevaría al proyecto real los valores locales.
6. **Retirar `SUPABASE_ACCESS_TOKEN`.** Ningún workflow lo usa desde V-05b. Cuando haya un despliegue continuo en verde (`migrate` y «Migraciones aplicadas» en `success`), borrar el secreto del environment y del repositorio, y revocar el token en *Supabase → Account → Access Tokens*.
7. **Respaldo** antes de fusionar un PR con migraciones nuevas: ver `docs/operacion.md` › Restaurar (volcado lógico en el equipo de la usuaria, nunca en el repo).

## Qué hace el workflow

Orden: `verify` → `build-pages` → `migrate-plan` → `migrate` → `deploy-pages` → `smoke`. Lo barato y reversible falla antes de lo irreversible: si el build o la verificación de `dist/` fallan, la base no se toca.

| Job | Environment | Qué hace |
|---|---|---|
| `verify` | `produccion` | Con disparo manual, falla si `confirm` no es `desplegar`. Falla si la rama no es `main`, si falta un secreto (lista los nombres, nunca los valores) o si falta `SUPABASE_DB_POOLER_HOST` o no tiene la forma de un host de pooler de Supabase. Comprueba el prefijo `sb_publishable_`, que `SUPABASE_URL` corresponde a `SUPABASE_PROJECT_REF` y que es el origen de producción de `src/security/csp.js`. Falla si el registro de Auth está abierto. En push, espera al CI (`ci.yml`) del mismo SHA en `main`, hasta 20 min, y exige `success` (`scripts/ci/wait-ci.sh`). Después comprueba que el commit sigue siendo la punta de `main` (`scripts/ci/check-main-tip.sh`, F-11). Timeout del job: 25 min. |
| `build-pages` | `produccion` | `npm ci --ignore-scripts`, build con la URL y la clave publicable. Verifica que la CSP de `dist/index.html` no tiene orígenes locales e incluye `upgrade-insecure-requests` (ADR 0011), y que `dist/` no contiene una clave `sb_secret_…` ni apunta a Supabase local. Sube el artefacto de Pages. |
| `migrate-plan` | `produccion` | `supabase db push --db-url … --dry-run`: deja en el log las migraciones que se aplicarán. No cambia nada. |
| `migrate` | `produccion` | Repite «Commit vigente en main» en modo `--strict` (F-11). Otro dry-run, `supabase db push --db-url … --yes` y `supabase migration list --db-url …` como evidencia. Nunca aplica `seed.sql` (H-F03-07). |
| `deploy-pages` | `github-pages` | Repite «Commit vigente en main» en modo `--strict` (F-11). Publica el artefacto cuando `build-pages` y `migrate` terminaron bien. Es el único job con `pages: write` e `id-token: write`. |
| `smoke` | — | GET a la URL publicada (hasta 6 intentos): exige HTTP 200 con el título `App de control de capacidad RUN` y HTTP 200 en el JS principal (`/practica_agente/assets/…js`). |

Si falla un job, los siguientes no corren. Si `verify` da `deploy=false` (ver «Commit vigente en main»), `build-pages` y los siguientes se saltan. El grupo de concurrencia `despliegue-produccion` no cancela un despliegue en curso; si llegan varios merges, GitHub deja en cola solo el más reciente.

### Puerta de CI (V-05c)

En push, el último paso de `verify` («CI del mismo commit en verde») corre `scripts/ci/wait-ci.sh`. Consulta cada 30 s la API de Actions (permiso `actions: read`) hasta que el run de `ci.yml` del mismo commit en `main` termine. Tope: 20 min.

- `success`: sigue el despliegue.
- Otra conclusión (`failure`, `cancelled`…): `verify` falla y no se toca la BD ni Pages.
- El run de CI no aparece, no termina a tiempo o la API falla durante todo el tope: `verify` falla.

Mientras espera, el run de Despliegue queda `in_progress` en `verify`. Es normal.

Para que la puerta funcione, el CI de cada commit de `main` tiene que terminar. Por eso `ci.yml`, en `main`, agrupa por SHA y **no cancela** runs anteriores: un commit de docs posterior ya no cancela el CI del merge. En las demás ramas se sigue cancelando el run anterior.

Si el CI del merge falló o se canceló a mano: un commit posterior solo de docs no redespliega. Relanza el CI de ese commit y, cuando esté en verde, relanza el despliegue (*Re-run failed jobs*), o corrige `main` con un nuevo merge. Relanza solo si el commit sigue siendo la punta de `main` (ver abajo).

### Commit vigente en main (F-11)

En push, después de la puerta de CI, el paso «Commit vigente en main» de `verify` corre `scripts/ci/check-main-tip.sh` (permiso `contents: read`). Compara el commit del run con la punta de `main`. Evita que relanzar un run viejo republique un front anterior o migre desde un commit anterior.

Desde F-12 el disparo manual sigue la misma regla, con y sin `--strict`. Un disparo nuevo toma la punta al lanzarse y pasa. Un *Re-run* de un disparo viejo reutiliza su commit y su `confirm`: si ya entró un commit con código, falla y no publica. Para publicar la punta, lanza un disparo nuevo.

- **Es la punta:** sigue el despliegue.
- **Detrás solo hay commits de documentación:** sigue. Esos commits no despliegan y lo desplegable es idéntico. Cuenta como documentación lo mismo que `paths-ignore`: `docs/**` y `**/*.md`. Un renombrado cuenta por sus dos rutas: mover `src/x.js` a `docs/x.js` es código. Si la API devuelve 300 archivos o más, o no trae la lista, falla cerrado.
- **Lo superó un merge más nuevo con código, en el primer intento del run:** es la carrera normal entre dos merges seguidos. `verify` deja un aviso (`::warning::`), `build-pages`, `migrate-plan`, `migrate`, `deploy-pages` y `smoke` se saltan y el run termina en **`success` sin publicar**. El despliegue del commit más nuevo publica todo. `deploy-main` de `salud.yml` lo da por bueno.
- **Lo superó un commit con código y es un relanzamiento** (intento 2 o más, o intento desconocido): falla con error. No relances despliegues de commits viejos: el que vale es el de la punta.
- **Historia reescrita o divergente, o la API no responde en 3 intentos:** falla antes de cualquier efecto.

`migrate` y `deploy-pages` repiten la comprobación al empezar, en modo `--strict`: ahí un run superado falla siempre, también en el primer intento. Así *Re-run failed jobs* de un run viejo no aplica migraciones ni publica cuando ya entró un commit con código. `migrate-plan` no la repite: solo hace un dry-run.

**Rojo esperado (H-F11-06).** Si entra un merge con código mientras un run espera la aprobación de `migrate` o está migrando, `deploy-pages` (o `migrate`) falla en el primer intento. El error dice «Rojo esperado (H-F11-06)» y «no relances este run». No es un defecto y no se toca producción en ese job. **No lo relances.** El run del commit nuevo está en cola (concurrencia `despliegue-produccion`): aplica las migraciones y publica el front juntos. Comprueba que ese run termina en `success`. Desde F-13, mientras ese run más nuevo está pendiente (hasta 90 min), `salud.yml` muestra `deploy-main` como aviso y no abre issue. Si la punta falla o pasa de 90 min sin terminar, la corrida siguiente de `salud.yml` sí abre el issue (ver `docs/operacion.md`).

El `status` que devuelve la API de comparación se sanea a letras minúsculas y `_` antes de imprimirlo en el mensaje de error (H-F11-05).

La lista de «solo documentación» del script y `paths-ignore` de `deploy.yml` deben ser la misma. Si se cambia una, hay que cambiar la otra; una prueba en `tests/scripts/f11-fixes.test.js` falla si no coinciden.

### Conexión a la BD

Sin `supabase link` y sin token de cuenta (H-V05-01). Cada paso de migración carga `scripts/ci/db-url.sh`, que arma la cadena del pooler de sesión (puerto 5432, usuario `postgres.<ref>`) con `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` y `SUPABASE_DB_POOLER_HOST`. La contraseña se codifica y se enmascara (`::add-mask::`) antes de usarla; la cadena nunca se imprime. Si el host no es un pooler de Supabase, el script falla sin enviar la contraseña.

## Qué verificar después de cada despliegue

- El job `smoke` en verde y la URL abre la pantalla de inicio de sesión.
- En el log de `migrate-plan`, la lista del dry-run, con la cadena de conexión tapada como `***`.
- En el log de `migrate`, la salida de `supabase migration list`; o Supabase → Database → Migrations.
- Supabase → Authentication → Users: **sin** las cuentas de `seed.sql`.
- En el navegador (DevTools → Network): las peticiones van solo a `https://<ref>.supabase.co`.
- Después de validar, activar los workflows programados: variable de repositorio `EVALUATION_ENABLED = true` (P-05). Basta la fase B en modo `anonimo` en VERDE (ADR 0015, enmienda S-05b). Lista de pasos: `docs/operacion.md` › Activación de producción (P-05).
- Antes de dar de alta usuarios reales o anunciar la URL: fase B en modo `roles` en VERDE, Site URL, redirecciones y política de contraseñas en el panel de Supabase (H-S05-01), y sin copias de `SUPABASE_SECRET_KEY` a nivel de repositorio (H-C03-02).

## Precauciones

- **No relanzar despliegues de commits viejos.** Si ya entró un commit más nuevo con código, su despliegue cubre al anterior; el relanzamiento falla en «Commit vigente en main».
- **Fusionar de a uno.** Cada merge despliega. Desde V-05c, el despliegue del segundo PR espera al CI de `main` que prueba los dos juntos. Igual conviene fusionar de a uno: si ese CI falla, ninguno queda publicado por partes y el diagnóstico es más simple.
- **No cancelar a mano el CI de `main`.** Si se cancela, el despliegue de ese commit falla en `verify`.
- `main` no tiene protección de rama (H-V05b-01). Un push directo a `main` con CI en verde despliega sin revisión de PR.
- Un fallo de despliegue lo detecta `salud.yml` con el check `deploy-main` (ver «Vigilancia»); no hace falta revisarlo a mano.

## Vigilancia

`salud.yml` revisa cada 6 h el último run de `deploy.yml` en `main` (check `deploy-main`, V-04b). Si falló o lleva más de 90 min sin terminar (antes 60; la suma de timeouts de los jobs ronda 75 min desde V-05c), abre o comenta el issue `salud`. Un despliegue solo cancelado deja un aviso sin issue. Desde F-13, un despliegue fallido con un run más nuevo pendiente desde hace 90 min o menos también deja un aviso sin issue (rojo esperado H-F11-06). Qué hacer ante cada alerta: `docs/operacion.md` › Salud del sistema.

## Cómo revertir

- **Front:** no existe «desplegar una versión anterior». Se abre un PR que revierte el código; su merge vuelve a desplegar. Para retirar el sitio de inmediato: Settings → Pages → *Unpublish*.
- **Migraciones:** `db push` no tiene "deshacer". No se revierte el archivo de `supabase/migrations/`: si se borra, `db push` falla y el front revertido tampoco se publica. Se escribe una migración nueva que corrige el esquema. Si borra tablas o columnas con datos, es compuerta del usuario (CLAUDE.md §3). Ante daño de datos: `docs/operacion.md` › Restaurar.
- **Automatizaciones:** poner `EVALUATION_ENABLED` a `false` detiene la evaluación mensual y el ritmo diario.

Detalle de fallos por job y diagnóstico: `docs/operacion.md` › Despliegue.
