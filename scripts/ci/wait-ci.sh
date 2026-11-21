#!/usr/bin/env bash
# V-05c (H-ARQ-V05b-01, H-V05b-01, H-V05b-02): en el despliegue continuo
# (evento push a main), el job `verify` de deploy.yml espera a que el workflow
# CI (.github/workflows/ci.yml) del mismo commit termine y exige conclusion
# success. Así nunca se migra ni se publica un commit cuyo CI en main falló:
# el CI del PR no probó la combinación con lo que entró antes a main.
#
# Con disparo manual (workflow_dispatch + confirm=desplegar) no espera: la
# persona que despliega decide, y suele ser para relanzar tras un arreglo.
#
# Entrada (env):
#   GITHUB_EVENT_NAME, GITHUB_REPOSITORY (los pone el runner)
#   HEAD_SHA   SHA de 40 hex del commit desplegado (github.sha)
#   GH_TOKEN   token del job con permiso actions: read (lo usa gh)
#   CI_WAIT_TIMEOUT_SECONDS   tope de espera (por defecto 1200 = 20 min)
#   CI_WAIT_INTERVAL_SECONDS  pausa entre consultas (por defecto 30)
#
# Salida: 0 si el run de CI del commit terminó en success (o si el evento no
# es push). 1 si terminó con otra conclusión, si no apareció o no terminó antes
# del tope, o si la entrada no es válida. Nunca imprime el token.
set -euo pipefail

CI_PATH='.github/workflows/ci.yml'

event="${GITHUB_EVENT_NAME:-}"
if [ "$event" != "push" ]; then
  echo "Disparo '${event}': no se espera al CI del commit (solo en push a main)."
  exit 0
fi

repo="${GITHUB_REPOSITORY:-}"
sha="${HEAD_SHA:-}"
timeout_s="${CI_WAIT_TIMEOUT_SECONDS:-1200}"
interval_s="${CI_WAIT_INTERVAL_SECONDS:-30}"

if ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "::error::GITHUB_REPOSITORY no tiene la forma dueño/repositorio."
  exit 1
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::HEAD_SHA no es un SHA de commit de 40 caracteres hexadecimales."
  exit 1
fi
if ! [[ "$timeout_s" =~ ^[0-9]+$ ]] || ! [[ "$interval_s" =~ ^[0-9]+$ ]]; then
  echo "::error::CI_WAIT_TIMEOUT_SECONDS y CI_WAIT_INTERVAL_SECONDS deben ser enteros no negativos."
  exit 1
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::Falta GH_TOKEN (token del job con permiso actions: read)."
  exit 1
fi

url="repos/${repo}/actions/runs?head_sha=${sha}&event=push&branch=main&per_page=100"
# Último run (id mayor) de ci.yml para ese commit: "id status conclusion".
# La ruta puede venir como ".github/workflows/ci.yml" o con sufijo "@ref".
filter='[.workflow_runs[]? | select(.path == $p or (.path | startswith($p + "@")))]
  | sort_by(.id) | last
  | if . == null then "" else "\(.id) \(.status) \(.conclusion // "none")" end'

deadline=$(( $(date +%s) + timeout_s ))
seen=""
echo "Esperando el CI (${CI_PATH}) del commit ${sha} en main (tope ${timeout_s} s)."
while :; do
  line=""
  if body="$(gh api "$url" 2>/dev/null)"; then
    if ! line="$(printf '%s' "$body" | jq -r --arg p "$CI_PATH" "$filter" 2>/dev/null)"; then
      echo "::warning::Respuesta inesperada de la API de Actions; se reintenta."
      line=""
    fi
  else
    echo "::warning::No se pudo consultar la API de Actions; se reintenta."
  fi

  if [ -n "$line" ]; then
    read -r run_id status conclusion <<<"$line"
    seen="$run_id"
    if [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        echo "CI del commit en verde (run ${run_id}). Se puede desplegar."
        exit 0
      fi
      echo "::error::El CI del commit ${sha} terminó con conclusion '${conclusion}' (run ${run_id}: https://github.com/${repo}/actions/runs/${run_id}). No se despliega. Si se canceló porque entró otro commit a main, el despliegue de ese commit lo reemplaza; si falló, corrige main y el siguiente merge vuelve a desplegar."
      exit 1
    fi
    echo "CI run ${run_id}: ${status}."
  else
    echo "Todavía no aparece el run de CI del commit."
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    if [ -z "$seen" ]; then
      echo "::error::No apareció ningún run de CI (${CI_PATH}) para el commit ${sha} en ${timeout_s} s. No se despliega. Revisa que ci.yml se disparó en main y relanza este workflow."
    else
      echo "::error::El CI del commit ${sha} (run ${seen}) no terminó en ${timeout_s} s. No se despliega. Cuando termine en verde, relanza este workflow (rerun-failed-jobs)."
    fi
    exit 1
  fi
  sleep "$interval_s"
done
