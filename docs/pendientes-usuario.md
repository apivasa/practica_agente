# Pendientes del usuario

El orquestador solo escribe aquí cuando algo **de verdad** te necesita (ver reglas de parada en `CLAUDE.md`). Responde debajo de cada pendiente con `Respuesta:`; en el siguiente ciclo se aplica y pasa a "Resueltos".

## Abiertos

### Compuertas técnicas (solo bloquean la publicación, V-05)

- **P-02 · Proyecto Supabase de producción.** Crea un proyecto en Supabase y agrega en GitHub → Settings → Secrets and variables → Actions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. No pegues los valores aquí.
  Respuesta:
- **P-03 · GitHub Pages.** En Settings → Pages, elige "Source: GitHub Actions". Si el repo es privado, Pages requiere un plan que lo permita; si no, decide si el repo pasa a público.
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

- **P-01 · Acceso al repositorio** — concedido el 2026-11-19.
