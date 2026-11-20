// V-04 — Seguridad del workflow de salud (categorías 2, 4/5 y 8).
// Estáticas sobre .github/workflows/salud.yml y unitarias sobre scripts/health:
// permisos mínimos, inyección de expresiones, saneo del cuerpo del issue (menciones,
// markdown, enlaces), URLs configurables (SSRF/downgrade), clave secreta nunca enviada
// y ausencia de token/clave/URL de Supabase en logs, salidas y resumen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  safeUrl,
  checkAvailability,
  createGitHubClient,
  checkWorkflows,
  parseFailures,
  issueBody,
  upsertHealthIssue,
  WORKFLOW_RULES,
} from '../../scripts/health/lib.js';
import { main as checkMain } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'salud.yml'), 'utf8');
const codeLines = WF.split('\n').filter((l) => !/^\s*#/.test(l));
const [HEADER, JOBS_TEXT] = WF.split(/^jobs:/m);
const jobBlock = (name) => {
  const m = JOBS_TEXT.match(new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\s*$|$(?![\\s\\S]))`, 'm'));
  assert.ok(m, `job ${name} no encontrado`);
  return m[1];
};

const TOKEN = 'ghs_SECURITYTEST_token_do_not_leak_0123456789';
const PUB = 'sb_publishable_SECURITYTEST_0123456789';
const SECRET = 'sb_secret_SECURITYTEST_do_not_leak_0123456789abcdef';
const SB_URL = 'https://abcdefghijklmnop-securitytest.supabase.co';
const noSleep = async () => {};
const NOW = new Date('2026-11-20T15:00:00Z');

// ---------------------------------------------------------------------------
// Categoría 5: salud.yml
// ---------------------------------------------------------------------------
describe('salud.yml (estático)', () => {
  test('disparadores: solo schedule y workflow_dispatch sin inputs', () => {
    assert.match(HEADER, /^\s{2}schedule:/m);
    assert.match(HEADER, /^\s{2}workflow_dispatch:\s*$/m);
    assert.doesNotMatch(HEADER, /^\s{4}inputs:/m, 'workflow_dispatch no debe aceptar entradas');
    assert.doesNotMatch(HEADER, /^\s{2}(push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch|issue_comment|issues):/m);
  });

  test('permisos: contents: read global; actions: read solo en check; issues: write solo en alert', () => {
    assert.match(HEADER, /^permissions:\n {2}contents: read\n(?! {2}\S)/m);
    const check = jobBlock('check');
    const alert = jobBlock('alert');
    assert.match(check, /permissions:\n\s+contents: read\n\s+actions: read\n(?!\s{6}\w+:)/);
    assert.doesNotMatch(check, /issues:\s*write|: write/);
    assert.match(alert, /permissions:\n\s+contents: read\n\s+issues: write\n(?!\s{6}\w+:)/);
    assert.doesNotMatch(alert, /actions:|contents: write|pull-requests|id-token|packages/);
    assert.doesNotMatch(WF, /write-all|read-all/);
  });

  test('acciones fijadas por SHA de 40 caracteres y checkout sin credenciales persistidas', () => {
    const uses = codeLines.filter((l) => /^\s*-?\s*uses:/.test(l));
    assert.ok(uses.length >= 4);
    for (const l of uses) assert.match(l, /uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\b/, l);
    const checkouts = WF.match(/actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false/g) ?? [];
    assert.equal(checkouts.length, uses.filter((l) => l.includes('actions/checkout')).length);
  });

  test('sin expresiones ${{ }} dentro de run: (todo pasa por env)', () => {
    const lines = WF.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(-\s*)?run:\s*(.*)$/);
      if (!m) continue;
      const indent = m[1].length + (m[2] ? m[2].length : 0);
      const block = [m[3]];
      if (/^[|>]/.test(m[3])) {
        for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) block.push(lines[j]);
      }
      assert.doesNotMatch(block.join('\n'), /\$\{\{/, `línea ${i + 1}: expresión en run`);
    }
  });

  test('nunca la clave secreta: sin SUPABASE_SECRET_KEY ni otros secretos que URL y publicable', () => {
    assert.doesNotMatch(WF, /SUPABASE_SECRET_KEY|service_role|sb_secret_/);
    const secrets = [...WF.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const s of secrets) assert.ok(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'].includes(s), `secreto inesperado: ${s}`);
    assert.doesNotMatch(jobBlock('alert'), /secrets\./, 'el job con issues: write no recibe secretos');
  });

  test('alert depende de check y no ejecuta código no confiable (sin event.* en env)', () => {
    const alert = jobBlock('alert');
    assert.match(alert, /needs: check/);
    assert.doesNotMatch(WF, /github\.event\.|github\.head_ref|inputs\./);
  });
});

// ---------------------------------------------------------------------------
// SSRF / URLs configurables (PAGES_URL, SUPABASE_URL)
// ---------------------------------------------------------------------------
describe('safeUrl', () => {
  test('rechaza esquemas peligrosos y http fuera de loopback', () => {
    for (const bad of [
      'http://example.com/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/',
      'file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)', 'ftp://x/', 'gopher://x/',
      'http://127.0.0.1.nip.io/', 'http://localhost.evil.com/', '', null, undefined, 'not a url',
    ]) assert.equal(safeUrl(bad), null, String(bad));
  });

  test('acepta https y http loopback (Supabase local)', () => {
    assert.ok(safeUrl('https://apivasa.github.io/practica_agente/'));
    assert.ok(safeUrl('http://127.0.0.1:54321'));
    assert.ok(safeUrl('http://localhost:4180/'));
  });

  test('PAGES_URL no https: no se hace la petición', async () => {
    const calls = [];
    const fetchImpl = async (u) => (calls.push(u), { status: 200 });
    const r = await checkAvailability({
      env: { EVALUATION_ENABLED: 'true', PAGES_URL: 'http://169.254.169.254/', SUPABASE_URL: SB_URL, SUPABASE_PUBLISHABLE_KEY: PUB },
      fetchImpl, sleep: noSleep,
    });
    assert.equal(r.find((x) => x.check === 'pages').status, 'fail');
    assert.ok(!calls.some((u) => String(u).includes('169.254')));
  });
});

// ---------------------------------------------------------------------------
// Categoría 2: clave secreta nunca enviada; sin fuga en logs
// ---------------------------------------------------------------------------
describe('claves y fuga en logs', () => {
  test('una clave sb_secret_ puesta por error en SUPABASE_PUBLISHABLE_KEY no se envía', async () => {
    const calls = [];
    const fetchImpl = async (u, o) => (calls.push({ u, o }), { status: 200 });
    const r = await checkAvailability({
      env: { EVALUATION_ENABLED: 'true', SUPABASE_URL: SB_URL, SUPABASE_PUBLISHABLE_KEY: SECRET },
      fetchImpl, sleep: noSleep,
    });
    assert.equal(r.find((x) => x.check === 'supabase').status, 'fail');
    assert.ok(!JSON.stringify(calls).includes(SECRET));
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });

  test('Supabase recibe solo la clave publicable y en cabecera apikey (no Authorization)', async () => {
    const calls = [];
    const fetchImpl = async (u, o) => (calls.push({ u: String(u), o }), { status: 200 });
    await checkAvailability({
      env: { EVALUATION_ENABLED: 'true', PAGES_URL: 'https://apivasa.github.io/practica_agente/', SUPABASE_URL: SB_URL, SUPABASE_PUBLISHABLE_KEY: PUB },
      fetchImpl, sleep: noSleep,
    });
    const sb = calls.find((c) => c.u.startsWith(SB_URL));
    assert.equal(sb.u, `${SB_URL}/auth/v1/health`);
    assert.deepEqual(Object.keys(sb.o.headers), ['apikey']);
    const pages = calls.find((c) => c.u.includes('github.io'));
    assert.deepEqual(pages.o.headers, {}, 'Pages no recibe la clave');
  });

  test('check.js: errores de red con la URL/clave en el mensaje no aparecen en log, GITHUB_OUTPUT ni resumen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salud-sec-'));
    const out = join(dir, 'out');
    const sum = join(dir, 'sum');
    const logs = [];
    const fetchImpl = async (u) => {
      const s = String(u);
      if (s.startsWith('https://api.github.com')) {
        // La API de GitHub responde 500 con un cuerpo que repite el token.
        return { status: 500, ok: false, json: async () => ({ message: TOKEN }) };
      }
      const e = new TypeError(`fetch failed ${s} apikey=${PUB} ${TOKEN}`);
      throw e;
    };
    const { code } = await checkMain({
      argv: [],
      env: {
        EVALUATION_ENABLED: 'true', PAGES_URL: 'https://apivasa.github.io/practica_agente/', SUPABASE_URL: SB_URL,
        SUPABASE_PUBLISHABLE_KEY: PUB, GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'apivasa/practica_agente',
        GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum,
      },
      fetchImpl, now: NOW, log: (s) => logs.push(s), sleep: noSleep, delayMs: 0,
    });
    assert.equal(code, 1);
    const all = [logs.join('\n'), readFileSync(out, 'utf8'), readFileSync(sum, 'utf8')].join('\n');
    for (const s of [TOKEN, PUB, SB_URL, 'abcdefghijklmnop']) assert.ok(!all.includes(s), `fuga de ${s}`);
    // Salida de paso: una sola línea, solo nombres de check [a-z0-9-].
    assert.match(readFileSync(out, 'utf8'), /^failures=[a-z0-9,-]*\n$/);
  });

  test('cliente de GitHub: el token va solo en Authorization y nunca en el mensaje de error', async () => {
    const fetchImpl = async () => ({ status: 403, ok: false, json: async () => ({}) });
    const gh = createGitHubClient({ token: TOKEN, repo: 'apivasa/practica_agente', fetchImpl });
    await assert.rejects(gh.getWorkflow('ci.yml'), (e) => !String(e.message).includes(TOKEN) && /HTTP 403/.test(e.message));
  });

  test('cliente de GitHub: GITHUB_REPOSITORY con traversal o query se rechaza', () => {
    for (const repo of ['a/b/c', 'a/b?x=1', 'a/b#x', 'a b/c', '', undefined, 'a/b\n']) {
      assert.throws(() => createGitHubClient({ token: TOKEN, repo, fetchImpl: async () => ({}) }), /inválido/, String(repo));
    }
  });

  test('cliente de GitHub: GITHUB_REPOSITORY "../x" (H-V04-02, Info) no saca el token del host de la API', async () => {
    // El runner fija GITHUB_REPOSITORY; aun así, "../x" pasa la regex y normaliza la ruta a /x/...
    // Se fija que el host no cambia: el token solo va a api.github.com.
    const urls = [];
    const fetchImpl = async (u) => (urls.push(new URL(String(u))), { status: 404, ok: false });
    const gh = createGitHubClient({ token: TOKEN, repo: '../x', fetchImpl });
    await gh.getWorkflow('ci.yml');
    assert.equal(urls[0].host, 'api.github.com');
  });

  test('cliente de GitHub: nombres de workflow y número de issue no permiten cambiar de ruta', async () => {
    const urls = [];
    const fetchImpl = async (u) => (urls.push(String(u)), { status: 200, ok: true, json: async () => ({ workflow_runs: [], jobs: [] }) });
    const gh = createGitHubClient({ token: TOKEN, repo: 'o/r', fetchImpl });
    await gh.getWorkflow('../../../user');
    await gh.listJobs('1/../../x');
    await gh.commentIssue('1/../../x', 'b');
    assert.match(urls[0], /\/repos\/o\/r\/actions\/workflows\/\.\.%2F\.\.%2F\.\.%2Fuser$/);
    assert.match(urls[1], /\/actions\/runs\/NaN\/jobs/);
    assert.match(urls[2], /\/issues\/NaN\/comments$/);
  });

  test('checkWorkflows: solo lee runs de la rama por defecto y filtra por evento', async () => {
    const urls = [];
    const gh = {
      getWorkflow: async () => ({ state: 'active', created_at: '2026-01-01T00:00:00Z' }),
      listRuns: async (file, q) => (urls.push({ file, ...q }), []),
      listJobs: async () => [],
    };
    await checkWorkflows({ env: {}, github: gh, now: NOW });
    for (const u of urls) assert.equal(u.branch, 'main');
    assert.equal(urls.find((u) => u.file === 'ci.yml').event, 'push');
    assert.equal(urls.find((u) => u.file === 'seguridad.yml').event, 'schedule');
    assert.ok(WORKFLOW_RULES.length === urls.length);
  });
});

// ---------------------------------------------------------------------------
// Contenido no confiable en el issue (repo público): menciones, markdown, enlaces
// ---------------------------------------------------------------------------
describe('cuerpo del issue', () => {
  const evil = [
    '@apivasa', '@org/team', '[x](https://evil.example)', '![i](https://evil.example/p.png)',
    '<img src=x onerror=alert(1)>', '`code`', 'pages\n## Título', '#1', 'pages,@x', 'a'.repeat(41),
    'PAGES', 'pages ', 'ci_main', 'supabase%0a@x',
  ];

  test('parseFailures solo deja [a-z0-9-]{1,40}', () => {
    const got = parseFailures([...evil, 'pages', 'ci-main'].join(','));
    assert.deepEqual(got, ['pages', 'pages', 'pages', 'ci-main']);
    for (const f of got) assert.match(f, /^[a-z0-9-]{1,40}$/);
  });

  test('issueBody sin menciones, enlaces, imágenes ni HTML aunque FAILURES y RUN_URL sean hostiles', () => {
    const body = issueBody({ failures: parseFailures(evil.join(',')), runUrl: 'https://evil.example/@x', now: NOW });
    assert.doesNotMatch(body, /@|<|\]\(|!\[|evil/);
    assert.match(body, /\(enlace no disponible\)/);
  });

  test('RUN_URL: solo https://github.com/<o>/<r>/actions/runs/<n> exacto', () => {
    for (const bad of [
      'javascript:alert(1)', 'https://github.com.evil.example/o/r/actions/runs/1', 'https://github.com/o/r/actions/runs/1 @x',
      'https://github.com/o/r/actions/runs/1\n@x', 'https://github.com/o/r/actions/runs/1?x=@y', 'http://github.com/o/r/actions/runs/1',
      'https://github.com/o/r/actions/runs/1/../../../settings',
    ]) assert.match(issueBody({ failures: ['pages'], runUrl: bad, now: NOW }), /\(enlace no disponible\)/, bad);
    assert.match(issueBody({ failures: ['pages'], runUrl: 'https://github.com/apivasa/practica_agente/actions/runs/123', now: NOW }), /runs\/123$/m);
  });

  test('issue.js: con FAILURES hostil, el cuerpo enviado a la API queda saneado y sin token', async () => {
    const sent = [];
    const fetchImpl = async (u, o) => {
      sent.push({ u: String(u), o });
      if (String(u).includes('/issues?')) return { status: 200, ok: true, json: async () => [] };
      return { status: 201, ok: true, json: async () => ({ number: 7 }) };
    };
    const logs = [];
    await issueMain({
      env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'apivasa/practica_agente', FAILURES: '@apivasa,[x](https://evil.example),pages', RUN_URL: 'https://evil.example' },
      fetchImpl, now: NOW, log: (s) => logs.push(s),
    });
    const created = sent.find((s) => s.u.endsWith('/issues') && s.o.method === 'POST');
    const payload = JSON.parse(created.o.body);
    assert.deepEqual(payload.labels, ['salud']);
    assert.doesNotMatch(payload.title + payload.body, /@|evil|\]\(/);
    for (const s of sent) assert.ok(!(s.o.body ?? '').includes(TOKEN));
    assert.ok(!logs.join('\n').includes(TOKEN));
  });

  test('sin duplicados: con un issue abierto se comenta, no se crea otro (no es vector de spam)', async () => {
    const calls = [];
    const gh = {
      findOpenIssue: async () => ({ number: 3 }),
      commentIssue: async (n, b) => calls.push(['comment', n, b]),
      ensureLabel: async () => calls.push(['label']),
      createIssue: async () => calls.push(['create']),
    };
    const out = await upsertHealthIssue({ github: gh, failures: ['pages'], runUrl: '', now: NOW });
    assert.equal(out.action, 'commented');
    assert.deepEqual(calls.map((c) => c[0]), ['comment']);
  });
});
