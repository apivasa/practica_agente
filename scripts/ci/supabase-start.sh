#!/usr/bin/env bash
# F-07: arranque de Supabase local en CI con reintento acotado.
#
# Uso (desde un workflow):
#   bash scripts/ci/supabase-start.sh supabase start -x studio,imgproxy
#   bash scripts/ci/supabase-start.sh supabase db start
#
# Motivo: en los runners de GitHub, `supabase start` falla a veces con
# `failed to bind host port 0.0.0.0:54322/tcp: address already in use` y pasa al
# relanzarlo sin cambios (docs/operacion.md, V-04). Este script:
#   1) ejecuta el comando dado;
#   2) si falla, imprime quién ocupa los puertos de Supabase local (ss / docker ps),
#      corre `supabase stop --no-backup`, espera y reintenta;
#   3) tras agotar los intentos sale con el código de error del último intento
#      (nunca 0): el reintento no oculta un fallo real.
#
# Variables opcionales:
#   SUPABASE_START_ATTEMPTS  intentos totales (por defecto 3 = 1 + 2 reintentos; 1..5)
#   SUPABASE_START_WAIT      segundos de espera entre intentos (por defecto 10; 0..60)
set -uo pipefail

PORTS_RE=':(54321|54322|54323|54324)([^0-9]|$)'

usage() {
  echo "::error::uso: $0 supabase start [opciones] | $0 supabase db start [opciones]" >&2
  exit 2
}

# Solo se admite arrancar Supabase: el script no es un ejecutor genérico.
[ "${1:-}" = "supabase" ] || usage
if [ "${2:-}" = "start" ]; then
  :
elif [ "${2:-}" = "db" ] && [ "${3:-}" = "start" ]; then
  :
else
  usage
fi

attempts="${SUPABASE_START_ATTEMPTS:-3}"
wait_s="${SUPABASE_START_WAIT:-10}"
case "$attempts" in [1-5]) ;; *) echo "::error::SUPABASE_START_ATTEMPTS debe estar entre 1 y 5" >&2; exit 2 ;; esac
case "$wait_s" in ''|*[!0-9]*) echo "::error::SUPABASE_START_WAIT debe ser un entero" >&2; exit 2 ;; esac
[ "$wait_s" -le 60 ] || { echo "::error::SUPABASE_START_WAIT debe ser <= 60" >&2; exit 2; }

diagnose() {
  echo "::group::Diagnóstico de puertos de Supabase local (54321-54324)"
  if command -v ss >/dev/null 2>&1; then
    # Con sudo se ven los procesos de otros usuarios (el runner lo permite sin clave).
    out="$( (sudo -n ss -ltnp 2>/dev/null || ss -ltnp 2>/dev/null) | grep -E "$PORTS_RE" || true)"
    if [ -n "$out" ]; then
      echo "Puertos ocupados:"
      printf '%s\n' "$out"
    else
      echo "ss: ningún proceso escucha en 54321-54324"
    fi
  else
    echo "ss no está disponible"
  fi
  if command -v docker >/dev/null 2>&1; then
    echo "Contenedores (docker ps -a):"
    docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || true
  else
    echo "docker no está disponible"
  fi
  echo "::endgroup::"
}

code=1
for ((i = 1; i <= attempts; i++)); do
  echo "Intento $i de $attempts: $*"
  "$@"
  code=$?
  if [ "$code" -eq 0 ]; then
    [ "$i" -gt 1 ] && echo "::notice::Supabase local arrancó en el intento $i de $attempts (F-07)"
    exit 0
  fi
  echo "::warning::'$*' falló con código $code (intento $i de $attempts)"
  diagnose
  if [ "$i" -lt "$attempts" ]; then
    supabase stop --no-backup || true
    sleep "$wait_s"
  fi
done

[ "$code" -ne 0 ] || code=1
echo "::error::Supabase local no arrancó tras $attempts intentos (último código $code)"
exit "$code"
