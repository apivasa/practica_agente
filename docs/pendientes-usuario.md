# Pendientes del usuario

El orquestador solo escribe aquí cuando algo **de verdad** te necesita (ver reglas de parada en `CLAUDE.md`). Responde debajo de cada pendiente con `Respuesta:`; en el siguiente ciclo se aplica y pasa a "Resueltos".

## Abiertos

### Compuertas técnicas

- **P-04 · Limpieza y configuración de GitHub (no bloquea).** Desde las sesiones de Claude no se pueden borrar ramas ni cambiar la configuración del repo. (1) Borra la rama `ensayo/s01-secreto` (contiene un token FALSO de ensayo) y las ramas `item/*` y `docs/*` ya fusionadas: en GitHub → Branches. (2) H-007: en Settings → Code security activa *Secret scanning*, *Push protection* y *Dependabot security updates*.
  Respuesta:

- **P-08 · Antes de dar de alta usuarios reales (ADR 0015, enmienda S-05b).** Recomendado también (de P-07): ruleset en `main` que exija PR y los checks de CI y Seguridad y bloquee force-push y borrado (H-V05b-01, media; con bypass para que el orquestador actualice `docs/estado.md`); borrar y revocar `SUPABASE_ACCESS_TOKEN` (ya no lo usa ningún workflow: el despliegue continuo 44875933592 salió en verde sin él). Faltan: fase B del pentest en modo `roles` (requiere 4 cuentas de prueba ficticias en producción y el secreto `S05_TEST_USERS`), los ajustes del panel de P-07 (4) y que no quede `SUPABASE_SECRET_KEY` a nivel de repositorio. No bloquea el avance del orquestador.
  Respuesta:

- **P-09 · Clave de Resend para los correos de alerta (C-05).** (1) Crea una cuenta en resend.com y una API key con permiso *Sending access*. (2) Guárdala como secreto `RESEND_API_KEY` en el environment `produccion` de GitHub. (3) Sin dominio propio, Resend solo envía a tu propio correo; para que lleguen a todos los usuarios hay que verificar un dominio en Resend y decirme la dirección remitente (por ejemplo `alertas@tudominio.com`). Mientras no exista el secreto, el envío queda apagado sin romper nada.
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

- **P-05 · Evaluación en producción** — resuelto el 2026-11-20 23:09 (`EVALUATION_ENABLED=true`, PR #52, ritmo-diario y salud en verde).
- **P-06 · Primer despliegue** — resuelto el 2026-11-20 (run 44838844787). URL: https://apivasa.github.io/practica_agente/.
- **P-07 · Variable del pooler** — resuelto el 2026-11-20 (variable `SUPABASE_DB_POOLER_HOST` en `produccion`). V-05b+V-05c fusionado (#45); primer despliegue continuo en verde (run 44875933592, 2026-11-21).
- **P-10 · Publicar Excel y correo** — resuelto el 2026-11-21 por el despliegue continuo de #45: V-07, C-05, C-06 y V-07b ya están en producción. Sigue en pie abrir una vez la plantilla en Microsoft Excel antes de anunciarla.

- **Q-04 · Canal externo de alertas** — resuelto el 2026-11-20: correo con Resend, a cada destinatario (las mismas alertas de su bandeja). Desbloquea C-05; el secreto queda en P-09.
- **Q-02 · Fuentes de mediciones** — resuelto el 2026-11-20: por ahora todo llega en un archivo de Excel. V-07 pasa a importación .xlsx.

- **P-03 · GitHub Pages** — resuelto el 2026-11-19. Repo público y Pages activado (verificado por API: `visibility: public`, `has_pages: true`). Fuente elegida por el usuario: GitHub Actions; si el primer `deploy.yml` falla por la fuente, revisar Settings → Pages. URL esperada: `https://apivasa.github.io/practica_agente/`.
- **P-02 · Proyecto Supabase propio** — resuelto el 2026-11-19. Proyecto `KPIs` (ref `oehtspdtpwdhfhhhkgao`, us-east-2), separado de Café & Tinta. El usuario cargó en GitHub los 6 secretos: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Las sesiones de Claude no pueden leer secretos: `deploy.yml` (V-05) debe verificar que existen y fallar con un mensaje claro si falta alguno.
- **P-01 · Acceso al repositorio** — concedido el 2026-11-19.
