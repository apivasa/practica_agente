// Cliente de Supabase del front. Solo conoce la URL y la clave publicable
// (sb_publishable_...), inyectadas por Vite en tiempo de build. Nunca la secreta.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client = null;

/** Devuelve el cliente, o null si el build no trae configuración. */
export function getSupabase() {
  if (client) return client;
  if (!url || !publishableKey) return null;
  client = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
