# Pendientes del usuario

El orquestador solo escribe aquí cuando algo **de verdad** te necesita (ver reglas de parada en `CLAUDE.md`). Responde debajo de cada pendiente con `Respuesta:`; en el siguiente ciclo se aplica y pasa a "Resueltos".

## Abiertos

### Compuertas técnicas

- **P-04 · Limpieza y configuración de GitHub (no bloquea).** Desde las sesiones de Claude no se pueden borrar ramas ni cambiar la configuración del repo. (1) Borra la rama `ensayo/s01-secreto` (contiene un token FALSO de ensayo) y las ramas `item/*` y `docs/*` ya fusionadas: en GitHub → Branches. (2) H-007: en Settings → Code security activa *Secret scanning*, *Push protection* y *Dependabot security updates*.
  Respuesta:

- **P-05 · Activar la evaluación en producción — LISTO (2026-11-20).** El pentest fase B anónimo (S-05b, PR #44, run 44839422473) quedó en VERDE. Lista completa en `docs/operacion.md` › «Activación de producción (P-05)». Resumen: (1) `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en el environment `produccion`; `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` deben **quedarse también a nivel de repositorio** (los usa `salud.yml`); (2) crear la variable `EVALUATION_ENABLED = true`; (3) correr a mano `ritmo-diario` (paso «Evaluar» con `errors: 0`) y luego `salud.yml`. Recomendado pronto: sin consultas el plan gratuito de Supabase puede pausar el proyecto hacia el 27-nov. Detalle original: Los workflows `evaluacion-mensual.yml` y `ritmo-diario.yml` solo corren contra Supabase real si existe la variable de repositorio `EVALUATION_ENABLED = true` (GitHub → Settings → Secrets and variables → Actions → pestaña *Variables*). Créala solo cuando el orquestador avise que el esquema está desplegado.
  Respuesta:

- **P-06 · Primer despliegue a producción (V-05) — LISTO PARA LANZAR.** Registrado como aprobado por una sesión interactiva (2026-11-19). V-05 (`deploy.yml`, PR #27), S-05 fase A (PR #26, VERDE) y M-06 (PR #28) ya están en `main`. La sesión programada **no pudo lanzar** el despliegue: el control de permisos del entorno bloqueó la acción, así que el primer despliegue lo dispara el usuario. Antes, confirmar: (1) environment `produccion` con regla de ramas `main`, **sin revisor** y con los 6 secretos; (2) en Supabase: *Allow new users to sign up* desactivado, Site URL y Redirect URL `https://apivasa.github.io/practica_agente/`, contraseña mínima 12 con complejidad, `pg_graphql` desactivado si no se usa; (3) volcado lógico previo (ver `docs/operacion.md` › Restaurar). Lanzar: Actions → **Despliegue** → *Run workflow* en `main`, `confirm` = `desplegar`. Después el orquestador corre S-05b (pentest fase B) y avisa para P-05. Si prefieres que lo lance el orquestador, responde aquí "lanzar" (puede volver a quedar bloqueado por permisos).
  Respuesta: Aprobado. Usuario confirmó environment `produccion` y registro cerrado (2026-11-20 18:45). **Desplegado con éxito** (run 44838844787) tras dos arreglos de deploy.yml (`db push --remote` y `--yes`). URL: https://apivasa.github.io/practica_agente/. RESUELTO.
  **2026-11-20 18:07:** el orquestador lanzó `deploy.yml` a pedido del usuario (run 44834411127). Falló en *verificar configuración*, sin publicar nada: «El registro de usuarios está abierto en Supabase Auth». **Falta:** Supabase → Authentication → Sign In / Providers → desactivar *Allow new users to sign up* (y revisar el resto del punto 2). Luego relanzar (o responder aquí "relanzar").

- **P-07 · Antes de fusionar V-05b (despliegue continuo, PR #45).** (1) Crea la variable (no secreta) `SUPABASE_DB_POOLER_HOST` en el environment `produccion` con el host exacto de Supabase → Connect → *Session pooler* (forma `aws-N-us-east-2.pooler.supabase.com`). Sin ella, el merge dispara un despliegue que falla de forma segura en `verify`. Responde aquí "creada" y el orquestador fusiona. (2) Recomendado (H-V05b-01, media): ruleset en `main` que exija PR y los checks de CI y Seguridad y bloquee force-push y borrado (con bypass para que el orquestador pueda actualizar `docs/estado.md`, o dime si prefieres que el candado vaya por PR). (3) Después del primer despliegue continuo en verde: borrar y revocar `SUPABASE_ACCESS_TOKEN` (ya no lo usa ningún workflow). (4) En el panel de Auth de producción: contraseña mínima 12 con minúsculas, mayúsculas y dígitos; Site URL y redirecciones = URL de Pages; desactivar `pg_graphql` si no se usa.
  Respuesta: **variable creada** (2026-11-20 22:33). `SUPABASE_DB_POOLER_HOST` es ahora **variable** (no secreto) del environment `produccion`, valor `aws-1-us-east-2.pooler.supabase.com` (verificado en Supabase con el usuario `postgres.oehtspdtpwdhfhhhkgao` del proyecto KPIs; el primer intento había copiado el host de otro proyecto). El secreto homónimo se borró. El orquestador puede fusionar V-05b (#45). Pendiente del usuario: recrear `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` a nivel de repositorio (los borró; los usa `salud.yml`). `EVALUATION_ENABLED=true` ya creada (P-05 en curso).

- **P-08 · Antes de dar de alta usuarios reales (ADR 0015, enmienda S-05b).** Faltan: fase B del pentest en modo `roles` (requiere 4 cuentas de prueba ficticias en producción y el secreto `S05_TEST_USERS`), los ajustes del panel de P-07 (4) y que no quede `SUPABASE_SECRET_KEY` a nivel de repositorio. No bloquea el avance del orquestador.
  Respuesta:

- **P-09 · Clave de Resend para los correos de alerta (C-05).** (1) Crea una cuenta en resend.com y una API key con permiso *Sending access*. (2) Guárdala como secreto `RESEND_API_KEY` en el environment `produccion` de GitHub. (3) Sin dominio propio, Resend solo envía a tu propio correo; para que lleguen a todos los usuarios hay que verificar un dominio en Resend y decirme la dirección remitente (por ejemplo `alertas@tudominio.com`). Mientras no exista el secreto, el envío queda apagado sin romper nada.
  Respuesta:

- **P-10 · Publicar en la web lo nuevo (Excel y correo).** V-07 (#48) y C-05 (#49) ya están en `main`, pero la web sigue con la versión anterior: el despliegue a producción no es automático hasta fusionar V-05b (P-07) y la sesión no tiene permiso para lanzarlo. Lánzalo tú: GitHub → Actions → **Despliegue** → *Run workflow* en `main`, `confirm` = `desplegar`. Aplica la migración aditiva de C-05 (`alerts.emailed_at`, `email_attempts`). Antes de anunciar la plantilla a los custodios, ábrela una vez en Microsoft Excel (solo se probó con LibreOffice). Si prefieres, responde "creada" en P-07 y el despliegue será automático desde entonces.
  Respuesta:

### Decisiones de negocio (no bloquean el avance; el sistema usa el valor por defecto indicado)

- **Q-01 · Lógica de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad.** Por defecto: disponibilidad y MTTR y tiempo de ciclo = promedio en ventana de 30 días; continuidad y observabilidad = cobertura (% de aplicaciones que cumplen). Umbrales de ejemplo en semillas.
  Respuesta:
- **Q-03 · ¿Amarillo en el mes 2 escala igual que rojo?** Por defecto: no; amarillo en mes 2 mantiene la restricción del mes 1 (no change nuevo). Es configurable.
  Respuesta:

- **Q-05 · Confirmar interpretaciones de escalada (ADR 0003).** El diseño no las cubre; el sistema ya las aplica por defecto: (a) la racha de meses fuera de verde se reinicia en cada trimestre; (b) un mes sin evaluar corta la racha; (c) un mes 3 en amarillo tras dos en rojo baja de congelado a restringido; (d) una excepción "arrancar algo urgente" con la unidad congelada no levanta el congelamiento, solo autoriza ese inicio. Responde "ok" o indica cuál cambiar.
  Respuesta:
- **Q-06 · Ritmo esperado de vulnerabilidades (M-05).** Por defecto: la meta del mes en curso se prorratea por días (al día 10 de un mes de 30 se esperan 10/30 de la meta mensual), el ritmo se calcula contra el 100 % del pendiente, y las P0/P1 del mes 3 resueltas cuentan para el cumplimiento del trimestre actual. Responde "ok" o indica cuál cambiar.
  Respuesta:

- **Q-07 · Color mensual de vulnerabilidades por criticidad (M-06, ADR 0016).** Por defecto: (a) el indicador toma el peor color entre P0/P1 y P2/P3; (b) el valor mostrado es el de la categoría con peor color; (c) los umbrales negociados por unidad (overrides del compromiso) no se aplican a las categorías, que usan 96 % y 85 %; (d) si una categoría no se puede evaluar, el indicador no sale verde. Responde "ok" o indica cuál cambiar.
  Respuesta:

- **Q-08 · Categorías libres frente a mediciones por categoría (H-QA-M12-03, no bloquea).** La gestora puede nombrar libremente las categorías de un indicador de meta acumulada, pero la base solo admite mediciones por categoría con `P0P1` y `P2P3`: un indicador con categoría "Alta" se puede crear y comprometer, pero no recibe mediciones. Por defecto: se mantiene así (solo vulnerabilidades usa categorías). Opciones: (a) limitar el formulario a P0P1/P2P3; (b) admitir en mediciones cualquier categoría definida en el indicador. Responde "ok", "a" o "b".
  Respuesta:

## Resueltos

- **Q-04 · Canal externo de alertas** — resuelto el 2026-11-20: correo con Resend, a cada destinatario (las mismas alertas de su bandeja). Desbloquea C-05; el secreto queda en P-09.
- **Q-02 · Fuentes de mediciones** — resuelto el 2026-11-20: por ahora todo llega en un archivo de Excel. V-07 pasa a importación .xlsx.

- **P-03 · GitHub Pages** — resuelto el 2026-11-19. Repo público y Pages activado (verificado por API: `visibility: public`, `has_pages: true`). Fuente elegida por el usuario: GitHub Actions; si el primer `deploy.yml` falla por la fuente, revisar Settings → Pages. URL esperada: `https://apivasa.github.io/practica_agente/`.
- **P-02 · Proyecto Supabase propio** — resuelto el 2026-11-19. Proyecto `KPIs` (ref `oehtspdtpwdhfhhhkgao`, us-east-2), separado de Café & Tinta. El usuario cargó en GitHub los 6 secretos: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Las sesiones de Claude no pueden leer secretos: `deploy.yml` (V-05) debe verificar que existen y fallar con un mensaje claro si falta alguno.
- **P-01 · Acceso al repositorio** — concedido el 2026-11-19.
