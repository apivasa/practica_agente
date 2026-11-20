#!/usr/bin/env bash
# C-03/C-04: prueba de integración en CI contra Supabase local con la semilla.
# Ejecuta la evaluación mensual y la diaria dos veces cada una y verifica con psql las
# filas esperadas y la idempotencia (correr dos veces no duplica).
# Solo para Supabase local: nunca apuntar a producción.
set -euo pipefail

status="$(supabase status -o env)"
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | head -n 1; }

SUPABASE_URL="$(get API_URL)"
SUPABASE_SECRET_KEY="$(get SECRET_KEY)"
DB_URL="$(get DB_URL)"
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SECRET_KEY" ] || [ -z "$DB_URL" ]; then
  echo "supabase status no entregó API_URL, SECRET_KEY y DB_URL. Variables disponibles:"
  printf '%s\n' "$status" | cut -d= -f1
  exit 1
fi
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "La integración solo corre contra Supabase local"; exit 1 ;;
esac
echo "::add-mask::${SUPABASE_SECRET_KEY}"
export SUPABASE_URL SUPABASE_SECRET_KEY
# Las fechas de la semilla (2027) son futuras: solo aquí, contra Supabase local, se permiten.
export EVALUATE_ALLOW_FUTURE=1

counts() {
  psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select
    (select count(*) from public.evaluations) || ',' ||
    (select count(*) from public.alerts) || ',' ||
    (select count(*) from public.audit_log where actor = 'system:evaluate' and action <> 'evaluation_reprocess')"
}

reprocess_count() {
  psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.audit_log where actor = 'system:evaluate' and action = 'evaluation_reprocess'"
}

# Mensual: primer cierre; re-cierre sin --reprocess se rechaza (sale 3, sin cambios); con
# --reprocess no duplica nada y queda auditado como evaluation_reprocess.
monthly_close() {
  local as_of="$1"
  node scripts/evaluate.js --mode=monthly --as-of="$as_of"
  local first; first="$(counts)"
  local before; before="$(reprocess_count)"
  set +e
  node scripts/evaluate.js --mode=monthly --as-of="$as_of"
  local code=$?
  set -e
  if [ "$code" -ne 3 ]; then
    echo "::error::El re-cierre de $as_of sin --reprocess debía salir con 3 y salió con $code"
    exit 1
  fi
  local second; second="$(counts)"
  node scripts/evaluate.js --mode=monthly --as-of="$as_of" --reprocess
  local third; third="$(counts)"
  local after; after="$(reprocess_count)"
  echo "evaluaciones,alertas,auditoría tras cierre de $as_of: $first -> $second -> $third (reprocesos $before -> $after)"
  if [ "$first" != "$second" ] || [ "$first" != "$third" ]; then
    echo "::error::El re-cierre de $as_of duplicó filas ($first -> $second -> $third)"
    exit 1
  fi
  if [ "$after" -ne $((before + 1)) ]; then
    echo "::error::El reproceso de $as_of no quedó auditado como evaluation_reprocess"
    exit 1
  fi
}

twice() {
  node scripts/evaluate.js "$@"
  local first; first="$(counts)"
  node scripts/evaluate.js "$@"
  local second; second="$(counts)"
  echo "evaluaciones,alertas,auditoría tras $*: $first -> $second"
  if [ "$first" != "$second" ]; then
    echo "::error::La segunda ejecución de $* duplicó filas ($first -> $second)"
    exit 1
  fi
}

# M-06: VULN se evalúa por criticidad con el paquete del compromiso, sin targets. Se borran
# sus metas mensuales de la BD local para demostrarlo (solo Supabase local, ver arriba).
psql "$DB_URL" -v ON_ERROR_STOP=1 -c \
  "delete from public.targets where indicator_id = '33333333-3333-4333-8333-000000000001'"

monthly_close 2027-02-01
twice --mode=daily --as-of=2027-02-10
monthly_close 2027-03-01

psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/verify-evaluate.sql
echo "Integración C-03/C-04 en verde"
