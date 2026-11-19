# S-01 — Informe QA
Veredicto: VERDE

Revisado sobre `item/S-01` en el commit `f19f87f`. Constructor: seguridad. Revisor QA: tester.

## Criterio de aceptación
| Punto | Estado | Evidencia |
|---|---|---|
| Un secreto de prueba sembrado en una rama de ensayo hace fallar el pipeline | Cumplido | Run [44595353195](https://github.com/apivasa/practica_agente/actions/runs/44595353195), rama `ensayo/s01-secreto`, commit `9ffa8b4`: el job `gitleaks (historial completo)` falla con `RuleID: github-pat`, `File: ensayo-secreto.env.txt`, `leaks found: 1`, exit 1. Los otros 5 jobs pasan, así que el fallo se debe solo al secreto. Ese run usaba el workflow anterior (`git log --all`). Lo **revalidé** con el workflow corregido (`--log-opts="--full-history HEAD"`) en el run 44596748478 de la misma rama: gitleaks también falla con el mismo hallazgo. |
| Un PR limpio pasa | Cumplido | En `item/S-01` y el commit `f19f87f`, Seguridad (44597649643) y CI (44597648985) están en `success`, con los 6 jobs en verde (gitleaks, semgrep, npm audit, CodeQL ×2, pruebas de seguridad). |
| Alcance de la fila: corre en cada PR y cada semana | Cumplido | Disparadores: `pull_request`, `push` a `main`/`item/**`/`fix/**`/`ensayo/**`, `schedule` (`17 6 * * 1`) y `workflow_dispatch`. |

## Jobs: existen y fallan si encuentran algo
| Job | Cómo bloquea |
|---|---|
| gitleaks | `--exit-code 1` sobre todo el historial de HEAD. El binario se verifica con sha256. |
| semgrep | `--error` con `p/javascript`, `p/secrets`, `p/github-actions` |
| npm audit | `npm audit --omit=dev --audit-level=high` y `npm audit signatures` |
| CodeQL | Matriz `javascript-typescript` y `actions` con `security-extended` |
| pruebas de seguridad | `node --test 'tests/security/*.test.js'` con `SECURITY_REQUIRE_DIST=1` después del build |

`grep -nE "continue-on-error|\|\| *true" .github/workflows/*.yml` no devuelve nada. Ningún paso falla en abierto.

## Pruebas añadidas
QA no añadió pruebas. Este ítem es de pipeline y la evidencia viene de los runs de CI. Las pruebas de seguridad existentes corren en local con `node --test 'tests/security/*.test.js'`: **57/57 pasan, 0 fallan**. Son `static-secrets` (8), `workflows` (18) y `engine-m01` (25), más subtests.

## Resultado CI
- `item/S-01` @ `f19f87f`: Seguridad 44597649643 en success, CI 44597648985 en success.
- `ensayo/s01-secreto`: 44595353195 y 44596748478 en failure, ambos en gitleaks (es lo esperado).
- Histórico: Seguridad 44595333304 sobre `d1a64f6` falló porque gitleaks usaba `--all` y detectaba el secreto de la rama de ensayo. Se corrigió en `442bfe8`.

## Cobertura engine/
No aplica: S-01 no toca `engine/`.

## Hallazgos
1. **Baja.** La fila del plan pide semgrep para "JS, SQL, Actions", pero no hay un ruleset de SQL configurado. El repo ya tiene `supabase/seed.sql` y `supabase/tests/000_smoke.test.sql`. Para reproducir, mirar el paso `Escanear` del job semgrep en `.github/workflows/seguridad.yml`. Recomendación: añadir reglas para SQL/PLpgSQL (o reglas propias) antes de que aparezcan migraciones con RLS, o registrar en el ADR o el informe de seguridad por qué no se incluyen. No bloquea el criterio de aceptación.
2. **Informativa.** La fila dice "gitleaks (diff + historial)". Solo hay escaneo de historial completo de HEAD, que ya incluye el diff del PR. Funcionalmente es equivalente.
3. **Informativa.** La rama `ensayo/s01-secreto` contiene un token de prueba. Conviene borrarla después del merge para que no quede un secreto (aunque sea ficticio) en una rama remota.
