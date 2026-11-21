// C-05: integración del envío de correos contra Supabase local (lo llama integration.sh
// después de generar alertas). Usa la capa real (createDb: alerts + API admin de Auth con
// la clave secreta local) y un Resend simulado (fetch inyectado): nunca llama a Resend.
// Verifica: un correo por alerta a su destinatario, emailed_at fijado, auditoría
// alert_emailed y que la segunda corrida no reenvía. Solo para Supabase local.
import { createClient } from '@supabase/supabase-js';
import { readConfig } from '../lib/config.js';
import { createDb } from '../lib/db.js';
import { sendAlertEmails, EMAIL_ACTOR } from '../lib/email.js';

const { url, secretKey } = readConfig(process.env);
const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error('La integración de correo solo corre contra Supabase local');
  process.exit(1);
}
const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const db = createDb(sb);
const calls = [];
const fetchImpl = async (_endpoint, init) => {
  calls.push(JSON.parse(init.body));
  return { ok: true, status: 200, json: async () => ({ id: `local-${calls.length}` }), text: async () => '' };
};
const config = { apiKey: 're_LOCAL_INTEGRATION_ONLY', from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };
const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

const pendingBefore = await db.pendingEmailAlerts({ since: new Date(Date.now() - 7 * 86400000).toISOString(), maxAttempts: 3 });
if (pendingBefore.length === 0) fail('No hay alertas pendientes de correo tras la evaluación');

const first = await sendAlertEmails(db, { config, fetchImpl, sleep: async () => {} });
if (first.errors.length > 0) fail(`Errores en el envío: ${first.errors.join('; ')}`);
if (first.sent !== pendingBefore.length || first.failed !== 0) {
  fail(`Se esperaban ${pendingBefore.length} correos enviados y 0 fallos (enviados ${first.sent}, fallos ${first.failed})`);
}
if (calls.length !== pendingBefore.length || !calls.every((c) => Array.isArray(c.to) && c.to.length === 1)) {
  fail('Cada alerta debe producir exactamente un correo a un único destinatario');
}

// Cada correo va al correo (Auth) del destinatario de su alerta.
for (const [i, a] of pendingBefore.entries()) {
  const { data, error } = await sb.auth.admin.getUserById(a.recipient_user_id);
  if (error) fail(`auth.admin.getUserById: ${error.message}`);
  if (calls[i].to[0] !== data.user.email) fail(`La alerta ${a.id} no fue al correo de su destinatario`);
}

const { count: stillPending, error: e1 } = await sb
  .from('alerts')
  .select('id', { count: 'exact', head: true })
  .in('id', pendingBefore.map((a) => a.id))
  .is('emailed_at', null);
if (e1) fail(e1.message);
if (stillPending !== 0) fail(`${stillPending} alertas quedaron sin emailed_at`);

const { count: audited, error: e2 } = await sb
  .from('audit_log')
  .select('id', { count: 'exact', head: true })
  .eq('actor', EMAIL_ACTOR)
  .eq('action', 'alert_emailed');
if (e2) fail(e2.message);
if (audited !== first.sent) fail(`Auditoría alert_emailed: ${audited} filas para ${first.sent} envíos`);

const second = await sendAlertEmails(db, { config, fetchImpl, sleep: async () => {} });
if (second.pending !== 0 || second.sent !== 0 || calls.length !== first.sent) fail('La segunda corrida reenvió correos');

console.log(`Integración C-05 en verde: ${first.sent} correos simulados, segunda corrida sin reenvíos`);
