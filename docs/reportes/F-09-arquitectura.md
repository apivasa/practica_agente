# F-09 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. El cambio solo toca el arnés de pruebas de seguridad (`tests/security/api/`) y el job `pentest-api` de `seguridad.yml`. No cambia `src/`, `engine/`, `supabase/`, el modelo de datos ni las reglas de escalada. Sigue ADR 0007 (pipeline de seguridad): el pentest corre contra Supabase local efímero, con `PENTEST_REQUIRE=1` y `skipped 0`.
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. Es un detalle interno del arnés de pruebas, no una decisión de arquitectura.
Salud: CI y Seguridad en verde para los dos commits de la rama (runs 44739380024/44739380017 en a582efa y 44740730944/44740730995 en 4a4272f). El job `pentest-api` tardó 85 s y 96 s, dentro de la base de 74–93 s y lejos del umbral de alerta de 5 min. El paso «Pentest de la API» tardó entre 8 y 11 s, y `login-all.mjs` va incluido en ese tiempo. Resultado en el run 44740730995: 559 tests, 559 pass, 0 fail, 0 skipped. No se detectaron pasos intermitentes. Los workflows programados no cambian.

Hallazgos:

1. **Paso de tokens por entorno: seguro.**
   - `PENTEST_TOKENS` es una variable de shell que solo existe en el proceso del paso «Pentest de la API». No pasa por `GITHUB_ENV` ni `GITHUB_OUTPUT` y no queda en ningún archivo. Por eso no aparece en la cabecera de env de otros pasos ni llega a otros jobs.
   - La sustitución `$(...)` no imprime el JSON. Con `set -euo pipefail`, si `login-all.mjs` falla, el paso falla: su error va a stderr y no lleva tokens.
   - En el log del run 44740730995 hay 0 cadenas `eyJ`.
   - `::add-mask::` no hace falta. Son JWT de un GoTrue local del runner efímero, que vencen en 1 h y no valen fuera del runner. Además, enmascararlos obligaría a emitir cada token como comando de workflow, lo que no aporta nada.
   - El tamaño (unos 7 JWT, menos de 10 KB) queda muy por debajo de `ARG_MAX`.
2. **Fase B (`fase_b=anonimo|roles`, producción): sin efecto ni exposición.** El job `s05-fase-b` ejecuta solo `tests/security/prod/fase-b.test.js`, que no importa `_lib.js` ni usa `login-all.mjs` o `PENTEST_TOKENS`, y sus credenciales salen de `secrets.S05_TEST_USERS`. `login-all.mjs` lee `PENTEST_API_URL`, que únicamente define el paso local de `pentest-api`, así que no puede apuntar a producción. La fase A (`s05-fase-a`) tampoco usa el arnés.
3. **Reintento ante 429: acotado y sin riesgo para el timeout.**
   - Son 6 intentos, con espera de 2, 4, 8, 16 y 32 s, o lo que indique `Retry-After`, con tope de 60 s. En el peor caso suma unos 62 s por usuario.
   - Como `login-all` inicia sesión una sola vez por rol, en el peor caso teórico son unos 7 min, muy por debajo de `timeout-minutes: 30`.
   - En los runs observados no hubo 429: el paso duró 8–11 s.
   - Sugerencia de salud, no bloqueante: si `pentest-api` pasa de 3 min sin que «Levantar Supabase» explique la diferencia, hay que sospechar de un 429 sostenido. Para diagnosticarlo convendría que `login()` dejara en stderr una línea por cada reintento («login: 429, reintento N en X s»). Hoy reintenta en silencio. Puede ir en un ítem futuro del arnés.
4. **Sesiones compartidas entre archivos: correcto.** El único `logout` (`auth-jwt.test.js`) usa una sesión nueva de `lider3` con `scope=local`, así que no revoca el token compartido. El TTL mínimo de 5 min que exige `validTokens()` es holgado frente a un paso de unos 10 s. Si `PENTEST_TOKENS` falta o es inválido, el arnés vuelve a iniciar sesión, que es el comportamiento seguro.
5. **CodeQL #14–#16 (`js/file-access-to-http`):** ya no existe la fuente que disparaba la regla (`readFileSync` del archivo de caché en tmp), porque `_lib.js` ya no importa `node:fs`. No pude consultar el estado de las alertas: la API `code-scanning` responde 403 a la integración. El cierre se confirma cuando CodeQL analice `main` después del merge. El orquestador debe verificarlo en la pestaña Security o con un token que tenga permiso `security_events`.
6. **`docs/operacion.md`: no menciona la caché en tmp, así que no hay nada incorrecto.**
   - Para el documentador (no bloqueante): en la sección 6 (pentest-api) del runbook conviene añadir lo siguiente:
     - El paso hace una sola ronda de login con `login-all.mjs` y pasa los tokens por `PENTEST_TOKENS`.
     - Ante el error «login-all: …» o «login <rol>: 429» persistente, revisar el rate limit de GoTrue antes de relanzar. Hoy `supabase/config.toml` no tiene la sección `[auth.rate_limit]`, así que rigen los valores por defecto de la CLI.
     - Para ejecutar el pentest en local hay que exportar las variables `PENTEST_*`. `PENTEST_TOKENS` es opcional.
