#!/usr/bin/env bash
# V-04: prueba de scripts/health/check.js en CI contra Supabase local.
# 1) Con Supabase local y una "web" local que responde 200, la disponibilidad pasa.
# 2) Simulación de caída: la web apunta a un puerto cerrado y el check debe fallar
#    (código 1, failures=pages). Así se demuestra que una caída produce alerta.
# Solo para Supabase local: nunca apuntar a producción.
set -euo pipefail

status="$(supabase status -o env)"
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | head -n 1; }
SUPABASE_URL="$(get API_URL)"
SUPABASE_PUBLISHABLE_KEY="$(get PUBLISHABLE_KEY)"
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "La prueba de salud solo corre contra Supabase local"; exit 1 ;;
esac
case "$SUPABASE_PUBLISHABLE_KEY" in
  sb_publishable_*) ;;
  *) echo "supabase status no expone PUBLISHABLE_KEY"; exit 1 ;;
esac
export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY EVALUATION_ENABLED=true

# "Pages" local: un servidor mínimo que responde 200.
node -e "require('http').createServer((q,s)=>{s.end('ok')}).listen(4180,'127.0.0.1')" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  if node -e "fetch('http://127.0.0.1:4180/').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"; then break; fi
  sleep 0.5
done

echo "== Salud con todo arriba =="
PAGES_URL=http://127.0.0.1:4180/ GITHUB_OUTPUT="$RUNNER_TEMP/up.out" node scripts/health/check.js --only=availability
grep -qx 'failures=' "$RUNNER_TEMP/up.out"

echo "== Simulación de caída de Pages (puerto cerrado) =="
set +e
HEALTH_PLAIN_LOG=1 PAGES_URL=http://127.0.0.1:9/ GITHUB_OUTPUT="$RUNNER_TEMP/down.out" node scripts/health/check.js --only=availability
code=$?
set -e
if [ "$code" -ne 1 ]; then
  echo "::error::El check de salud debía fallar con código 1 ante Pages caído (salió $code)"
  exit 1
fi
grep -qx 'failures=pages' "$RUNNER_TEMP/down.out" || { echo "::error::se esperaba failures=pages"; cat "$RUNNER_TEMP/down.out"; exit 1; }
echo "OK: la caída simulada produce alerta (failures=pages)."
