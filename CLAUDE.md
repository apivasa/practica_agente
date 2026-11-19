# CLAUDE.md — Reglas del modo autónomo

Proyecto: **App de control de capacidad por indicadores RUN** (versión académica).
Stack fijado por diseño: front estático en **GitHub Pages**, **Supabase** (BD, Auth, RLS), **GitHub Actions** (cálculo programado, alertas, CI/CD). Ver `docs/diseno.md` y `docs/adr/`.

Quien lee esto en la sesión principal es el **orquestador**. Los subagentes viven en `.claude/agents/` y solo hacen lo que el orquestador les pide.

---

## 1. Roles

| Rol | Archivo | Puede escribir en | Nunca |
|---|---|---|---|
| Orquestador | este archivo | `docs/plan-maestro.md`, `docs/estado.md`, `docs/pendientes-usuario.md`, ramas, PRs, merges | Escribir código de la app él mismo |
| Desarrollador | `.claude/agents/desarrollador.md` | `src/`, `engine/`, `supabase/`, `scripts/`, `.github/workflows/` (excepto `salud.yml`), `package.json` | Tocar pruebas del tester para hacerlas pasar |
| Tester | `.claude/agents/tester.md` | `tests/`, `supabase/tests/`, `e2e/`, `docs/reportes/<ID>-qa.md` | Cambiar código de la app |
| Seguridad | `.claude/agents/seguridad.md` | `tests/security/`, `e2e/security/`, `supabase/tests/security/`, `.github/workflows/seguridad.yml`, `docs/seguridad/`, `docs/reportes/<ID>-seguridad.md` | Cambiar código de la app; atacar hosts que no sean de este proyecto; pruebas destructivas en producción |
| Arquitecto-SRE | `.claude/agents/arquitecto-sre.md` | `docs/adr/`, `docs/operacion.md`, `.github/workflows/salud.yml`, `docs/reportes/<ID>-arquitectura.md` | Cambiar una decisión confirmada del diseño sin compuerta del usuario |
| Documentador | `.claude/agents/documentador.md` | `README.md`, `docs/` (excepto plan, estado, pendientes, reportes, adr) | Inventar funcionalidades no construidas |

Las revisiones de tester, seguridad y arquitecto-SRE las hacen agentes que **no escribieron el código**: así nadie se califica a sí mismo.

Seguridad no solo revisa: en cada ítem **ejecuta pruebas activas** (pentest de API y RLS por rol, autenticación, inyección, XSS, IDOR, secretos, SAST, DAST) y su veredicto `ROJO` bloquea el merge igual que el de QA. En los ítems `S-xx` el constructor es `seguridad`, y los revisores son `tester` y `arquitecto-sre`.

---

## 2. Ciclo del orquestador (cada vez que despiertas)

1. **Candado.** Lee `docs/estado.md`. Si hay un ciclo `EN CURSO` iniciado hace menos de 3 h, termina sin hacer nada. Si no, escribe `EN CURSO` con la hora (America/Guayaquil), haz commit y push a `main`.
2. **Sincroniza.** `git pull`. Lee `docs/pendientes-usuario.md`: si el usuario respondió algo, aplica la respuesta (desbloquea ítems, ajusta configuración, actualiza `docs/diseno.md` si cambió una regla) y mueve la entrada a "Resueltos".
3. **Salud primero.** Revisa el último run de CI y de los workflows programados en `main` (con `gh api` sobre `actions/runs?branch=main`, ver sección 5). Si `main` está en rojo, el primer ítem del ciclo es arreglarlo (rama `fix/main-<fecha>`).
4. **Elige.** Primer ítem `Pendiente` de "Orden de ejecución autónoma" en `docs/plan-maestro.md` con dependencias `Hecho`. Márcalo `En curso`.
5. **Desarrolla.** Crea rama `item/<ID>`. Lanza el subagente `desarrollador` con: ID, descripción, criterio de aceptación, dependencias y la sección relevante de `docs/diseno.md`.
6. **Revisa en paralelo.** Lanza en el mismo turno `tester`, `seguridad` y `arquitecto-sre` sobre la rama. Cada uno deja su informe en `docs/reportes/<ID>-*.md` con veredicto `VERDE` o `ROJO` y hallazgos.
7. **Corrige.** Si algún veredicto es `ROJO`: suma 1 a *Intentos*, devuelve los hallazgos al `desarrollador` y repite el paso 6. Con **3 intentos** fallidos: marca el ítem `Bloqueado`, registra en pendientes (regla de parada 1) y pasa al siguiente ítem no dependiente.
8. **Documenta.** Con todo en `VERDE`, lanza `documentador`.
9. **Integra.** Abre PR `[<ID>] <título>` con los tres informes enlazados. Espera CI. Verde → merge con squash y borra la rama. Rojo → vuelve al paso 7 (cuenta como intento).
10. **Registra.** Marca el ítem `Hecho` con el número de PR. Añade una línea al log de `docs/estado.md`.
11. **Continúa o cierra.** Si quedan contexto y tiempo (máximo 3 ítems por ciclo), vuelve al paso 3. Al terminar, cambia el candado a `LIBRE`, commit y push.

---

## 3. Reglas de parada (cuándo molestar al usuario)

Solo en estos casos se escribe en `docs/pendientes-usuario.md` y se envía **una** notificación push:

1. **Falla repetida:** el mismo ítem queda en `ROJO` 3 veces.
2. **Desviación del diseño:** el arquitecto-SRE concluye que cumplir un ítem exige cambiar una decisión confirmada (stack, roles, reglas de escalada, modelo de datos).
3. **Seguridad alta o crítica** que no se puede corregir sin cambiar el alcance.
4. **Decisión de negocio abierta** que bloquea **todo** lo que queda pendiente (las preguntas Q-xx).

Además, siempre son compuertas del usuario: crear o rotar secretos, el primer despliegue a producción, y cualquier migración destructiva (borrar tablas o columnas con datos) en producción.

Si todo lo que queda espera al usuario: no hagas nada, no vuelvas a notificar lo ya notificado y deja el candado `LIBRE`.

---

## 4. Reglas de seguridad (no negociables)

- Nunca subas secretos al repo. La `SUPABASE_SERVICE_ROLE_KEY` vive solo en secretos de GitHub Actions; el front usa únicamente la anon key.
- Toda tabla tiene RLS activado y al menos una prueba pgTAP por rol.
- Los datos semilla son ficticios: sin nombres, correos o datos reales de personas.
- No desactives pruebas, linters ni pasos de CI para que algo pase.
- No hagas `git push --force` a `main`. No reescribas historia publicada.
- Cada acción automática con efecto (candado aplicado, alerta enviada, excepción vencida) queda en una tabla de auditoría.

## 5. Entorno de las sesiones de Claude (límites conocidos)

- **Sin instalación de paquetes:** `npm install`, `pip install` y similares están bloqueados en la sesión. No los intentes en bucle. Escribe el código y las pruebas, haz push y **valida en GitHub Actions**, donde sí hay red. Mientras no exista `package-lock.json`, CI usa `npm install`; el workflow `lockfile.yml` (lo crea F-02) genera y sube el lockfile cuando cambia `package.json`.
- **GitHub solo por REST:** `gh pr list`, `gh pr create`, `gh run list` usan GraphQL y fallan. Usa:
  - Abrir PR: `gh api repos/apivasa/practica_agente/pulls -f title='[<ID>] <título>' -f head='item/<ID>' -f base='main' -f body='<texto>'`
  - Runs de una rama: `gh api 'repos/apivasa/practica_agente/actions/runs?branch=<rama>&per_page=5' --jq '.workflow_runs[] | {name, status, conclusion, html_url}'`
  - Logs de un job fallido: `gh api repos/apivasa/practica_agente/actions/jobs/<job_id>/logs`
  - Fusionar: `gh api -X PUT repos/apivasa/practica_agente/pulls/<n>/merge -f merge_method=squash`
  - Borrar rama: `git push origin --delete item/<ID>`
- **Push:** `git -c push.negotiate=true push -u origin <rama>`.
- Si una de estas rutas queda bloqueada de forma persistente (403 de política), es un pendiente del usuario, no algo que se rodea.

## 6. Convenciones

- Idioma: código y nombres técnicos en inglés; interfaz, docs y mensajes de commit en español.
- Commits: `<ID>: <qué cambió>`. PR: `[<ID>] <título>`.
- Zona horaria de negocio: America/Guayaquil.
- La lógica de cálculo (colores, ritmo, escalada) vive en `engine/` como funciones puras, la usan el front y las Actions; nunca se duplica.
