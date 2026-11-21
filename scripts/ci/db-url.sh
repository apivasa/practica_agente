# shellcheck shell=bash
# V-05b (H-V05-01): cadena de conexión al pooler de sesión de Supabase para
# `supabase db push --db-url`, sin token de cuenta (SUPABASE_ACCESS_TOKEN).
#
# Se usa con `. scripts/ci/db-url.sh` dentro de un paso de deploy.yml: define
# SUPABASE_DB_URL en el shell del paso y nunca la imprime. Antes de construirla
# emite `::add-mask::` de la contraseña codificada y de la URL completa, para
# que GitHub las tape si la CLI llegara a mostrarlas.
#
# Entrada (env): SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD,
# SUPABASE_DB_POOLER_HOST (variable no secreta, p. ej.
# aws-0-us-east-1.pooler.supabase.com; panel → Connect → Session pooler).
# Puerto 5432 = modo sesión (las migraciones no van por el modo transacción).
#
# Devuelve 1 (sin imprimir valores) si falta algo o si el host no es un pooler
# de Supabase: la contraseña nunca se envía a otro host.

supabase_db_url() {
  # V-05c (H-V05b-02): aunque el paso que la llama tenga xtrace activo, nada de
  # esta función se traza (la contraseña y la URL nunca llegan al log). La
  # traza queda apagada al volver: el comando que usa $SUPABASE_DB_URL tampoco
  # debe trazarse.
  { set +x; } 2>/dev/null
  local ref="${SUPABASE_PROJECT_REF:-}"
  local pass="${SUPABASE_DB_PASSWORD:-}"
  local host="${SUPABASE_DB_POOLER_HOST:-}"
  local missing=()
  [ -n "$ref" ] || missing+=("SUPABASE_PROJECT_REF")
  [ -n "$pass" ] || missing+=("SUPABASE_DB_PASSWORD")
  [ -n "$host" ] || missing+=("SUPABASE_DB_POOLER_HOST")
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "::error::Faltan datos para la conexión a la BD: ${missing[*]}."
    return 1
  fi
  if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    echo "::error::SUPABASE_PROJECT_REF no tiene el formato de un project ref de Supabase."
    return 1
  fi
  if ! [[ "$host" =~ ^aws-[0-9]+-[a-z]{2}-[a-z]+-[0-9]+\.pooler\.supabase\.com$ ]]; then
    echo "::error::SUPABASE_DB_POOLER_HOST debe ser el host del pooler de Supabase (aws-N-<región>.pooler.supabase.com)."
    return 1
  fi
  local encoded
  if ! encoded="$(printf '%s' "$pass" | jq -sRr @uri)" || [ -z "$encoded" ]; then
    echo "::error::No se pudo codificar la contraseña de la BD."
    return 1
  fi
  echo "::add-mask::${encoded}"
  SUPABASE_DB_URL="postgresql://postgres.${ref}:${encoded}@${host}:5432/postgres"
  echo "::add-mask::${SUPABASE_DB_URL}"
  export SUPABASE_DB_URL
  return 0
}
