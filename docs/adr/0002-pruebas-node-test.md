# ADR 0002 — Pruebas unitarias con el runner nativo `node:test`

Estado: Aceptado (decisión del orquestador, 2026-11-19, ítem M-01)

## Contexto
El ADR 0001 preveía Vitest para las pruebas unitarias. Las sesiones de Claude que construyen y revisan los ítems no pueden instalar paquetes (`npm install` bloqueado), de modo que una suite que dependa de Vitest no se puede ejecutar localmente antes del push. El motor (`engine/`) es JavaScript ESM puro sin dependencias, y Node trae un runner de pruebas y cobertura integrados.

## Decisión
- Pruebas unitarias (motor `engine/` y cualquier lógica pura) con el runner nativo `node:test` y `node:assert`, sin dependencias externas.
- Comando canónico, igual en local y en CI:
  ```sh
  node --test --experimental-test-coverage --test-coverage-exclude='tests/**' 'tests/**/*.test.js'
  ```
- Versión mínima de Node para ejecutar las pruebas: **22 LTS** (`--test-coverage-exclude` y los patrones glob en `node --test` no existen en Node 20). CI fija `node-version: 22` en `actions/setup-node`. El código de `engine/` sigue siendo compatible con Node 20+ y con el bundle de Vite.
- Umbral de cobertura de `engine/` (≥ 95 % de líneas) se verifica sobre la salida de cobertura de este comando.
- Playwright queda solo para e2e y se instala y ejecuta en CI, no en las sesiones.
- pgTAP vía `supabase test db` no cambia (ver ADR 0001).

## Consecuencias
- Cero dependencias para las pruebas unitarias: se ejecutan en la sesión y en CI con el mismo comando.
- La cobertura de `node:test` es experimental; si cambia su interfaz, se ajusta el comando aquí con un ADR que reemplace a este.
- No se mezclan Vitest y `node:test`; cualquier prueba unitaria nueva usa `node:test`.
- No cambia ninguna decisión confirmada del diseño (stack, datos, roles, escalada).
