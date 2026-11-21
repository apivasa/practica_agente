# S-05b — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. S-05b no toca código de la app, ni `engine/`, ni el modelo de datos, ni los workflows. Solo cambia `docs/seguridad/*` y `docs/reportes/S-05*-seguridad.md`, y esos cambios son coherentes con `docs/diseno.md`, ADR 0014, ADR 0015 y `docs/operacion.md`.
Requiere decisión del usuario: no
ADR creados o actualizados:
- `docs/adr/0015-despliegue-manual-primero.md`: se añade una enmienda S-05b (Aceptado, decisión técnica). Precisa la compuerta del punto 4 en dos escalones:
  - fase B `anonimo` en VERDE para P-05;
  - fase B `roles` + H-S05-01 completo + sin copias de la clave secreta en el repositorio para dar de alta usuarios reales y anunciar la URL.

  El texto original pedía "usuarios de prueba ficticios" antes de P-05; el plan (S-05b) y el criterio de cierre de `pentest-preproduccion.md` ya lo habían reducido a `anonimo`. La enmienda deja esa diferencia escrita y justificada.

Salud:
- **Run de referencia** [44839422473](https://github.com/apivasa/practica_agente/actions/runs/44839422473): `workflow_dispatch` en `main` (`7610aba`). 10 jobs en `success`, y `s05-fase-a` en `skipped` como corresponde. Verificado por `gh api`.
- **`main`**: CI y Seguridad en verde en el último push (23:51 UTC). Los `cancelled` son por concurrencia entre pushes seguidos, no por fallos. Despliegue 44838844787 en `success`. El primer intento de despliegue falló y el arreglo es #43.
- **`salud.yml`**: estado `active`, un solo run (15:44 UTC, `success`) y ningún issue `salud`.
- **`ritmo-diario`**: estado `active`. Su último run (19:10 UTC) terminó en `success`, con "Evaluar" en `skipped` porque falta `EVALUATION_ENABLED`. Es lo esperado.
- **`evaluacion-mensual`**: estado `active` y sin runs, lo cual es correcto: su primer cron cae el 2026-12-01.
- **Monitoreo de producción**: hoy no existe. Pages y Supabase están publicados, pero `salud.yml` omite `pages` y `supabase` mientras no haya `EVALUATION_ENABLED=true` (ADR 0014 punto 4).

Hallazgos:
1. **Criterio de cierre de S-05 cumplido.**
   - La fase A estaba en VERDE (#26).
   - La fase B `anonimo` está en VERDE, sin altos ni críticos, y el run está enlazado en `pentest-preproduccion.md` y en `S-05-seguridad.md`.
   - La parte del criterio "H-C03-02 y H-S05-01 aplicados antes de dar de alta usuarios reales" queda como condición de la alta de usuarios, no de S-05b. Así está ahora en la enmienda de ADR 0015.
   - La suite `roles` se salta por configuración (`S05_MODE=anonimo`). No es una prueba desactivada.
2. **Coherencia de los cambios de seguridad** con ADR 0015 (environment `produccion` sin revisor, registro cerrado verificado en `/auth/v1/settings`, sin `config push`) y con ADR 0011 (origen único de producción en el bundle). T-PROD-08, H-S05-07 y H-S05-08 reflejan límites reales de GitHub Pages. No piden cambiar el stack ni hay que hacer nada.
3. **(Menor, no bloquea) H-C03-02 marcado "Corregido" con un residual abierto.** ADR 0015 (Consecuencias) dice que, mientras haya copias de `SUPABASE_SECRET_KEY` a nivel de repositorio, el environment "no protege nada". La celda ya menciona el residual, pero el estado debería decir "Corregido en workflows; residual abierto hasta borrar las copias de repositorio", o "Mitigado". Se puede ajustar en el próximo toque de `hallazgos.md`. El orquestador ya registró el pedido de borrado en `docs/estado.md`.
4. **P-05 puede pedirse ya a la usuaria.** Desde arquitectura no hay bloqueo, y conviene pedirlo pronto: mientras no se active, nadie vigila la producción publicada y nadie sondea Supabase, así que el plan gratuito puede pausar el proyecto unos 7 días después del despliegue (hacia el 2026-11-27). Los prerrequisitos operativos están en la nueva sección `docs/operacion.md` › «Activación de producción (P-05): lista de comprobación». Los que el mensaje a la usuaria debe dejar explícitos son:
   - `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en el environment `produccion`, sin revisor.
   - **`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` se quedan también a nivel de repositorio.** `salud.yml` no declara environment (ADR 0014 punto 5) y no tiene valor por defecto para `SUPABASE_URL`. Si se borran, el check `supabase` falla en cuanto se active P-05. La lista de borrado de `docs/estado.md` (`SECRET_KEY`, `ACCESS_TOKEN`, `DB_PASSWORD`, `PROJECT_REF`) es correcta, y el borrado se hace después de la primera corrida manual.
   - Crear `EVALUATION_ENABLED=true`. Después, una corrida manual de `ritmo-diario` ("Evaluar" ejecutado, `errors: 0`) y otra de `salud.yml` (`pages`, `supabase` y `ritmo-diario` en ok). Las dos las lanza el orquestador o la usuaria; desde esta revisión no se lanzaron workflows.
   - Avisar a la usuaria de que el primer cierre automático es el 2026-12-01 (noviembre) y sale con la configuración y las mediciones que haya cargado la gestora.
5. **`salud.yml` contra producción: no hace falta ningún cambio de código antes de P-05.** El workflow ya usa la URL de Pages por defecto, `secrets.SUPABASE_URL` y la clave publicable (secreto o variable). Lo que no se puede probar contra producción hasta P-05 son los checks `pages` y `supabase`, que hoy salen como "omitido". En CI se sigue probando contra Supabase local (`scripts/ci/health.sh`).
6. **Cron de GitHub poco fiable (observación).** Desde que se creó `salud.yml` (02:55 UTC) corrió 1 de 3 slots: GitHub descartó los de 06:41 y 18:41, y el de 12:41 salió unas 3 h tarde. No afecta a S-05b. Tras P-05 puede dar falsas alarmas `último run hace N h` en `ritmo-diario`, que tiene un umbral de 30 h. Quedó anotado en `docs/operacion.md` › «Pendiente de completar»: medir una semana antes de proponer un ítem para ajustar umbrales.
7. **Runbook actualizado.** La cabecera de `docs/operacion.md` todavía decía "Producción aún no existe"; ahora refleja el despliegue del 2026-11-20 y S-05b.
8. **Seguimiento de la usuaria, sin bloquear S-05b ni P-05** (está en el informe de seguridad):
   - fase B `roles` (cuentas de prueba y `S05_TEST_USERS`);
   - en el panel: Site URL, redirecciones, contraseña mínima de 12 caracteres y desactivar `pg_graphql`;
   - P-04 (H-007).

   Todo esto se exige antes de dar de alta usuarios reales.
