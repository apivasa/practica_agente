# S-04 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0011-csp-y-anti-framing.md` (nuevo, Aceptado)
Salud: CI y Seguridad en `success` sobre el último commit (7290486; CI 44612384715, Seguridad 44612384789) y los dos anteriores. Job `dast` 162–185 s en tres runs (base nueva en `docs/operacion.md`, alerta > 6 min, timeout 30 min). Total de pared de Seguridad pasa de ~95 s a ~3 min. Sin workflows programados de negocio aún; `salud.yml` sigue pendiente de producción.

Hallazgos:
1. **Plugin CSP (vite.config.js):** plugin local de 15 líneas, `apply: 'build'`, `transformIndexHtml` con `head-prepend`; sin dependencias nuevas (`package.json` y lockfile sin cambios). Lógica pura en `src/security/csp.js`. Conforme a ADR 0001 y 0009.
2. **Fallo del build con otro origen vs V-05:** no bloquea. `PRODUCTION_SUPABASE_ORIGIN` = `https://oehtspdtpwdhfhhhkgao.supabase.co` coincide con el ref de P-02; la comparación es por `URL.origin`, así que barra final o ruta en el secreto `SUPABASE_URL` no rompen. Build sin variable (job build de CI) también pasa. Recomendación para V-05 (no bloquea aquí): `deploy.yml` debe verificar que la CSP de `dist/` no lleva orígenes loopback y sí `upgrade-insecure-requests`; registrado en ADR 0011.
3. **Ref del proyecto en código:** es infraestructura pública, no configuración de un KPI; aceptable como lista cerrada defensiva. Cambiar de proyecto exige PR (documentado en ADR 0011 y en el runbook).
4. **Anti-framing:** primer `import` de `src/main.js`; los módulos ES se evalúan en orden, así que se ejecuta antes que el cliente Supabase y que `boot()`. Al vaciar `body`, `#app` no existe y la app no arranca. Correcto.
5. **Job dast:** imagen ZAP por digest `sha256`, acciones por SHA, `persist-credentials: false`, `npm ci --ignore-scripts`, hereda `permissions: contents: read`, sin clave secreta (lo verifica `workflows.test.js`), ZAP pasivo solo contra 127.0.0.1, código de salida comprobado, sin `|| true` ni reglas `IGNORE`. `--network host` aceptable en runner efímero.
6. **Riesgos aceptados H-S04-01/02:** coherentes con GitHub Pages (ADR 0001): sin cabeceras no hay `frame-ancestors`; el iframe con `sandbox` sin scripts solo muestra una página vacía de un SPA. CSP ausente en `vite dev` solo afecta al entorno local. Aceptados.
7. **Salud (observación, no bloquea):** en el último run `pentest-api` tardó 169 s (base 74–93 s), probablemente por competir con `dast` levantando otro Supabase local en paralelo. Primera ocurrencia; si se repite en el siguiente run, pasa a ítem de plan (regla de `docs/operacion.md`).
8. **Runbook:** añadida en `docs/operacion.md` la sección 6b (qué hacer si falla `dast`) y la línea base del job.
