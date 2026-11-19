# ADR 0004 — Disparadores de CI y regeneración del lockfile

Estado: Aceptado (decisión técnica, 2026-11-19; no contradice el diseño)

## Contexto
El orquestador valida cada rama `item/<ID>` o `fix/<fecha>` consultando `actions/runs?branch=<rama>` antes de abrir el PR. Las sesiones de Claude no pueden instalar paquetes, así que `lockfile.yml` genera `package-lock.json` en Actions y lo sube con `GITHUB_TOKEN`; los commits hechos con ese token no disparan `push` ni `pull_request` en otros workflows.

## Decisión
1. `ci.yml` corre en `push` a `main`, `item/**` y `fix/**`, en `pull_request` y por `workflow_dispatch`.
   - Con un PR abierto cada push produce dos runs: el de `push` (código de la rama) y el de `pull_request` (merge con `main`). Se aceptan ambos: el primero es la señal que lee el orquestador; el segundo detecta conflictos semánticos con `main`. El grupo de concurrencia `ci-${{ github.ref }}` cancela runs viejos de la misma ref, pero no une los dos (refs distintas).
2. `lockfile.yml` tiene `permissions: contents: write, actions: write` y, solo si subió un lockfile nuevo, ejecuta `gh workflow run ci.yml --ref <rama>` para que el commit del bot quede validado.
   - `actions: write` se limita a este workflow; no se usa un PAT.

## Consecuencias
- Coste: aproximadamente el doble de minutos de CI mientras el PR está abierto (repo de práctica, aceptable). Si el tiempo de cola se vuelve un problema, se puede quitar `item/**` y `fix/**` del `push` y validar solo por `pull_request`, ajustando la sección 5 de CLAUDE.md.
- Un run lanzado por `workflow_dispatch` queda asociado al SHA del lockfile, por lo que el PR ve el estado de su commit de cabeza.
- Si `lockfile.yml` empuja a una rama cuyo `ci.yml` está en curso, el run viejo se cancela por concurrencia y queda el del nuevo SHA.
