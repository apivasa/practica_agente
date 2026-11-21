# Plan maestro — App de control de capacidad por indicadores RUN

Fuente de verdad del diseño: `docs/diseno.md` (copia del doc https://claude.ai/artifact/R48Rkcxs52r6BpeY4m8XjU).
Este archivo lo lee y actualiza el **orquestador** en cada ciclo. Solo él cambia la columna *Estado*.

**Objetivo del producto:** que el comité de delivery vea cada mes el color de cada unidad por indicador RUN, que las restricciones (candados) se apliquen y comuniquen solas, y que el control sea por resultados (avance real vs. esperado).

**Modo de trabajo:** autónomo, ciclos cada 3 horas. Cada ciclo cierra entre 1 y 3 ítems. Se construye y prueba con Supabase local dentro de GitHub Actions (sin credenciales reales). El despliegue a producción (Supabase real + GitHub Pages) queda detrás de la compuerta P-02/P-03 del usuario (ambas resueltas el 2026-11-19) y del pentest S-05.

---

## Capacidad

No hay velocidad histórica. Unidad de estimación: **ciclos** (1 ciclo ≈ una ejecución de 3 h del orquestador). Se planea al 75 % para absorber reintentos.

| Recurso | Disponibilidad | Capacidad efectiva | Notas |
|---|---|---|---|
| Orquestador + 5 subagentes | 8 ciclos/día | 6 ciclos/día | 25 % de colchón para reintentos y correcciones de CI |
| Usuario (dueño) | Solo compuertas | — | Responde `docs/pendientes-usuario.md` |

Tallas: **S** = 1 ciclo · **M** = 2 ciclos · **L** = 3 ciclos.

---

## Sprint 1 — Fundaciones
**Objetivo:** un repositorio con CI verde que levanta Supabase local, crea el esquema completo con seguridad por filas probada y una web que inicia sesión y enruta por rol.
**Carga:** 11 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| F-01 | P0 | Estructura del repo: front Vite + JavaScript (ES modules), carpeta `supabase/`, `engine/` (lógica pura compartida), `scripts/` para Actions | S | — | `npm ci && npm run build` genera `dist/` estático; README con comandos |
| F-02 | P0 | CI: lint, pruebas unitarias (node:test, ADR 0002), `supabase start` local, pruebas de BD (pgTAP) y de RLS, build | M | F-01 | Workflow `ci.yml` verde en PR y en `main`; falla si cualquier paso falla. Workflow `lockfile.yml` genera y sube `package-lock.json` cuando cambia `package.json` (las sesiones de Claude no pueden instalar paquetes) |
| F-03 | P0 | Migraciones del modelo de datos: Unidades, Usuarios y roles, Indicadores, Compromisos, Mediciones, Metas, Evaluaciones, Excepciones, Alertas | M | F-02 | `supabase db reset` aplica sin errores; pgTAP valida tablas, FKs y enums |
| F-04 | P0 | RLS por rol: gestora (todo config), custodio (sus KPIs), comité (lectura total + excepciones), líder (solo su unidad) | L | F-03 | Pruebas pgTAP con un usuario por rol: cada rol ve y escribe solo lo permitido; ninguna tabla sin RLS |
| F-05 | P0 | Login (Supabase Auth, correo + contraseña) y enrutamiento por rol en el front | M | F-04 | Prueba e2e (Playwright) entra con cada rol de seed y llega a su vista |
| F-06 | P1 | Datos semilla ficticios: 3 unidades, 4 roles, indicadores de ejemplo (vulnerabilidades, disponibilidad, MTTR, cobertura) | S | F-03 | `seed.sql` sin datos personales reales; usado por pruebas |

## Seguridad transversal (constructor: agente `seguridad`)
**Objetivo:** que cada PR pase por pruebas de seguridad automáticas y que nada llegue a producción sin un pentest completo en verde.
**Carga:** 11 ciclos repartidos entre sprints.

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| S-01 | P0 | Pipeline `seguridad.yml`: gitleaks (diff + historial), semgrep (JS, SQL, Actions), `npm audit`, en cada PR y semanal | M | F-02 | Un secreto de prueba sembrado en una rama de ensayo hace fallar el pipeline; un PR limpio pasa |
| S-02 | P0 | Modelo de amenazas STRIDE en `docs/seguridad/modelo-amenazas.md`: activos, roles, superficie, amenazas con control y prueba | S | F-03 | Cada amenaza alta tiene una prueba automática asignada |
| S-03 | P0 | Pentest de RLS y API: por rol y anónimo, CRUD directo a PostgREST y RPC en cada tabla, IDOR entre unidades y KPIs, escalada de rol, JWT manipulado | L | F-04, F-06 | Matriz rol × tabla × operación completa en pruebas; cualquier tabla sin RLS hace fallar CI |
| S-04 | P0 | DAST: OWASP ZAP baseline contra el front local + Supabase local; CSP por meta, SRI, sin secretos en `dist/`; pruebas XSS e inyección CSV | M | F-05, M-04 | ZAP sin alertas altas; payloads XSS y de fórmula escapados en e2e |
| S-05 | P0 | **Pentest previo a producción** (compuerta de V-05): ZAP full scan no destructivo contra Pages, pentest asistido de la API real con usuarios de prueba de los 4 roles, revisión de configuración de Auth y secretos de Actions | M | V-01, V-02, C-04, P-02, P-03 | Informe `docs/seguridad/pentest-preproduccion.md` sin hallazgos altos ni críticos abiertos |

## Sprint 2 — Motor de indicadores
**Objetivo:** cualquier indicador configurado de forma genérica produce un color correcto por unidad y mes, y el caso de vulnerabilidades calcula su ritmo y meta parcial.
**Carga:** 12 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| M-01 | P0 | Motor de color (`engine/`, función pura): tipos meta acumulada, promedio en ventana y cobertura; sentido; ventana; umbrales verde/amarillo/rojo (opcional por categoría); mínimo de muestra | L | F-01 | ≥ 95 % de cobertura de líneas en `engine/`; casos borde: sin muestra suficiente → "sin evaluar", empates en umbral, ventana vacía |
| M-02 | P0 | Pantalla de alta y edición de indicadores (gestora) con los 7 atributos del modelo genérico y asignación de custodio | M | F-05, M-01 | e2e: la gestora crea un indicador nuevo no previsto y queda evaluable |
| M-03 | P0 | Compromisos por unidad, indicador y periodo (custodio) | S | M-02 | e2e: el custodio registra un umbral negociado que sobrescribe el general |
| M-04 | P0 | Captura manual de mediciones (custodio) + importación CSV validada | M | M-03 | CSV con errores se rechaza fila a fila con mensaje; e2e de carga |
| M-05 | P0 | Caso vulnerabilidades: paquete trimestral; P0/P1 nuevas entran en meses 1–2 y en mes 3 pasan al siguiente; cumplimiento 96 % P0/P1 y 85 % P2/P3; ritmo = pendiente / semanas restantes; meta parcial mensual ≈ 1/3; arrastre al cierre | L | M-01, M-04 | Pruebas con el ejemplo del diseño (2.000 → 2.200) reproducen ritmo, meta y arrastre |

## Sprint 3 — Candados, excepciones y alertas
**Objetivo:** el sistema aplica las reglas de escalada mes a mes, respeta excepciones vigentes y avisa a líder y comité sin intervención manual.
**Carga:** 11 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| C-01 | P0 | Motor de escalada: verde normal; mes 1 amarillo/rojo → no change nuevo; mes 2 rojo → se frena todo el change; cierre de trimestre → arrastre. Regla "amarillo en mes 2" **configurable** (por defecto = mes 1) hasta que se decida (Q-03) | M | M-01 | Tabla de verdad completa en pruebas; historial guardado en Evaluaciones |
| C-02 | P0 | Excepciones del comité: motivo, vencimiento, visibles para todo el comité; suspenden el candado mientras estén vigentes | M | C-01, F-04 | e2e: el comité aprueba; vencida → el candado vuelve; RLS: el líder no puede crear excepciones |
| C-03 | P0 | GitHub Action `evaluacion-mensual.yml` (día 1, 06:00 America/Guayaquil) y `ritmo-diario.yml` que evalúan colores, escaladas y atrasos con la clave secreta (`SUPABASE_SECRET_KEY`) desde secretos | M | C-01, M-05 | Se ejecuta contra Supabase local en CI con datos semilla; idempotente (correr dos veces no duplica) |
| C-04 | P0 | Alertas: cambio de color, atraso frente al ritmo, ingreso de P0/P1 que recalcula la meta, vencimiento de excepciones. Registro en tabla Alertas + bandeja en la app. Canal externo según Q-04 | M | C-03 | Cada disparador genera exactamente una alerta por destinatario; agrupación sin duplicados |
| C-05 | P1 | Envío por correo (Resend) de las alertas de la tabla `alerts` a cada destinatario, desde Actions con `RESEND_API_KEY`; apagado de forma segura si falta el secreto; cada correo enviado queda registrado (sin duplicar reenvíos) y en auditoría | S | C-04 | Prueba con Resend simulado: una alerta → un correo por destinatario; correr dos veces no reenvía; sin secreto el workflow no falla y lo anota; el correo no expone datos de otras unidades |

## Sprint 4 — Vistas, salud y salida a producción
**Objetivo:** cada rol tiene su vista, el sistema se vigila solo y queda publicado en GitHub Pages con Supabase real.
**Carga:** 12 ciclos (≈ 2 días) + compuertas del usuario.

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| V-01 | P0 | Vista líder: sus indicadores, color, meta mensual, avance vs. ritmo y restricciones activas | M | C-02 | e2e con rol líder; no ve otras unidades |
| V-02 | P0 | Vista comité: todas las unidades (matriz unidad × indicador), alertas, excepciones | M | C-02, C-04 | e2e con rol comité |
| V-03 | P0 | Tablero de completitud por custodio (gestora): qué datos faltan para el comité del mes | S | M-04 | Muestra % cargado por custodio y KPI |
| V-04 | P0 | Salud del sistema: workflow `salud.yml` (cada 6 h) que verifica la web y Supabase, falla visible si algo cae; alerta si un workflow programado no corrió o falló; registro de auditoría de acciones automáticas | M | C-03 | Simulación de caída en CI produce alerta; runbook en `docs/operacion.md` |
| V-05 | P0 | Despliegue: `deploy.yml` publica `dist/` en GitHub Pages y aplica migraciones a Supabase real en cada merge a `main` | M | V-01, V-02, S-05, **P-02, P-03** | Primera publicación accesible en la URL de Pages; migraciones aplicadas |
| V-06 | P1 | Manual por rol (gestora, custodio, comité, líder) y guía de configuración de indicadores | S | V-01..V-03 | Revisado por el documentador y el arquitecto |
| V-07 | P1 | Importación de mediciones desde Excel (.xlsx) en la pantalla del custodio, con las mismas columnas, límites y validaciones que el CSV (`engine/measurements-input.js`); primera hoja; fórmulas rechazadas | M | M-04 | Unitarias y e2e: un .xlsx de ejemplo importa igual que su CSV; archivo con fórmulas, demasiado grande o con columnas erróneas se rechaza con mensaje; revisión de seguridad de la dependencia o parser |
| S-05b | P0 | Pentest fase B contra producción: `seguridad.yml` dispatch `fase_b=anonimo` desde main tras el primer despliegue | S | V-05 (primer run) | Sin hallazgos altos ni críticos; solo entonces P-05 |
| M-06 | P0 | Color mensual de vulnerabilidades por criticidad: función pura en `engine/` (resuelto trimestral / meta acumulada del mes por categoría, peor color), usada por `scripts/lib/build.js` y `src/lib/dashboard.js` | M | M-05, C-03 | Tabla de verdad (96/85 verde; P0/P1 95 % no verde; meta 0; categoría sin paquete = sin evaluar); integración CI evalúa VULN sin `targets`; ADR nuevo |
| M-07 | P1 | Pantalla `#/gestora/metas`: alta y edición de `targets` para indicadores de meta acumulada, con "Proponer un tercio" | S | M-02, M-06 | e2e gestora; otros roles no escriben; un indicador pasa de "Sin evaluar" a color al cargar la meta |
| V-08 | P2 | Candado vigente hoy en el front (motor `evaluateEscalation` + excepciones vigentes) e "Inicio autorizado: REF" | S | V-01, V-02, C-02 | e2e: excepción "todo" se ve el mismo día; inicio puntual con unidad congelada |
| V-09 | P2 | Un solo mapa de etiquetas de alcance de excepciones | XS | V-08 | Prueba unitaria; manuales sin nota de equivalencia |
| V-05b | P1 | Despliegue continuo en push a main (ADR 0015 punto 5); `db push --db-url` sin token de cuenta (H-V05-01); contraseña mínima 12 en config.toml (H-S03-02) | S | V-05, S-05b | Merge a main despliega; pruebas de workflow actualizadas |
| F-07 | P2 | CI: reintento acotado de `supabase start` con diagnóstico `ss -ltnp` (puertos 54322/54324 ocupados, intermitente) | XS | F-02 | Paso intermitente registrado en operacion.md deja de requerir relanzar a mano |
| M-08 | P1 | Endurecimiento de mediciones VULN: trigger en `measurements` (categoría P0P1/P2P3 y entero ≥ 0 en indicadores con categorías), rechazo de `cumulative_target` + `lower_is_better` en `validateIndicator` y CHECK, descarte movido a `buildPackageInput` (H-M06-01, H-M06-QA-02, A4, A7) | S | M-06 | pgTAP y node:test; verificar antes de producción que no haya filas que violen la regla |
| M-12 | P3 | Forma y tope de `thresholds_by_category`, tope en `measurements.value`, enteros ≥ 0 en `package_by_category` (claves libres) (H-M11-01..03) | XS | M-11 | pgTAP por clave y por columna; verificación previa a producción |
| M-13 | P3 | Tope 2^53 validado en front/motor antes de guardar (H-QA-M12-01) | XS | M-12 | Unitarias: umbral 1e20 y medición 2^53 rechazados con mensaje |
| M-14 | P3 | Alinear el borde de los CHECK `_safe` con el redondeo de JS (H-ARQ-M13-01) | XS | M-13 | pgTAP: 9007199254740991.4 pasa, 9007199254740991.5 se rechaza, en cada columna y clave JSONB; verificación previa |
| F-09 | P3 | Cerrar alertas CodeQL de pruebas de API de seguridad (code-scanning #14–#16) | XS | — | 0 alertas abiertas de CodeQL en main sin debilitar las pruebas |
| M-11 | P3 | Tope de entero seguro en columnas numéricas configurables y en `package_by_category` (H-M10-01) | XS | M-10 | pgTAP con '1e400' por columna y por clave JSONB |
| M-10 | P2 | Valores finitos en todas las columnas numéricas configurables (H-M09-01): CHECK o dominio `finite_numeric` en targets, commitments e indicators | XS | M-09 | pgTAP con 'NaN' e 'Infinity' por columna; verificación previa a producción |
| M-09 | P2 | Endurecimiento de hallazgos bajos de M-07/M-08: grant UPDATE por columna (`target_value`) en `targets`; `cumulativeThirds` nunca supera el total; mediciones rechazan NaN, Infinity y enteros no seguros | XS | M-07, M-08 | pgTAP `has_column_privilege` y de valores no finitos; prueba unitaria de `cumulativeThirds(0.5)` |

---

## Orden de ejecución autónoma

El orquestador toma el **primer ítem `Pendiente`** cuyas dependencias estén `Hecho` y que no esté `Bloqueado`.

| # | ID | Estado | Intentos | PR | Nota |
|---|---|---|---|---|---|
| 1 | F-01 | Hecho | 0 | #1 |  |
| 2 | F-02 | Hecho | 0 | #1 |  |
| 3 | S-01 | Hecho | 1 | #6 | Constructor: seguridad |
| 4 | F-03 | Hecho | 0 | #5 |  |
| 5 | S-02 | Hecho | 0 | #13 | Constructor: seguridad |
| 6 | M-01 | Hecho | 1 | #2 | Puede ir en paralelo a F-03 (solo depende de F-01) |
| 7 | F-04 | Hecho | 0 | #5 |  |
| 8 | F-06 | Hecho | 0 | #5 |  |
| 9 | S-03 | Hecho | 0 | #13 | Constructor: seguridad |
| 10 | F-05 | Hecho | 0 | #14 |  |
| 11 | M-02 | Hecho | 1 | #18 |  |
| 12 | M-03 | Hecho | 1 | #18 |  |
| 13 | M-04 | Hecho | 1 | #18 |  |
| 14 | S-04 | Hecho | 0 | #17 | Constructor: seguridad |
| 15 | M-05 | Hecho | 1 | #7 | Parte de motor adelantada; integración con BD tras F-03 y M-04  |
| 16 | C-01 | Hecho | 0 | #3 |  |
| 17 | C-02 | Hecho | 1 | #20 |  |
| 18 | C-03 | Hecho | 1 | #15 |  |
| 19 | C-04 | Hecho | 1 | #15 |  |
| 20 | V-03 | Hecho | 1 | #21 |  |
| 21 | V-01 | Hecho | 1 | #21 |  |
| 22 | V-02 | Hecho | 1 | #21 |  |
| 23 | V-04 | Hecho | 0 | #22 | Constructor: arquitecto-SRE |
| 24 | V-06 | Hecho | 0 | #23 | Constructor: documentador |
| 25 | S-05 | Hecho | 1 | #26 | Fase A (pre-despliegue). Constructor: seguridad |
| 26 | V-05 | Hecho | 3 | #27, #fix deploy | Primer despliegue OK (run 44838844787): migraciones aplicadas y Pages publicado. Siguiente: S-05b (pentest fase B contra producción), luego P-05 |
| 26b | S-05b | Hecho | 0 | #44 | Fase B del pentest contra Pages y Supabase real; depende del primer run de V-05; compuerta de P-05 |
| 26c | M-06 | Hecho | 1 | #28 | Color mensual de VULN por criticidad (96 % P0/P1, 85 % P2/P3); antes de P-05 |
| 26d | M-07 | Hecho | 0 | #31 | Pantalla de metas mensuales (`targets`) para la gestora |
| 26e | V-08 | Hecho | 0 | #33 | Candado vigente hoy e inicio autorizado; agrupar con V-09 |
| 26f | V-09 | Hecho | 0 | #33 | Un solo mapa de etiquetas de alcance de excepciones |
| 26g | V-05b | En revisión | 0 | #45 | Revisiones VERDE y CI pendiente; NO fusionar hasta P-07 (variable `SUPABASE_DB_POOLER_HOST`). Al retomarlo: integrar main (S-05c, V-04b) y aplicar H-ARQ-V04b-02 (quitar revisión manual del despliegue en operacion.md, despliegue.md y ADR 0015: lo vigila `deploy-main`).  Despliegue en push a main (ADR 0015 punto 5); incluye H-V05-01 (`db push --db-url` sin token de cuenta) y H-S03-02 (contraseña mínima 12 en config.toml) |
| 26i | M-08 | Hecho | 0 | #32 | Validación en BD de mediciones VULN (trigger), rechazo cumulative_target + lower_is_better, descarte compartido en buildPackageInput |
| 26j | F-08 | Hecho | 0 | #29 | Alertas CodeQL abiertas en main (4 altas, solo en pruebas: URL por subcadena en tests/scripts/health.test.js:150,256 y qa-v04.test.js:193,213) fusionadas con #22; constructor: tester. Regla nueva: no fusionar con el check CodeQL en rojo |
| 26h | F-07 | Hecho | 1 | #30 | CI: reintento acotado de `supabase start` por puertos 54322/54324 ocupados (intermitente) |
| 26k | M-09 | Hecho | 0 | #34 | Endurecimiento bajo: UPDATE de `targets` solo en `target_value` (H-M07-01); `cumulativeThirds` acotado al total o CHECK entero en `package_total` (H-M07-QA-01); rechazo de NaN/Infinity y enteros > 2^53 en mediciones (H-M08-01, obs. QA M-08); quitar en docs/operacion.md la instrucción de relanzar pentest-api a mano |
| 26l | M-10 | Hecho | 0 | #35 | H-M09-01: CHECK de valor finito (sin NaN/Infinity) en `targets.target_value`, `commitments.package_total`, `green_override`, `yellow_override` y umbrales de `indicators`; pgTAP |
| 26m | M-11 | Hecho | 0 | #36 | H-M10-01: tope < 2^53 en los CHECK numéricos de M-10 y CHECK de valores en `commitments.package_by_category` (JSON.parse vuelve Infinity valores como 1e400) |
| 26n | M-12 | Hecho | 0 | #37 | Residuales de M-11 (H-M11-01..03). Claves de `package_by_category` libres (categorías del indicador o `total`), no P0P1/P2P3 |
| 26o | M-13 | Hecho | 0 | #38 | H-QA-M12-01: tope 2^53 en `engine/numeric.js`, usado por indicador, compromiso y mediciones |
| 26p | M-14 | Hecho | 0 | #39 | H-ARQ-M13-01: CHECK `_safe` a abs(v) < 9007199254740991.5 para que BD y motor rechacen lo mismo (hoy [2^53 − 0,5, 2^53) pasa la BD y hace fallar la evaluación mensual) |
| 26q | F-09 | Hecho | 0 | #40 | Tokens del pentest en memoria + `PENTEST_TOKENS`; sin caché en disco. Confirmar en GitHub que las alertas #14–#16 pasan a *fixed* (la sesión recibe 403 en code-scanning) |
| 26r | F-10 | Hecho | 0 | #41 | `supabase start` sigue fallando por 54322 «address already in use» tras 3 intentos (PR #40) sin ningún proceso escuchando: el puerto cae en el rango efímero de Linux (32768–60999). Reservar 54320–54329 con `sysctl net.ipv4.ip_local_reserved_ports` antes de arrancar en `scripts/ci/supabase-start.sh`. Constructor: desarrollador. Vigilar 2 semanas `::notice::` de intento >1 en main (H-ARQ-F10-03) |
| 26s | S-05c | Hecho | 1 | #47 | Confirmado en producción: fase B anónima run 44845769345, 4 tablas → 42501.  H-QA-S05b-01/02: en `tests/security/prod/fase-b.test.js` las sondas de escritura anónima usan columna `name` (400 PGRST204 antes del chequeo de privilegio en exceptions, audit_log, user_roles): usar columnas reales y exigir 401/403/42501; login sin enumeración comparado con cuenta existente en modo roles. Constructor: seguridad |
| 26t | V-04b | Hecho | 2 | #46 | Reintentos por lint y gitleaks en prueba de seguridad (token ficticio; huellas en `.gitleaksignore`).  H-ARQ-V05b-02: `salud.yml` vigila el último run de `Despliegue` en main (check `deploy-main` en `scripts/health/`) |
| 26u | V-05c | Pendiente | 0 | | Espera V-05b (P-07).  H-ARQ-V05b-01 / H-V05b-01 / H-V05b-02: en push, `verify` espera a que CI del mismo SHA termine en success (`actions: read`); `{ set +x; }` dentro de `supabase_db_url`. Depende de V-05b |
| 27 | C-05 | En curso | 0 | | Q-04 resuelto: Resend, a cada destinatario. Envío real requiere P-09 (secreto), el código no |
| 28 | V-07 | En curso | 0 | | Q-02 resuelto: importación Excel (.xlsx). Paralelizable con C-05 |

Estados válidos: `Pendiente`, `En curso`, `En revisión`, `Hecho`, `Bloqueado`.

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Las reglas de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad no están definidas (Q-01) | Esos indicadores no se pueden evaluar con su lógica final | El motor es genérico: se configuran con los tres tipos de medición; la lógica específica se ajusta por configuración cuando se defina |
| Ambigüedad "amarillo en mes 2" (Q-03) | Escalada incorrecta | Regla configurable con valor por defecto documentado |
| Supabase local en CI tarda o falla | CI lento o intermitente | Caché de imágenes; reintento único; el arquitecto-SRE vigila la duración |
| Plan gratuito de Supabase pausa proyectos inactivos | Caída en producción | `salud.yml` hace una consulta liviana periódica y alerta |
| Ciclos que se solapan si uno dura más de 3 h | Conflictos en ramas | Candado de ciclo en `docs/estado.md` |
| Fuga de la clave secreta de Supabase | Acceso total a la BD | Solo en secretos de Actions; el revisor de seguridad lo verifica en cada PR |

## Definition of Done (cada ítem)

- [ ] Criterio de aceptación del ítem cumplido y demostrado por pruebas automáticas
- [ ] CI verde (lint, unitarias, BD/RLS, e2e cuando aplica, build)
- [ ] Informe del tester: verde
- [ ] Informe de seguridad: sin hallazgos altos ni críticos abiertos
- [ ] Informe del arquitecto-SRE: alineado al diseño y sin regresión de salud
- [ ] Documentación actualizada por el documentador
- [ ] PR fusionado a `main` con squash y referencia al ID del ítem

## Fechas clave (estimadas, se mueven con el inicio real)

| Hito | Ciclos acumulados | Fecha estimada |
|---|---|---|
| Inicio (acceso al repo concedido) | 0 | Día 0 |
| Fin Sprint 1: esquema + RLS + login | 11 | Día 2 |
| Fin Sprint 2: motor de indicadores | 23 | Día 4 |
| Fin Sprint 3: candados y alertas | 34 | Día 6 |
| Fin Sprint 4: vistas y salud (incluye seguridad S-01 a S-04) | 55 | Día 9–10 |
| Pentest previo a producción (S-05) y publicación en Pages | ≈ 59 | Día 10 |
