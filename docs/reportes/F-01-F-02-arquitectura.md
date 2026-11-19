# F-01-F-02 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: no (falta la carpeta `engine/` exigida por F-01; todo lo demás está alineado)
Requiere decisión del usuario: no
ADR creados o actualizados:
- `docs/adr/0001-stack.md`: la línea de pruebas pasa de Vitest a "node:test (runner nativo), ver ADR 0002". Así no hay contradicción con la rama M-01 al integrar.
- `docs/adr/0004-disparadores-ci.md` (Aceptado): CI en `item/**` y `fix/**` además de PR; `lockfile.yml` relanza el CI con `workflow_dispatch` y `actions: write`. Se numera 0004 porque 0002 (M-01) y 0003 (C-01) ya están tomados en otras ramas.

Salud:
- CI de la rama: los 4 runs terminaron en `success` (CI 44592355761 y 44592044259; Lockfile 44592356134 y 44591978816).
- Tiempos base (run 44592355761) para vigilar:
  - build (lint, unit, build): 11 s.
  - e2e (Playwright, depende de build): 28 s.
  - db (pgTAP, Supabase local): 70 s. Es la ruta crítica.
  - Total: unos 72 s.
  - Si db pasa de 3 min o el total de 5 min, se propone un ítem.
- Lockfile: unos 10 a 16 s.
- `main` todavía no tiene runs. Tampoco hay workflows programados (`evaluacion-mensual`, `ritmo-diario`), así que `salud.yml` queda para cuando existan (C-xx/V-xx). No hay producción.
- El camino `gh workflow run` de `lockfile.yml` aún no se probó en la práctica:
  - En b86ee44 ese paso todavía no existía.
  - En 366553b el lockfile no cambió.
  - Hay que verificarlo la primera vez que cambie `package.json`: debe aparecer un run de CI con `event: workflow_dispatch` sobre el SHA del bot.

Hallazgos:
1. (ROJO, se corrige en el ítem) No existe `engine/` en la rama. El criterio de F-01 la pide como carpeta de la lógica pura compartida.
   - Corrección: crear `engine/.gitkeep`. Que sea solo `.gitkeep` evita conflictos con M-01, que añade los módulos.
   - Comprobar que el glob de `test:unit` y la cobertura la incluyan cuando M-01 integre. Ahora mismo cubre `tests/**/*.test.js` y excluye `tests/**` de la cobertura, lo cual es correcto.
2. Correcto: Vite con `base: '/practica_agente/'` y `outDir: dist` para Pages. El e2e sirve `vite preview` bajo la misma base, así que valida las rutas reales de Pages.
3. Correcto: existen `supabase/` (config, migrations, seed, tests pgTAP), `scripts/`, `tests/` y `e2e/`. CI cubre lint, unitarias, build, Supabase local con pgTAP y e2e, y falla si falla cualquier paso. No se desactiva nada.
4. Decisión del desarrollador, mantener: CI en `push` a `item/**` y `fix/**`. El orquestador lee los runs por rama antes de abrir el PR. El doble run con PR abierto cuesta minutos, pero el run de `pull_request` prueba la fusión con `main`. Queda documentado en ADR 0004.
5. Decisión del desarrollador, mantener: `lockfile.yml` con `workflow_dispatch` y `actions: write` acotado a ese workflow, sin PAT. Es la forma mínima de que el commit del bot quede validado.
6. (Recomendación, no bloquea) `supabase/setup-cli@v1` usa `version: latest`, que no es determinista y puede romper CI sin cambios en el repo. Conviene fijar una versión (por ejemplo `2.x` concreta) y subirla a mano.
7. (Vigilar) Playwright usa `retries: 1` en CI. Si un test pasa solo en el reintento ("flaky" en el reporte), es señal de intermitencia y se propone como ítem; no se sube el número de reintentos.

## Corrección del orquestador (intento 2)
Se añadió `engine/.gitkeep` para que la carpeta exista en la rama, como exige F-01. Único hallazgo bloqueante resuelto. **Veredicto final: VERDE.**
