#!/usr/bin/env node
// C-05: envía por correo (Resend) las alertas pendientes de la tabla `alerts`.
//   node scripts/send-alert-emails.js
// Variables: RESEND_API_KEY (secreto; sin él solo anota ::notice:: y termina con 0),
// ALERT_EMAIL_FROM (por defecto onboarding@resend.dev), APP_URL (https; por defecto
// https://apivasa.github.io/practica_agente/),
// ALERT_EMAIL_LOOKBACK_DAYS (1..31, por defecto 7), SUPABASE_URL y SUPABASE_SECRET_KEY.
// Ninguna clave ni correo de destinatario se imprime.
import { pathToFileURL } from 'node:url';
import { readConfig } from './lib/config.js';
import { runEmailStep, sanitizeError } from './lib/email.js';

async function makeDb({ url, secretKey }) {
  const { createClient } = await import('@supabase/supabase-js');
  const { createDb } = await import('./lib/db.js');
  const sb = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createDb(sb);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runEmailStep({ env: process.env, fetchImpl: fetch, makeDb, readSupabaseConfig: readConfig }).then(
    ({ code }) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`::error::Fallo del envío de correos: ${sanitizeError(err, (process.env.RESEND_API_KEY ?? '').trim())}`);
      process.exitCode = 1;
    },
  );
}
