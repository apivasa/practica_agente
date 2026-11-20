# M-10 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. Seis CHECK aditivos de valor finito (`supabase/migrations/20261125120000_numeric_finite_m10.sql`) en `indicators.green_threshold`/`yellow_threshold`, `commitments.green_override`/`yellow_override`/`package_total` y `targets.target_value`. No cambia privilegios, RLS, funciones ni front. Cierra H-M09-01.

Pruebas de seguridad añadidas:
- `tests/security/api/numeric-finite-m10.test.js` (pentest-api, Supabase local): 8 casos.
  - Cat. 3: el ataque original reproducido por PATCH con el rol que escribe cada columna (gestora: umbrales y meta; custodio1: `package_total`; custodio2: overrides) y 12 variantes (`NaN`, `nan`, `"  nan "`, `NAN`, `Infinity`, `infinity`, `inf`, `+inf`, `" INF "`, `-Infinity`, `-inf`, `+Infinity`): 72 peticiones, todas con 400 y código 23514. También POST de meta y compromiso nuevos y upsert (`resolution=merge-duplicates`) de meta existente con NaN. Las filas conservan sus valores.
  - Cat. 1: control positivo (cada rol llega a su fila: así el rechazo viene del CHECK y no de RLS); líder, comité y anónimo no cambian nada (401/403 o 200 []); ningún rol escribe `evaluations.value`.
- `supabase/tests/security/048_security_numeric_finite_m10.test.sql` (pgTAP, `set role authenticated` con claims de gestora y custodio): 19 casos.
  - Cat. 1/3: barrido del catálogo. Ninguna columna `numeric`/`real`/`double` de `public` en la que `authenticated` o `anon` pueda hacer INSERT o UPDATE se queda sin un CHECK validado que excluya NaN e Infinity. Es la regresión para columnas nuevas.
  - Los 6 CHECK existen y están validados; `evaluations.value` no se puede escribir por la API.
  - 15 casos de variantes por UPDATE, INSERT y upsert con el nombre exacto de la restricción donde no es ambiguo; control positivo; los valores se conservan.
- `tests/security/engine-m10.test.js` (Cat. 3, residual H-M10-01): 3 casos. `1e400` llega como `Infinity` tras `JSON.parse`; `num()` lo anula y `buildPackageInput` rechaza el paquete.

Resultados del pipeline: gitleaks · semgrep · npm audit · ZAP · pentest RLS/API. Los enlaces de los runs de `item/M-10` están en la sección "CI" de abajo.

Hallazgos:
- H-M10-01 · Baja · 3 Entradas · `20261125120000_numeric_finite_m10.sql` (no hay tope superior) y el JSONB `package_by_category`/`thresholds_by_category`.
  - Reproducir: como gestora, `PATCH /rest/v1/targets?id=eq.<id>` con `{"target_value":"1e400"}`. Responde 200: es finito en PostgreSQL, pero PostgREST lo devuelve como literal y `JSON.parse` lo convierte en `Infinity`. El motor lo anula (`num` → null), así que no fuerza ningún color. La meta queda "sin valor", que es el mismo impacto residual que tenía H-M09-01. Solo pueden hacerlo roles que ya escriben la columna, y queda en auditoría.
  - Corrección sugerida: tope en los mismos CHECK (`< 9007199254740992`, como en `measurements`) y CHECK de valores en `package_by_category`.
  - Registrado en `docs/seguridad/hallazgos.md` y propuesto como ítem.

Corregido: H-M09-01, verificado por API y pgTAP. Marcado como corregido en `docs/seguridad/hallazgos.md`. T-M09-04 del modelo de amenazas apunta ahora a las pruebas.

Verificado sin hallazgos: 1 (RLS y privilegios sin cambios; solo los roles con escritura llegan al CHECK), 3 (NaN/±Infinity en todas sus grafías), 5 y 6 (sin cambios de workflows ni de dependencias), 8 (no hay datos personales en las fixtures; los rechazos no dejan filas).
No aplica: 2, 4 y 7 (no se tocan front, Auth ni la superficie HTTP).

## CI
- Run de bc63549 (Seguridad https://github.com/apivasa/practica_agente/actions/runs/44702045451): gitleaks, semgrep, CodeQL, npm audit, DAST/ZAP y pgTAP de seguridad (`048` ok) en verde. En pentest-api, 7 de los 8 casos de M-10 pasaron. El upsert de PostgREST (`merge-duplicates`) recibe 403/42501 y no 23514: PostgREST mete en el DO UPDATE SET todas las columnas del cuerpo, y el grant de columna de M-09 corta la petición antes de llegar al CHECK. Es un rechazo correcto, así que se ajustó la prueba para aceptar los dos rechazos y comprobar que la meta no cambia. No es un hallazgo.
- En el CI de bc63549 (https://github.com/apivasa/practica_agente/actions/runs/44702045351), `db (pgTAP)` falla solo en `supabase/tests/101_qa_m10.test.sql` (es del tester; `results_eq` da "could not determine which collation"). No es de seguridad: `100` y `048` pasan.
- El tester lo corrigió en b56f1f5. Run final sobre 34fc3f0 (incluye cf646a2), todo en verde: Seguridad https://github.com/apivasa/practica_agente/actions/runs/44703662522 (pentest-api con los 8 casos de M-10, pgTAP `048`, gitleaks, semgrep, CodeQL, npm audit, ZAP) y CI https://github.com/apivasa/practica_agente/actions/runs/44703662613.
