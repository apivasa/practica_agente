# Cambios

Una línea por ítem, la más reciente arriba.

- 2026-11-19 · V-06 · Manual por rol (gestora, custodio, comité y líder), guía para configurar indicadores, compromisos, mediciones CSV y el caso de vulnerabilidades, y modelo de datos con RLS por rol.
- 2026-11-19 · V-01 + V-02 + V-03 (#21) · El líder ve sus indicadores, color, meta, ritmo, restricciones, excepciones y alertas; el comité ve la matriz unidad × indicador, excepciones vigentes y alertas; la gestora ve la completitud por custodio y KPI.
- 2026-11-19 · C-02 (#20) · El comité aprueba excepciones (inicio puntual de change o suspensión total) con motivo y vencimiento de hasta 90 días, y revoca las propias.
- 2026-11-19 · fix (#19) · Las pruebas de excepciones usan fechas relativas a hoy y no caducan.
- 2026-11-19 · M-02 + M-03 + M-04 (#18) · La gestora da de alta y edita indicadores y asigna custodio; el custodio registra compromisos con umbral negociado y paquete, y carga mediciones a mano o por CSV validado.
- 2026-11-19 · S-04 (#17) · El front publica una CSP estricta y no se deja enmarcar; DAST con ZAP y pruebas de XSS e inyección CSV en CI.
- 2026-11-19 · fix (#16) · Pruebas de seguridad alineadas con las convenciones del front y las excepciones.
- 2026-11-19 · C-03 + C-04 (#15) · Evaluación mensual y ritmo diario programados en Actions, idempotentes, con alertas de cambio de color, atraso, ingreso de P0/P1 y vencimiento de excepciones (se activan tras el despliegue).
- 2026-11-19 · F-05 (#14) · Login con correo y contraseña y llegada a la pantalla de cada rol; elección de rol si hay varios.
- 2026-11-19 · S-02 + S-03 (#13) · Modelo de amenazas y pentest de la API y RLS por rol (matriz rol × tabla × operación, IDOR, JWT) en cada PR.
- 2026-11-19 · fix (#12) · El login por correo funciona en local con el registro abierto desactivado.
- 2026-11-19 · M-05 (#7) · Motor de vulnerabilidades: paquete trimestral, P0/P1 nuevas, ritmo esperado, metas mensuales y cumplimiento por criticidad.
- 2026-11-19 · S-01 (#6) · Pipeline de seguridad: gitleaks, semgrep, npm audit, CodeQL y pruebas de seguridad en cada PR y cada semana.
- 2026-11-19 · F-03 + F-04 + F-06 (#5) · Modelo de datos con las 9 tablas y auditoría, RLS por rol y datos semilla ficticios.
- 2026-11-19 · C-01 · Motor de escalada: calcula el candado de la unidad (normal, restringido, congelado, excepción), aplica excepciones con vencimiento, deja configurable el amarillo en mes 2 (Q-03) y calcula el arrastre del paquete de vulnerabilidades.
- 2026-11-19 · M-01 · Motor de color: valida indicadores genéricos de 7 atributos y calcula su color (verde, amarillo, rojo o sin evaluar), con umbrales por categoría, mínimo de muestra y empates a favor.
- 2026-11-19 · F-01 + F-02 · Estructura del proyecto (front Vite, `supabase/`, `engine/`) y CI que corre lint, pruebas unitarias, build, pgTAP y e2e en cada push y PR.
