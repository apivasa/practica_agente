#!/usr/bin/env bash
# V-01..V-03 (e2e): deja evaluaciones y alertas sobre la semilla corriendo el mismo
# scripts/evaluate.js que las Actions (cierres de enero y febrero de 2027 y el ritmo diario
# del 2027-02-10). Solo contra Supabase local: la clave secreta local no sale de este paso.
set -euo pipefail

status="$(supabase status -o env)"
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | head -n 1; }

SUPABASE_URL="$(get API_URL)"
SUPABASE_SECRET_KEY="$(get SECRET_KEY)"
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SECRET_KEY" ]; then
  echo "supabase status no entregó API_URL y SECRET_KEY"
  exit 1
fi
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "La evaluación de la semilla solo corre contra Supabase local"; exit 1 ;;
esac
echo "::add-mask::${SUPABASE_SECRET_KEY}"
export SUPABASE_URL SUPABASE_SECRET_KEY
# Las fechas de la semilla (2027) son futuras: solo se permiten contra Supabase local.
export EVALUATE_ALLOW_FUTURE=1

node scripts/evaluate.js --mode=monthly --as-of=2027-02-01
node scripts/evaluate.js --mode=daily --as-of=2027-02-10
node scripts/evaluate.js --mode=monthly --as-of=2027-03-01
echo "Semilla evaluada para e2e"
