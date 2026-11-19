# ADR 0001 — Stack de la versión académica

Estado: Aceptado (decisión del diseño, 2026-11-19)

## Decisión
- Front: web estática construida con Vite (JavaScript, ES modules) y publicada en GitHub Pages por GitHub Actions.
- Datos, login y roles: Supabase (Postgres + Auth) con seguridad por filas (RLS) para que cada líder vea solo su unidad.
- Cálculo mensual, ritmo diario y alertas: GitHub Actions programados que usan la service role key desde secretos.
- Lógica de negocio en `engine/` como funciones puras, compartidas por el front y las Actions.
- Pruebas: Vitest (unitarias), pgTAP vía `supabase test db` (BD y RLS), Playwright (e2e). CI levanta Supabase local con la CLI.

## Consecuencias
- Sin servidor propio: toda operación privilegiada vive en Actions, nunca en el navegador.
- El desarrollo y las pruebas no requieren credenciales reales; solo la publicación (P-02, P-03).
- Cambiar cualquiera de estos puntos requiere un ADR nuevo con decisión del usuario.
