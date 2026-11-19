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

counts() {
  psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select
    (select count(*) from public.evaluations) || ',' ||
    (select count(*) from public.alerts) || ',' ||
    (select count(*) from public.audit_log where actor = 'system:evaluate')"
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

twice --mode=monthly --as-of=2027-02-01
twice --mode=daily --as-of=2027-02-10
twice --mode=monthly --as-of=2027-03-01

psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/verify-evaluate.sql
echo "Integración C-03/C-04 en verde"
