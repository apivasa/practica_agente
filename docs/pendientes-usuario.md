# Pendientes del usuario

El orquestador solo escribe aquí cuando algo **de verdad** te necesita (ver reglas de parada en `CLAUDE.md`). Responde debajo de cada pendiente con `Respuesta:`; en el siguiente ciclo se aplica y pasa a "Resueltos".

## Abiertos

### Compuertas técnicas (solo bloquean la publicación, V-05)

- **P-03 · GitHub Pages (decidido 2026-11-19: el repo pasa a público).** Revisado: el historial del repo no contiene secretos.
  1. GitHub → `practica_agente` → **Settings → General** → al final, *Danger Zone* → **Change visibility** → **Make public** y confirma.
  2. **Settings → Pages** → *Build and deployment* → *Source*: **GitHub Actions**. No hace falta nada más; `deploy.yml` publica en `https://apivasa.github.io/practica_agente/`.
  Respuesta:

### Decisiones de negocio (no bloquean el avance; el sistema usa el valor por defecto indicado)

- **Q-01 · Lógica de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad.** Por defecto: disponibilidad y MTTR y tiempo de ciclo = promedio en ventana de 30 días; continuidad y observabilidad = cobertura (% de aplicaciones que cumplen). Umbrales de ejemplo en semillas.
  Respuesta:
- **Q-02 · Fuentes automáticas de mediciones.** ¿De qué sistemas vendrían los datos (por ejemplo, herramienta de escaneo, monitoreo, ITSM) y con qué formato? Por defecto: captura manual + CSV.
  Respuesta:
- **Q-03 · ¿Amarillo en el mes 2 escala igual que rojo?** Por defecto: no; amarillo en mes 2 mantiene la restricción del mes 1 (no change nuevo). Es configurable.
  Respuesta:
- **Q-04 · Canal externo de alertas.** Por defecto: bandeja dentro de la app + issue de GitHub. Opciones: correo (requiere un proveedor como Resend con su API key), Microsoft Teams (webhook) u otro.
  Respuesta:

## Resueltos

- **P-02 · Proyecto Supabase propio** — resuelto el 2026-11-19. Proyecto `KPIs` (ref `oehtspdtpwdhfhhhkgao`, us-east-2), separado de Café & Tinta. El usuario cargó en GitHub los 6 secretos: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Las sesiones de Claude no pueden leer secretos: `deploy.yml` (V-05) debe verificar que existen y fallar con un mensaje claro si falta alguno.
- **P-01 · Acceso al repositorio** — concedido el 2026-11-19.
