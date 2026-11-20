// S-05 — Revisión estática previa a producción: configuración de Auth
// (supabase/config.toml) y uso de secretos en los workflows, incluido
// deploy.yml cuando exista (V-05). Categorías 2, 5 y 6. Sin dependencias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WF_DIR = join(ROOT, '.github', 'workflows');
const workflows = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(WF_DIR, f), 'utf8') }));
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const jobsOf = (text) => code(text).split(/^jobs:\s*$/m)[1]?.split(/^ {2}(?=[\w-]+:\s*$)/m).filter(Boolean) ?? [];
const PROD_SECRETS = ['SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF'];

// ---------------------------------------------------------------------------
// config.toml (Auth)
// ---------------------------------------------------------------------------
const toml = code(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8'));
// Mini lector de TOML plano: sección -> { clave: valor-crudo }.
const sections = {};
let current = '';
for (const line of toml.split('\n')) {
  const s = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (s) { current = s[1].trim(); sections[current] ??= {}; continue; }
  const kv = line.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);
  if (kv) (sections[current] ??= {})[kv[1]] = kv[2];
}
const auth = sections.auth ?? {};

test('config.toml: registro abierto deshabilitado ([auth] enable_signup = false)', () => {
  assert.equal(auth.enable_signup, 'false');
});

test('config.toml: [auth.email] no apaga el proveedor de correo (H-S03-00)', () => {
  assert.equal(sections['auth.email']?.enable_signup, undefined);
});

test('config.toml: sin inicio de sesión anónimo ni proveedores externos activados', () => {
  assert.notEqual(auth.enable_anonymous_sign_ins, 'true');
  for (const [name, kv] of Object.entries(sections)) {
    if (name.startsWith('auth.external.')) assert.notEqual(kv.enabled, 'true', `${name} activado`);
  }
});

test('config.toml: sesiones de como mucho 1 h (jwt_expiry ≤ 3600; mitiga H-S03-01)', () => {
  if (auth.jwt_expiry === undefined) return; // valor por defecto de la CLI: 3600
  assert.ok(Number(auth.jwt_expiry) <= 3600, `jwt_expiry = ${auth.jwt_expiry}`);
});

test('config.toml: rotación de refresh token no desactivada', () => {
  assert.notEqual(auth.enable_refresh_token_rotation, 'false');
});

test('config.toml: URL de redirección solo locales o la URL de Pages del repo', () => {
  const urls = [auth.site_url, ...(auth.additional_redirect_urls ?? '').matchAll(/"([^"]+)"/g)]
    .map((x) => (Array.isArray(x) ? x[1] : x))
    .filter(Boolean)
    .map((x) => x.replace(/^"|"$/g, ''));
  for (const u of urls) {
    assert.match(u, /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)|https:\/\/apivasa\.github\.io\/practica_agente\/)/, `redirect no permitido: ${u}`);
  }
});

test('config.toml: rate limits de Auth no relajados por encima de los valores por defecto', () => {
  const rl = sections['auth.rate_limit'] ?? {};
  const MAX = { sign_in_sign_ups: 30, token_refresh: 150, token_verifications: 30, email_sent: 2, sms_sent: 30 };
  for (const [k, max] of Object.entries(MAX)) {
    if (rl[k] !== undefined) assert.ok(Number(rl[k]) <= max, `auth.rate_limit.${k} = ${rl[k]}`);
  }
});

// ---------------------------------------------------------------------------
// Workflows: secretos de producción
// ---------------------------------------------------------------------------
for (const wf of workflows) {
  test(`${wf.name}: el build del front solo recibe la URL y la clave publicable`, () => {
    for (const l of code(wf.text).split('\n')) {
      const m = l.match(/^\s+(VITE_[A-Z0-9_]+):\s*(.+)$/);
      if (!m) continue;
      for (const s of PROD_SECRETS.filter((x) => x !== 'SUPABASE_PROJECT_REF')) {
        assert.doesNotMatch(m[2], new RegExp(s), `${wf.name}: ${m[1]} recibe ${s}`);
      }
    }
    assert.doesNotMatch(code(wf.text), /VITE_[A-Z_]*SECRET/, `${wf.name}: variable VITE_ con SECRET`);
  });

  test(`${wf.name}: supabase db push/reset sin semilla ni --debug contra el proyecto remoto`, () => {
    for (const l of code(wf.text).split('\n')) {
      if (/supabase\s+db\s+push/.test(l)) assert.doesNotMatch(l, /--include-seed|--debug/, `${wf.name}: ${l.trim()}`);
      if (/supabase\s+(link|db\s+push)/.test(l)) assert.doesNotMatch(l, /--debug|--password\s+\S/, `${wf.name}: ${l.trim()}`);
      assert.doesNotMatch(l, /supabase\s+db\s+reset[^\n]*--linked/, `${wf.name}: reset de la BD remota`);
    }
  });

  test(`${wf.name}: los jobs con credenciales de administración de producción declaran environment: produccion`, () => {
    for (const job of jobsOf(wf.text)) {
      if (!/secrets\.(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/.test(job)) continue;
      assert.match(job, /^\s+environment:\s*(produccion|\n\s+name:\s*produccion)\s*$/m, `${wf.name}: job ${job.split(':')[0]} sin environment produccion`);
    }
  });

  test(`${wf.name}: los secretos de administración no se leen en workflows disparados por PR o push de ramas`, () => {
    if (!/secrets\.(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/.test(wf.text)) return;
    const header = code(wf.text).split(/^jobs:/m)[0];
    assert.doesNotMatch(header, /^\s{2}(pull_request|pull_request_target|workflow_run|issue_comment|repository_dispatch):/m);
  });
}

test('deploy.yml (si existe): manual con confirmación, solo desde main y sin semilla', () => {
  const wf = workflows.find((w) => w.name === 'deploy.yml');
  if (!wf) return; // V-05 aún no fusionado
  const c = code(wf.text);
  const header = c.split(/^jobs:/m)[0];
  assert.match(header, /workflow_dispatch:/);
  assert.doesNotMatch(header, /^\s{2}pull_request/m);
  assert.match(c, /refs\/heads\/main/, 'deploy.yml no comprueba la rama main');
  assert.match(c, /sb_publishable_\*/, 'deploy.yml no valida el formato de la clave publicable');
  assert.match(c, /sb_secret_\[A-Za-z0-9_-\]\{16,\}/, 'deploy.yml no busca claves secretas en dist/');
  assert.doesNotMatch(c, /--include-seed/);
});

// ---------------------------------------------------------------------------
// seguridad.yml: jobs de S-05
// ---------------------------------------------------------------------------
const seg = workflows.find((w) => w.name === 'seguridad.yml').text;
const segJobs = jobsOf(seg);
const job = (name) => segJobs.find((j) => j.startsWith(`${name}:`));

test('seguridad.yml: job s05-fase-a con ZAP full scan del front y ZAP API scan, ambos locales', () => {
  const j = job('s05-fase-a');
  assert.ok(j, 'falta el job s05-fase-a');
  assert.match(j, /ZAP_IMAGE:\s*zaproxy\/zap-stable@sha256:[0-9a-f]{64}\s*$/m);
  assert.match(j, /zap-full-scan\.py -t http:\/\/127\.0\.0\.1:4173\/practica_agente\//);
  assert.match(j, /zap-api-scan\.py -t \/zap\/wrk\/openapi\.json -f openapi/);
  assert.match(j, /supabase start/);
  assert.match(j, /riskcode \| tonumber\) >= 3/);
  assert.doesNotMatch(j, /secrets\./, 'la fase A no usa secretos del repo');
  assert.doesNotMatch(j, /\|\|\s*true/);
  assert.doesNotMatch(j, /SECRET_KEY[^\n]*>>\s*"?\$GITHUB_ENV/, 'clave secreta local en GITHUB_ENV');
  // Todo objetivo de ZAP en la fase A es 127.0.0.1.
  // (`case "$url" in http://127.0.0.1:*)` deja `:*)` tras el host: se recorta).
  for (const m of j.matchAll(/https?:\/\/([^/\s"']+)/g)) {
    assert.match(host(m[1]).replace(/:?[*)]+$/, ''), /^(127\.0\.0\.1|localhost)(:\d+)?$/, `fase A apunta a ${m[1]}`);
  }
  // Arquitectura: pesado, solo en PR, semanal y manual; 30 min como máximo.
  assert.match(j, /if: github\.event_name == 'pull_request' \|\| github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.fase_b == 'no'\)/);
  assert.match(j, /timeout-minutes: 30\b/);
});

// Una URL dentro de un regex de exclusión de ZAP (`^https?://(?!host/...)`) se
// compara por su host, sin el `(?!` ni los escapes.
function host(raw) {
  return raw.replace(/^\(\?!/, '').replace(/\\/g, '');
}

test('seguridad.yml: job s05-fase-b manual, no destructivo y acotado a los hosts del proyecto', () => {
  const j = job('s05-fase-b');
  assert.ok(j, 'falta el job s05-fase-b');
  assert.match(j, /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.fase_b != 'no'/);
  assert.match(j, /environment:\s*produccion/);
  for (const s of PROD_SECRETS.filter((x) => x !== 'SUPABASE_PROJECT_REF')) {
    assert.doesNotMatch(j, new RegExp(`secrets\\.${s}`), `la fase B no debe leer ${s}`);
  }
  assert.match(j, /S05_PAGES_URL:\s*https:\/\/apivasa\.github\.io\/practica_agente\/\s*$/m);
  assert.match(j, /S05_PROJECT_REF:\s*oehtspdtpwdhfhhhkgao\s*$/m);
  assert.match(j, /zap-full-scan\.py -t https:\/\/apivasa\.github\.io\/practica_agente\//);
  // Ritmo bajo y duración acotada: sin denegación de servicio contra Pages.
  assert.match(j, /scanner\.threadPerHost=1/);
  assert.match(j, /scanner\.delayInMs=\d{3,}/);
  assert.match(j, /scanner\.maxScanDurationInMins=\d+/);
  assert.doesNotMatch(j, /zap-api-scan\.py/, 'sin escaneo activo de la API de producción');
  assert.doesNotMatch(j, /-j\b/, 'sin AJAX spider en producción (seguiría llamadas a Supabase)');
  for (const m of j.matchAll(/https?:\/\/([^/\s"']+)/g)) {
    assert.match(host(m[1]), /^(apivasa\.github\.io|oehtspdtpwdhfhhhkgao\.supabase\.co)$/, `fase B apunta a ${m[1]}`);
  }
  // QA-S05-01: dos barreras de main (if del job y guarda con id) y ningún paso
  // que contacta producción con always() sin depender de la guarda.
  assert.match(j, /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.fase_b != 'no' && github\.ref == 'refs\/heads\/main'\s*$/m);
  assert.match(j, /id:\s*main-guard/);
  assert.match(j, /ZAP full scan de Pages[^\n]*\n(\s+#[^\n]*\n)*\s+if: \$\{\{ !cancelled\(\) && steps\.main-guard\.outcome == 'success' \}\}/);
  // QA-S05-03: ZAP excluye todo lo que no esté bajo /practica_agente/ y el job lo verifica.
  assert.match(j, /globalexcludeurl\.url_list\.url\(0\)\.regex=\^https\?:\/\/\(\?!apivasa\\\.github\\\.io\/practica_agente\/\)\.\*\$/);
  assert.match(j, /startswith\("https:\/\/apivasa\.github\.io\/practica_agente\/"\) \| not/);
  assert.match(j, /S05_REQUIRE:\s*'1'/);
  assert.match(j, /node --test tests\/security\/prod\/fase-b\.test\.js/);
});

test('fase-b.test.js: guardedFetch solo admite los hosts del proyecto', () => {
  const p = join(ROOT, 'tests', 'security', 'prod', 'fase-b.test.js');
  assert.ok(existsSync(p));
  const t = readFileSync(p, 'utf8');
  assert.match(t, /u\.host === 'apivasa\.github\.io' && u\.pathname\.startsWith\('\/practica_agente\/'\)/);
  assert.match(t, /u\.host === `\$\{REF\}\.supabase\.co`/);
  assert.doesNotMatch(t, /SUPABASE_SECRET_KEY|sb_secret_[A-Za-z0-9]{8}/);
  // Toda llamada de red pasa por guardedFetch, salvo la comprobación http→https del mismo host.
  const raw = [...t.matchAll(/(?<![\w.])fetch\(/g)].length;
  assert.equal(raw, 2, 'fetch directo fuera de guardedFetch');
});
