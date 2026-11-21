#!/usr/bin/env bash
# F-11 (H-V05c-01): en el despliegue continuo (evento push a main), deploy.yml
# comprueba que el commit desplegado (github.sha) sigue siendo la punta de
# main. Así, relanzar (Re-run) un run viejo no republica el dist/ ni aplica
# migraciones de un commit anterior.
#
# Excepción: si los commits posteriores solo cambian documentación (los mismos
# paths-ignore de deploy.yml, ver DOC_PATHS_IGNORE), no disparan su propio
# despliegue y lo desplegable de la punta es idéntico a este commit: se sigue.
# Sin esa excepción, cada latido de docs/estado.md subido justo después de un
# merge haría fallar el despliegue del merge. En un renombrado, tanto la ruta
# nueva como la anterior (previous_filename) deben ser documentación.
#
# Modos:
#   (sin argumentos) en `verify`: si un commit más nuevo con código superó a
#     este en el primer intento del run (GITHUB_RUN_ATTEMPT = 1), es la carrera
#     prevista de dos merges seguidos (H-ARQ-F11-01): ::warning::, deploy=false
#     en $GITHUB_OUTPUT y 0; los jobs siguientes se saltan y el run termina en
#     success sin publicar. En un relanzamiento (intento > 1 o desconocido),
#     ::error:: y 1. Si todo está bien escribe deploy=true.
#   --strict  en `migrate` y `deploy-pages` (H-ARQ-F11-02): superado = ::error::
#     y 1 siempre. Nunca escribe en $GITHUB_OUTPUT.
#
# Solo el disparo manual (workflow_dispatch) se exime: usa la punta de la rama
# en el momento de lanzarlo y lo decide quien confirma. Cualquier otro evento
# falla.
#
# Entrada (env):
#   GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT
#     (los pone el runner)
#   HEAD_SHA   SHA de 40 hex del commit desplegado (github.sha)
#   GH_TOKEN   token del job con permiso contents: read (lo usa gh)
#   TIP_RETRIES               intentos ante error de la API (por defecto 3)
#   TIP_RETRY_INTERVAL_SECONDS pausa entre intentos (por defecto 10)
#
# Salida: 0 si se puede desplegar (o, sin --strict, si el run quedó superado
# en su primer intento, con deploy=false). 1 en cualquier otro caso, incluida
# una API que no responde (falla cerrado). Nunca imprime el token.
set -euo pipefail

# H-ARQ-F11-04: mismos patrones que on.push.paths-ignore de deploy.yml (una
# prueba los ata). Cada uno se traduce en un predicado del filtro jq `doc`:
#   'docs/**' → startswith("docs/")      '**/*.md' → endswith(".md")
# Si cambias esta lista, cambia también el filtro y deploy.yml.
DOC_PATHS_IGNORE=('docs/**' '**/*.md')
readonly DOC_PATHS_IGNORE

strict=0
case "${1:-}" in
  '') ;;
  --strict) strict=1 ;;
  *)
    echo "::error::Argumento no admitido (solo --strict)."
    exit 1
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "::error::Argumento no admitido (solo --strict)."
  exit 1
fi

# deploy=<valor> en $GITHUB_OUTPUT (solo sin --strict y si el runner lo da).
set_deploy() {
  [ "$strict" -eq 0 ] || return 0
  [ -n "${GITHUB_OUTPUT:-}" ] || return 0
  printf 'deploy=%s\n' "$1" >>"$GITHUB_OUTPUT"
}

event="${GITHUB_EVENT_NAME:-}"
case "$event" in
  push) ;;
  workflow_dispatch)
    echo "Disparo manual (workflow_dispatch): se despliega la punta de la rama al lanzar."
    set_deploy true
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
  set_deploy true
  exit 0
fi

# Commits posteriores: ¿solo documentación? (DOC_PATHS_IGNORE). `files` debe ser
# un arreglo (si falta, no se puede afirmar nada) y con menos de 300 entradas
# (la API de compare trunca en 300). En un renombrado cuenta también la ruta
# anterior: src/x.js → docs/x.md cambia lo desplegable.
# Veredictos: "docs" (se despliega), "code ahead" (superado por código),
# "unknown <motivo>" (no se puede afirmar nada: siempre falla) o
# "code <status>" (behind/diverged: siempre falla).
cmp_filter='def doc: type == "string" and (startswith("docs/") or endswith(".md"));
  if .status != "ahead" then "code \(.status // "desconocido")"
  elif (.files | type) != "array" then "unknown sin lista de archivos"
  elif (.files | length) >= 300 then "unknown lista de archivos truncada"
  elif (.files | all(type == "object" and (.filename | type) == "string")) | not then "unknown archivo sin nombre"
  elif (.files | all((.filename | doc) and ((.previous_filename // "docs/") | doc))) then "docs"
  else "code ahead" end'
verdict="$(gh_json "repos/${repo}/compare/${sha}...${tip}" "$cmp_filter")" || exit 1

if [ "$verdict" = "docs" ]; then
  echo "main avanzó a ${tip}, pero solo con cambios de documentación (${DOC_PATHS_IGNORE[*]}, no redespliegan): se despliega ${sha}."
  set_deploy true
  exit 0
fi

if [[ "$verdict" == unknown* ]]; then
  echo "::error::main avanzó a ${tip} y no se pudo saber qué cambió (${verdict#unknown }). No se despliega ${sha} (falla cerrado)."
  exit 1
fi

status="${verdict#code }"
attempt="${GITHUB_RUN_ATTEMPT:-}"
if [ "$strict" -eq 0 ] && [ "$status" = "ahead" ] && [ "$attempt" = "1" ]; then
  if [ -z "${GITHUB_OUTPUT:-}" ]; then
    echo "::error::Falta GITHUB_OUTPUT: no se puede marcar deploy=false. No se despliega ${sha}."
    exit 1
  fi
  echo "::warning::Hay un commit más nuevo en main (${tip}) con cambios desplegables; su despliegue lo cubre. Este run no publica ${sha} (se saltan build, migraciones y Pages) y termina en verde."
  set_deploy false
  exit 0
fi

echo "::error::Hay un commit más nuevo en main (${tip}) con cambios desplegables (${status}); su despliegue lo cubre. No se despliega ${sha}: no relances despliegues de commits viejos (republicaría un front anterior)."
exit 1
