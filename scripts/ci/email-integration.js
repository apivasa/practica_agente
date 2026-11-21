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

// C-06: con la capa real, una alerta a un líder para una unidad que no es la suya
// (sin rol vigente) y una alerta fuera de la ventana no se envían: quedan marcadas como
// omitidas y auditadas `alert_email_skipped`, y la corrida siguiente no las repite.
const LEADER_ALFA = '11111111-1111-4111-8111-000000000005';
const UNIT_BETA = '22222222-2222-4222-8222-000000000002';
const COMMITTEE = '11111111-1111-4111-8111-000000000004';
const UNIT_ALFA = '22222222-2222-4222-8222-000000000001';
const fixtures = [
  {
    unit_id: UNIT_BETA,
    recipient_user_id: LEADER_ALFA,
    kind: 'color_change',
    payload: { message: 'C-06 sin rol' },
    dedupe_key: 'c06-integration:no-role',
    sent_at: new Date().toISOString(),
  },
  {
    unit_id: UNIT_ALFA,
    recipient_user_id: COMMITTEE,
    kind: 'color_change',
    payload: { message: 'C-06 vencida' },
    dedupe_key: 'c06-integration:expired',
    sent_at: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];
const { data: inserted, error: e3 } = await sb.from('alerts').insert(fixtures).select('id, dedupe_key');
if (e3) fail(`alerts insert C-06: ${e3.message}`);
const idOf = Object.fromEntries(inserted.map((r) => [r.dedupe_key, r.id]));
const callsBefore = calls.length;
const third = await sendAlertEmails(db, { config, fetchImpl, sleep: async () => {} });
if (third.errors.length > 0) fail(`Errores en el envío C-06: ${third.errors.join('; ')}`);
if (calls.length !== callsBefore || third.sent !== 0) fail('C-06: se envió un correo que debía omitirse');
if (third.notEligible !== 1 || third.expired !== 1) {
  fail(`C-06: se esperaba 1 omitida por rol y 1 vencida (por rol ${third.notEligible}, vencidas ${third.expired})`);
}
const { data: marked, error: e4 } = await sb
  .from('alerts')
  .select('id, emailed_at, email_skipped_at, email_skip_reason')
  .in('id', Object.values(idOf));
if (e4) fail(e4.message);
const reasonOf = Object.fromEntries(marked.map((r) => [r.id, r]));
if (reasonOf[idOf['c06-integration:no-role']]?.email_skip_reason !== 'recipient_no_role') fail('C-06: la alerta sin rol no quedó marcada');
if (reasonOf[idOf['c06-integration:expired']]?.email_skip_reason !== 'expired') fail('C-06: la alerta vencida no quedó marcada');
if (marked.some((r) => r.emailed_at !== null || r.email_skipped_at === null)) fail('C-06: estado de correo inesperado');
const { data: skippedRows, error: e5 } = await sb
  .from('audit_log')
  .select('entity_id, details')
  .eq('actor', EMAIL_ACTOR)
  .eq('action', 'alert_email_skipped')
  .in('entity_id', Object.values(idOf));
if (e5) fail(e5.message);
if (skippedRows.length !== 2) fail(`C-06: auditoría alert_email_skipped con ${skippedRows.length} filas (se esperaban 2)`);
if (JSON.stringify(skippedRows).includes('@')) fail('C-06: la auditoría contiene un correo');
const fourth = await sendAlertEmails(db, { config, fetchImpl, sleep: async () => {} });
if (fourth.pending !== 0 || fourth.expired !== 0 || fourth.notEligible !== 0) fail('C-06: la corrida siguiente repitió omisiones');
console.log('Integración C-06 en verde: sin rol y vencida omitidas y auditadas, sin repetir');
