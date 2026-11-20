// F-09 — Inicia sesión una vez con los usuarios del seed y escribe en stdout
// el JSON {rol: access_token}. El job pentest-api lo captura en la variable
// PENTEST_TOKENS (sin archivo intermedio) para que los archivos de prueba, que
// node --test ejecuta en procesos separados, compartan sesiones sin superar el
// límite de inicios de sesión de GoTrue. Solo contra Supabase local.
import { loginAll, skipReason } from './_lib.js';

const reason = skipReason();
if (reason) {
  console.error(`login-all: ${reason}`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(await loginAll()));
