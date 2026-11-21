#!/usr/bin/env bash
# F-11 (H-V05c-01): en el despliegue continuo (evento push a main), el job
# `verify` de deploy.yml comprueba que el commit desplegado (github.sha) sigue
# siendo la punta de main. Así, relanzar (Re-run) un run viejo no republica el
# dist/ ni aplica migraciones de un commit anterior.
#
# Excepción: si los commits posteriores solo cambian documentación (docs/** o
# *.md, los mismos paths-ignore de deploy.yml), no disparan su propio
# despliegue y lo desplegable de la punta es idéntico a este commit: se sigue.
# Sin esa excepción, cada latido de docs/estado.md subido justo después de un
# merge haría fallar el despliegue del merge.
#
# Solo el disparo manual (workflow_dispatch) se exime: usa la punta de la rama
# en el momento de lanzarlo y lo decide quien confirma. Cualquier otro evento
# falla.
#
# Entrada (env):
#   GITHUB_EVENT_NAME, GITHUB_REPOSITORY (los pone el runner)
#   HEAD_SHA   SHA de 40 hex del commit desplegado (github.sha)
#   GH_TOKEN   token del job con permiso contents: read (lo usa gh)
#   TIP_RETRIES               intentos ante error de la API (por defecto 3)
#   TIP_RETRY_INTERVAL_SECONDS pausa entre intentos (por defecto 10)
#
# Salida: 0 si HEAD_SHA es la punta de main (o solo la siguen commits de
# documentación) o con disparo manual. 1 en cualquier otro caso, incluida una
# API que no responde (falla cerrado). Nunca imprime el token.
set -euo pipefail

event="${GITHUB_EVENT_NAME:-}"
case "$event" in
  push) ;;
  workflow_dispatch)
    echo "Disparo manual (workflow_dispatch): se despliega la punta de la rama al lanzar."
    exit 0
    ;;
  *)
    echo "::error::Evento no admitido: solo push a main o workflow_dispatch."
    exit 1
    ;;
esac

repo="${GITHUB_REPOSITORY:-}"
sha="${HEAD_SHA:-}"
retries="${TIP_RETRIES:-3}"
interval_s="${TIP_RETRY_INTERVAL_SECONDS:-10}"

if ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "::error::GITHUB_REPOSITORY no tiene la forma dueño/repositorio."
  exit 1
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::HEAD_SHA no es un SHA de commit de 40 caracteres hexadecimales."
  exit 1
fi
if ! [[ "$retries" =~ ^[1-9][0-9]*$ ]] || ! [[ "$interval_s" =~ ^[0-9]+$ ]]; then
  echo "::error::TIP_RETRIES debe ser un entero positivo y TIP_RETRY_INTERVAL_SECONDS un entero no negativo."
  exit 1
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::Falta GH_TOKEN (token del job con permiso contents: read)."
  exit 1
fi

# Primera línea del error de gh, sin \r, sin el token, sin comandos de
# workflow (::) y recortada: se puede mostrar en el log.
clean_error() {
  local e="${1%%$'\n'*}"
  e="${e//$'\r'/}"
  e="${e//"$GH_TOKEN"/***}"
  e="${e//::/: :}"
  printf '%s' "${e:0:200}"
}

errfile="$(mktemp)"
trap 'rm -f "$errfile"' EXIT

# gh_json <ruta> <filtro jq>: imprime el resultado del filtro o termina con 1
# tras `retries` intentos fallidos (error de gh o respuesta inesperada).
gh_json() {
  local path="$1" filter="$2" body out last="" i
  for ((i = 1; i <= retries; i++)); do
    if body="$(gh api "$path" 2>"$errfile")"; then
      if out="$(printf '%s' "$body" | jq -er "$filter" 2>/dev/null)" && [ -n "$out" ]; then
        printf '%s' "$out"
        return 0
      fi
      last="respuesta no JSON o inesperada"
    else
      last="$(clean_error "$(cat "$errfile")")"
      [ -n "$last" ] || last="gh api terminó con error sin mensaje"
    fi
    echo "::warning::Intento ${i}/${retries}: no se pudo leer ${path%%\?*} (${last})." >&2
    [ "$i" -lt "$retries" ] && sleep "$interval_s"
  done
  echo "::error::No se pudo comprobar la punta de main (${last}). No se despliega: relanza este workflow cuando la API de GitHub responda." >&2
  return 1
}

tip="$(gh_json "repos/${repo}/commits/main" '.sha | select(type == "string" and test("^[0-9a-f]{40}$"))')" || exit 1

if [ "$tip" = "$sha" ]; then
  echo "El commit ${sha} es la punta de main. Se puede desplegar."
  exit 0
fi

# Commits posteriores: ¿solo documentación? (mismos paths-ignore que deploy.yml).
# La API de compare lista hasta 300 archivos: con 300 o más no se puede afirmar.
cmp_filter='if .status == "ahead" and ((.files // []) | length) < 300
    and ((.files // []) | all(.filename | type == "string" and (startswith("docs/") or endswith(".md"))))
  then "docs" else "code \(.status // "desconocido")" end'
verdict="$(gh_json "repos/${repo}/compare/${sha}...${tip}" "$cmp_filter")" || exit 1

if [ "$verdict" = "docs" ]; then
  echo "main avanzó a ${tip}, pero solo con cambios de documentación (no redespliegan): se despliega ${sha}."
  exit 0
fi

echo "::error::Hay un commit más nuevo en main (${tip}) con cambios desplegables (${verdict#code }); su despliegue lo cubre. No se despliega ${sha}: no relances despliegues de commits viejos (republicaría un front anterior)."
exit 1
