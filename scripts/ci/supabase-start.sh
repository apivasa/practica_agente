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
# F-10: el fallo persistía con los puertos libres (sin LISTEN ni contenedores).
# 54320-54329 cae dentro del rango de puertos efímeros de Linux
# (net.ipv4.ip_local_port_range 32768-60999): una conexión saliente puede tomar
# 54322 como puerto de origen y Docker no puede publicarlo. Antes del primer intento
# se reservan esos puertos (net.ipv4.ip_local_reserved_ports) conservando las
# reservas existentes; si no hay sudo no interactivo, se avisa y se sigue. El
# diagnóstico incluye `ss -tanp` en cualquier estado (no solo LISTEN).
#
# Variables opcionales:
#   SUPABASE_START_ATTEMPTS  intentos totales (por defecto 3 = 1 + 2 reintentos; 1..5)
#   SUPABASE_START_WAIT      segundos de espera entre intentos (por defecto 10; 0..60)
set -uo pipefail

# Puertos de Supabase local (API 54321, DB 54322, Studio 54323, Mailpit 54324...).
PORTS_RE=':5432[0-9]([^0-9]|$)'
RESERVED_RANGE='54320-54329'
# Solo las pruebas cambian la ruta de lectura; la escritura siempre es vía sysctl.
RESERVED_FILE="${SUPABASE_RESERVED_PORTS_FILE:-/proc/sys/net/ipv4/ip_local_reserved_ports}"

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

# Reserva 54320-54329 para que el kernel no los use como puertos efímeros de origen.
# Nunca hace fallar el script: sin sudo o sin /proc, avisa y sigue.
reserve_ports() {
  local current new
  if [ ! -r "$RESERVED_FILE" ]; then
    echo "::warning::No se pudo leer $RESERVED_FILE; no se reservan los puertos $RESERVED_RANGE (F-10)"
    return 0
  fi
  current="$(tr -d ' \t\n' < "$RESERVED_FILE")"
  case "$current" in
    *[!0-9,-]*)
      echo "::warning::Contenido inesperado en $RESERVED_FILE; no se modifican las reservas (F-10)"
      return 0 ;;
  esac
  case ",$current," in
    *",$RESERVED_RANGE,"*)
      echo "Puertos $RESERVED_RANGE ya reservados (ip_local_reserved_ports=$current)"
      return 0 ;;
  esac
  if [ -n "$current" ]; then new="$current,$RESERVED_RANGE"; else new="$RESERVED_RANGE"; fi
  if sudo -n sysctl -w "net.ipv4.ip_local_reserved_ports=$new" >/dev/null 2>&1; then
    echo "Puertos reservados: ip_local_reserved_ports=$(tr -d '\n' < "$RESERVED_FILE")"
  else
    echo "::warning::No se pudieron reservar los puertos $RESERVED_RANGE (sudo -n sysctl no disponible); se sigue sin reserva (F-10)"
  fi
  return 0
}

diagnose() {
  echo "::group::Diagnóstico de puertos de Supabase local (54320-54329)"
  if [ -r "$RESERVED_FILE" ]; then
    echo "ip_local_reserved_ports=$(tr -d '\n' < "$RESERVED_FILE")"
  fi
  if command -v ss >/dev/null 2>&1; then
    # Con sudo se ven los procesos de otros usuarios (el runner lo permite sin clave).
    out="$( (sudo -n ss -ltnp 2>/dev/null || ss -ltnp 2>/dev/null) | grep -E "$PORTS_RE" || true)"
    if [ -n "$out" ]; then
      echo "Puertos ocupados:"
      printf '%s\n' "$out"
    else
      echo "ss: ningún proceso escucha en 54320-54329"
    fi
    # F-10: cualquier estado (ESTAB, TIME-WAIT...): una conexión saliente con
    # 54322 como puerto de origen también impide publicarlo.
    out="$( (sudo -n ss -tanp 2>/dev/null || ss -tanp 2>/dev/null) | grep -E "$PORTS_RE" || true)"
    if [ -n "$out" ]; then
      echo "Sockets TCP en 54320-54329 (cualquier estado):"
      printf '%s\n' "$out"
    else
      echo "ss: ningún socket TCP usa 54320-54329"
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

reserve_ports

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
