# practica_agente

Curso IA — **App de control de capacidad por indicadores RUN**, construida en modo autónomo por un orquestador y cinco subagentes.

- Diseño: [`docs/diseno.md`](docs/diseno.md)
- Plan maestro y orden de ejecución: [`docs/plan-maestro.md`](docs/plan-maestro.md)
- Reglas del modo autónomo: [`CLAUDE.md`](CLAUDE.md)
- Subagentes: [`.claude/agents/`](.claude/agents/) (desarrollador, tester, seguridad, arquitecto-sre, documentador)
- Lo que necesita tu decisión: [`docs/pendientes-usuario.md`](docs/pendientes-usuario.md)
- Estado y log de ciclos: [`docs/estado.md`](docs/estado.md)

Stack: GitHub Pages (front estático) · Supabase (BD, login, RLS) · GitHub Actions (cálculo mensual, alertas, CI/CD).

## Desarrollo

Requisitos: Node 20 o superior; Supabase CLI y Docker para la base local.

```bash
npm ci              # o npm install si aún no existe package-lock.json
npm run dev         # servidor de desarrollo Vite
npm run build       # genera dist/ (sitio estático para GitHub Pages)
npm run preview     # sirve dist/ en local
npm run lint        # ESLint
npm run test:unit   # pruebas unitarias (node:test) con cobertura
npm run test:e2e    # pruebas e2e con Playwright (requiere build)
npm run test:db     # pruebas pgTAP (requiere `supabase start` o `supabase db start`)
```

Variables de build: copia `.env.example` a `.env` y rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (clave publicable `sb_publishable_...`). Nunca uses la clave secreta en el front.
