# practica_agente

Curso IA — **App de control de capacidad por indicadores RUN**, construida en modo autónomo por un orquestador y cinco subagentes.

- Diseño: [`docs/diseno.md`](docs/diseno.md)
- Plan maestro y orden de ejecución: [`docs/plan-maestro.md`](docs/plan-maestro.md)
- Reglas del modo autónomo: [`CLAUDE.md`](CLAUDE.md)
- Subagentes: [`.claude/agents/`](.claude/agents/) (desarrollador, tester, seguridad, arquitecto-sre, documentador)
- Lo que necesita tu decisión: [`docs/pendientes-usuario.md`](docs/pendientes-usuario.md)
- Estado y log de ciclos: [`docs/estado.md`](docs/estado.md)

Stack: GitHub Pages (front estático) · Supabase (BD, login, RLS) · GitHub Actions (cálculo mensual, alertas, CI/CD).
