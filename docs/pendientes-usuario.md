# Pendientes del usuario

El orquestador solo escribe aquí cuando algo **de verdad** te necesita (ver reglas de parada en `CLAUDE.md`). Responde debajo de cada pendiente con `Respuesta:`; en el siguiente ciclo se aplica y pasa a "Resueltos".

## Abiertos

### Compuertas técnicas

- **P-04 · Limpieza y configuración de GitHub (no bloquea).** Desde las sesiones de Claude no se pueden borrar ramas ni cambiar la configuración del repo. (1) Borra la rama `ensayo/s01-secreto` (contiene un token FALSO de ensayo) y las ramas `item/*` y `docs/*` ya fusionadas: en GitHub → Branches. (2) H-007: en Settings → Code security activa *Secret scanning*, *Push protection* y *Dependabot security updates*.
  Respuesta:

- **P-05 · Activar la evaluación en producción (después de publicar, V-05).** Los workflows `evaluacion-mensual.yml` y `ritmo-diario.yml` solo corren contra Supabase real si existe la variable de repositorio `EVALUATION_ENABLED = true` (GitHub → Settings → Secrets and variables → Actions → pestaña *Variables*). Créala solo cuando el orquestador avise que el esquema está desplegado.
  Respuesta:

- **P-06 · Primer despliegue a producción (V-05) — LISTO PARA LANZAR.** Registrado como aprobado por una sesión interactiva (2026-11-19). V-05 (`deploy.yml`, PR #27), S-05 fase A (PR #26, VERDE) y M-06 (PR #28) ya están en `main`. La sesión programada **no pudo lanzar** el despliegue: el control de permisos del entorno bloqueó la acción, así que el primer despliegue lo dispara el usuario. Antes, confirmar: (1) environment `produccion` con regla de ramas `main`, **sin revisor** y con los 6 secretos; (2) en Supabase: *Allow new users to sign up* desactivado, Site URL y Redirect URL `https://apivasa.github.io/practica_agente/`, contraseña mínima 12 con complejidad, `pg_graphql` desactivado si no se usa; (3) volcado lógico previo (ver `docs/operacion.md` › Restaurar). Lanzar: Actions → **Despliegue** → *Run workflow* en `main`, `confirm` = `desplegar`. Después el orquestador corre S-05b (pentest fase B) y avisa para P-05. Si prefieres que lo lance el orquestador, responde aquí "lanzar" (puede volver a quedar bloqueado por permisos).
  Respuesta: Aprobado. Usuario confirmó environment `produccion` y registro cerrado (2026-11-20 18:45). **Desplegado con éxito** (run 44838844787) tras dos arreglos de deploy.yml (`db push --remote` y `--yes`). URL: https://apivasa.github.io/practica_agente/. RESUELTO.
  **2026-11-20 18:07:** el orquestador lanzó `deploy.yml` a pedido del usuario (run 44834411127). Falló en *verificar configuración*, sin publicar nada: «El registro de usuarios está abierto en Supabase Auth». **Falta:** Supabase → Authentication → Sign In / Providers → desactivar *Allow new users to sign up* (y revisar el resto del punto 2). Luego relanzar (o responder aquí "relanzar").

### Decisiones de negocio (no bloquean el avance; el sistema usa el valor por defecto indicado)

- **Q-01 · Lógica de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad.** Por defecto: disponibilidad y MTTR y tiempo de ciclo = promedio en ventana de 30 días; continuidad y observabilidad = cobertura (% de aplicaciones que cumplen). Umbrales de ejemplo en semillas.
  Respuesta:
- **Q-02 · Fuentes automáticas de mediciones.** ¿De qué sistemas vendrían los datos (por ejemplo, herramienta de escaneo, monitoreo, ITSM) y con qué formato? Por defecto: captura manual + CSV.
  Respuesta:
- **Q-03 · ¿Amarillo en el mes 2 escala igual que rojo?** Por defecto: no; amarillo en mes 2 mantiene la restricción del mes 1 (no change nuevo). Es configurable.
  Respuesta:
- **Q-04 · Canal externo de alertas.** Por defecto: bandeja dentro de la app (los issues de GitHub se descartaron porque el repo es público, ADR 0008 punto 7). Opciones: correo (requiere un proveedor como Resend con su API key), Microsoft Teams (webhook) u otro.
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

- **P-03 · GitHub Pages** — resuelto el 2026-11-19. Repo público y Pages activado (verificado por API: `visibility: public`, `has_pages: true`). Fuente elegida por el usuario: GitHub Actions; si el primer `deploy.yml` falla por la fuente, revisar Settings → Pages. URL esperada: `https://apivasa.github.io/practica_agente/`.
- **P-02 · Proyecto Supabase propio** — resuelto el 2026-11-19. Proyecto `KPIs` (ref `oehtspdtpwdhfhhhkgao`, us-east-2), separado de Café & Tinta. El usuario cargó en GitHub los 6 secretos: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Las sesiones de Claude no pueden leer secretos: `deploy.yml` (V-05) debe verificar que existen y fallar con un mensaje claro si falta alguno.
- **P-01 · Acceso al repositorio** — concedido el 2026-11-19.
