// V-04 — Pruebas QA independientes (tester). Cada caso traza a una frase del ítem V-04
// (docs/plan-maestro.md), de su criterio de aceptación o del runbook (docs/operacion.md).
//   [A] "workflow salud.yml (cada 6 h) que verifica la web y Supabase"
//   [B] "falla visible si algo cae"
//   [C] "alerta si un workflow programado no corrió o falló"
//   [D] Criterio: "Simulación de caída en CI produce alerta"
//   [E] Criterio: "runbook en docs/operacion.md"
//   [F] CLAUDE.md §4: solo clave publicable en el front/workflows que no la necesitan
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_RULES, assessWorkflow, checkAvailability, checkHttp, upsertHealthIssue } from '../../scripts/health/lib.js';
import { main as checkMain } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SALUD = read('.github/workflows/salud.yml');
const CI = read('.github/workflows/ci.yml');
const HEALTH_SH = read('scripts/ci/health.sh');
const RUNBOOK = read('docs/operacion.md');

const NOW = new Date('2027-03-10T15:00:00Z');
const PUB = 'sb_publishable_ficticia_qa';
const SUPA = 'https://qa-ficticio.supabase.co';
const PAGES = 'https://apivasa.github.io/practica_agente/';
// Compara por origen exacto (esquema + host + puerto), no por subcadena de la URL.
const isSupabase = (u) => new URL(String(u)).origin === new URL(SUPA).origin;
const noSleep = async () => {};
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;

/** Bloque de un job de salud.yml (texto entre su cabecera y el siguiente job). */
function jobBlock(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, `falta el job ${name}`);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[\w-]+:\s*$/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}

function wfRun({ ageMs = 2 * H, conclusion = 'success', event = 'schedule', durMs = 60_000, status = 'completed', id = 1 } = {}) {
  const created = ago(ageMs);
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created,
    run_started_at: created,
    updated_at: new Date(Date.parse(created) + durMs).toISOString(),
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}
const OLD_WF = { state: 'active', created_at: '2026-01-01T00:00:00Z' };
const rule = (check) => WORKFLOW_RULES.find((r) => r.check === check);

/** API de GitHub simulada para issue.js; registra las llamadas. */
function fakeGitHubFetch({ openIssues = [], labelStatus = 422, calls = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ path: u.pathname, method, body: init.body ? JSON.parse(init.body) : null });
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    const p = u.pathname.replace('/repos/apivasa/practica_agente/', '');
    if (p === 'issues' && method === 'GET') return json(200, openIssues);
    if (p === 'labels') return json(labelStatus, {});
    if (p === 'issues' && method === 'POST') return json(201, { number: 501 });
    if (/^issues\/\d+\/comments$/.test(p)) return json(201, {});
    throw new Error(`ruta no simulada: ${method} ${p}`);
  };
}

describe('[A][B][C] salud.yml: programación y cableado de la alerta', () => {
  test('[A] cron cada 6 h y lanzamiento manual (el runbook lo relanza a mano)', () => {
    const m = SALUD.match(/^\s*-\s*cron:\s*'([^']+)'/m);
    assert.ok(m, 'falta cron');
    const [min, hour, dom, mon, dow] = m[1].trim().split(/\s+/);
    assert.match(min, /^\d{1,2}$/);
    assert.equal(hour, '*/6');
    assert.deepEqual([dom, mon, dow], ['*', '*', '*']);
    assert.match(SALUD, /^\s{2}workflow_dispatch:/m);
  });

  test('[B] el job check ejecuta check.js y expone failures desde ese paso', () => {
    const check = jobBlock(SALUD, 'check');
    assert.match(check, /id:\s*health\b/);
    assert.match(check, /run:\s*node scripts\/health\/check\.js\s*$/m, 'check debe correr el script completo, sin --only');
    assert.match(check, /failures:\s*\$\{\{\s*steps\.health\.outputs\.failures\s*\}\}/);
  });

  test('[B] el job alert corre cuando check falla y recibe la lista de fallos', () => {
    const alert = jobBlock(SALUD, 'alert');
    assert.match(alert, /needs:\s*check\b/);
    assert.match(alert, /if:\s*always\(\)\s*&&\s*needs\.check\.result\s*==\s*'failure'/);
    assert.match(alert, /FAILURES:\s*\$\{\{\s*needs\.check\.outputs\.failures\s*\}\}/);
    assert.match(alert, /run:\s*node scripts\/health\/issue\.js/);
  });

  test('[C] check puede leer Actions y solo alert puede escribir issues', () => {
    const check = jobBlock(SALUD, 'check');
    const alert = jobBlock(SALUD, 'alert');
    assert.match(check, /actions:\s*read/);
    assert.doesNotMatch(check, /issues:\s*write/);
    assert.match(alert, /issues:\s*write/);
  });

  test('[C] vigila los cinco workflows programados o críticos y esos archivos existen', () => {
    // C-06 (H-ARQ-C05-01, ADR 0017 punto 10): correo-alertas.yml entra en la vigilancia.
    const files = WORKFLOW_RULES.map((r) => r.file).sort();
    assert.deepEqual(files, ['ci.yml', 'correo-alertas.yml', 'evaluacion-mensual.yml', 'ritmo-diario.yml', 'seguridad.yml']);
    for (const f of files) assert.doesNotThrow(() => read(`.github/workflows/${f}`), `${f} no existe`);
  });

  test('[F] salud.yml no recibe la clave secreta ni claves legadas', () => {
    assert.doesNotMatch(SALUD, /SUPABASE_SECRET_KEY|service_role|SUPABASE_ANON_KEY/);
  });
});

describe('[D] simulación de caída en CI', () => {
  test('ci.yml corre scripts/ci/health.sh en el job de integración, tras levantar Supabase local', () => {
    const lines = jobBlock(CI, 'integration').split('\n');
    const start = lines.findIndex((l) => /supabase start/.test(l));
    const step = lines.findIndex((l) => /run:\s*bash scripts\/ci\/health\.sh/.test(l));
    const stop = lines.findIndex((l) => /supabase stop/.test(l));
    assert.ok(start >= 0 && step > start && stop > step, 'health.sh debe ir entre supabase start y supabase stop');
    assert.doesNotMatch(lines.slice(step - 3, step + 3).join('\n'), /continue-on-error/);
  });

  test('health.sh exige código 1 y failures=pages ante la caída, y solo apunta a Supabase local', () => {
    assert.match(HEALTH_SH, /set -euo pipefail/);
    assert.match(HEALTH_SH, /PAGES_URL=http:\/\/127\.0\.0\.1:9\//);
    assert.match(HEALTH_SH, /"\$code" -ne 1/);
    assert.match(HEALTH_SH, /grep -qx 'failures=pages'/);
    assert.match(HEALTH_SH, /http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*\) ;;/);
  });

  test('caída real (sin mocks): web local arriba → ok; puerto cerrado → código 1, failures=pages y alerta con issue', async () => {
    const server = createServer((_q, s) => s.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const dir = mkdtempSync(join(tmpdir(), 'qa-v04-'));
    try {
      const base = { EVALUATION_ENABLED: 'true', SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_PUBLISHABLE_KEY: PUB, HEALTH_PLAIN_LOG: '1' };
      const up = await checkMain({ argv: ['--only=availability'], env: { ...base, PAGES_URL: `http://127.0.0.1:${port}/`, GITHUB_OUTPUT: join(dir, 'up') }, fetchImpl: fetch, log: () => {}, sleep: noSleep });
      assert.equal(up.code, 0);
      assert.equal(readFileSync(join(dir, 'up'), 'utf8'), 'failures=\n');

      const logs = [];
      const down = await checkMain({ argv: ['--only=availability'], env: { ...base, PAGES_URL: 'http://127.0.0.1:9/', GITHUB_OUTPUT: join(dir, 'down') }, fetchImpl: fetch, log: (s) => logs.push(s), sleep: noSleep });
      assert.equal(down.code, 1, 'la caída debe dejar el run en rojo');
      const out = readFileSync(join(dir, 'down'), 'utf8');
      assert.equal(out, 'failures=pages\n');
      assert.ok(!logs.join('\n').includes(PUB), 'el log no debe incluir la clave');

      // El valor que el job check publica es el que recibe el job alert.
      const calls = [];
      const res = await issueMain({
        env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'apivasa/practica_agente', FAILURES: out.trim().split('=')[1], RUN_URL: 'https://github.com/apivasa/practica_agente/actions/runs/123' },
        fetchImpl: fakeGitHubFetch({ calls }),
        now: NOW,
        log: () => {},
      });
      assert.equal(res.action, 'created');
      const created = calls.find((c) => c.method === 'POST' && c.path.endsWith('/issues'));
      assert.deepEqual(created.body.labels, ['salud']);
      assert.match(created.body.body, /- `pages`/);
      assert.match(created.body.body, /actions\/runs\/123/);
    } finally {
      server.close();
    }
  });

  test('Pages y Supabase caídos a la vez: ambos en failures y en el issue', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-v04-'));
    const env = { EVALUATION_ENABLED: 'true', PAGES_URL: 'http://127.0.0.1:9/', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_PUBLISHABLE_KEY: PUB, GITHUB_OUTPUT: join(dir, 'o'), GITHUB_STEP_SUMMARY: join(dir, 's') };
    const r = await checkMain({ argv: ['--only=availability'], env, fetchImpl: fetch, log: () => {}, sleep: noSleep });
    assert.equal(r.code, 1);
    assert.equal(readFileSync(join(dir, 'o'), 'utf8'), 'failures=pages,supabase\n');
    const summary = readFileSync(join(dir, 's'), 'utf8');
    assert.match(summary, /\| pages \| fail \|/);
    assert.match(summary, /\| supabase \| fail \|/);
    assert.ok(!summary.includes(PUB));
  });
});

describe('[B] disponibilidad: bordes', () => {
  const env = { EVALUATION_ENABLED: 'true', PAGES_URL: PAGES, SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: PUB };

  test('Supabase pausado (540) en los dos intentos: falla con el código HTTP', async () => {
    const f = async (url) => ({ status: isSupabase(url) ? 540 : 200 });
    const [, s] = await checkAvailability({ env, fetchImpl: f, sleep: noSleep });
    assert.deepEqual([s.check, s.status], ['supabase', 'fail']);
    assert.match(s.detail, /HTTP 540 tras 2 intentos/);
  });

  test('un fallo transitorio que se recupera en el segundo intento no alerta', async () => {
    let n = 0;
    const f = async () => ({ status: ++n === 1 ? 503 : 200 });
    const r = await checkHttp({ check: 'pages', url: PAGES, fetchImpl: f, sleep: noSleep });
    assert.equal(r.status, 'ok');
  });

  test('timeout: el detalle dice timeout, sin la URL', async () => {
    const f = async () => {
      throw Object.assign(new Error(`timeout ${PAGES}`), { name: 'TimeoutError' });
    };
    const r = await checkHttp({ check: 'pages', url: PAGES, fetchImpl: f, sleep: noSleep });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /timeout/);
    assert.doesNotMatch(r.detail, /https?:\/\/|apivasa\.github\.io/);
  });

  test('PAGES_URL http hacia un host externo se rechaza (falla visible, no se consulta)', async () => {
    let called = false;
    const f = async () => {
      called = true;
      return { status: 200 };
    };
    const [p] = await checkAvailability({ env: { ...env, PAGES_URL: 'http://example.com/', SUPABASE_URL: '' }, fetchImpl: f, sleep: noSleep });
    assert.equal(p.status, 'fail');
    assert.equal(called, false);
  });

  test('HTTP 301 a 200 cuenta como arriba (redirect seguido); 404 falla', async () => {
    const r404 = await checkHttp({ check: 'pages', url: PAGES, fetchImpl: async () => ({ status: 404 }), sleep: noSleep, attempts: 1 });
    assert.equal(r404.status, 'fail');
    let init;
    await checkHttp({ check: 'pages', url: PAGES, fetchImpl: async (_u, i) => ((init = i), { status: 200 }), sleep: noSleep });
    assert.equal(init.redirect, 'follow');
  });
});

describe('[C] workflows programados: umbrales exactos', () => {
  const prod = { now: NOW, productionEnabled: true };

  test('ritmo-diario: 30 h exactas ok; 30 h + 1 min falla', () => {
    const r = rule('ritmo-diario');
    assert.equal(assessWorkflow(r, { ...prod, workflow: OLD_WF, runs: [wfRun({ ageMs: 30 * H })] }).status, 'ok');
    const late = assessWorkflow(r, { ...prod, workflow: OLD_WF, runs: [wfRun({ ageMs: 30 * H + 60_000 })] });
    assert.equal(late.status, 'fail');
    assert.match(late.detail, /máximo 30 h/);
  });

  test('ritmo-diario: duración de 5 min exactos ok; 5 min + 1 s falla', () => {
    const r = rule('ritmo-diario');
    assert.equal(assessWorkflow(r, { ...prod, workflow: OLD_WF, runs: [wfRun({ durMs: 5 * 60_000 })] }).status, 'ok');
    assert.equal(assessWorkflow(r, { ...prod, workflow: OLD_WF, runs: [wfRun({ durMs: 5 * 60_000 + 1000 })] }).status, 'fail');
  });

  test('ritmo-diario nunca corrió (workflow antiguo) con producción activa: falla', () => {
    const r = assessWorkflow(rule('ritmo-diario'), { ...prod, workflow: OLD_WF, runs: [] });
    assert.equal(r.status, 'fail');
  });

  test('un run en curso no cuenta como ejecución: se juzga el último completado', () => {
    const runs = [wfRun({ ageMs: H, status: 'in_progress', id: 2 }), wfRun({ ageMs: 40 * H, id: 1 })];
    assert.equal(assessWorkflow(rule('ritmo-diario'), { ...prod, workflow: OLD_WF, runs }).status, 'fail');
  });

  test('se juzga el run más reciente aunque la API los devuelva desordenados', () => {
    const runs = [wfRun({ ageMs: 20 * H, id: 1 }), wfRun({ ageMs: 2 * H, conclusion: 'failure', id: 2 })];
    const r = assessWorkflow(rule('ritmo-diario'), { ...prod, workflow: OLD_WF, runs });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /failure/);
  });

  test('seguridad-semanal: 8 días exactos ok; 8 días + 1 h falla; run en failure falla; disabled_manually falla', () => {
    const r = rule('seguridad-semanal');
    const off = { now: NOW, productionEnabled: false };
    assert.equal(assessWorkflow(r, { ...off, workflow: OLD_WF, runs: [wfRun({ ageMs: 192 * H })] }).status, 'ok');
    assert.equal(assessWorkflow(r, { ...off, workflow: OLD_WF, runs: [wfRun({ ageMs: 193 * H })] }).status, 'fail');
    assert.equal(assessWorkflow(r, { ...off, workflow: OLD_WF, runs: [wfRun({ conclusion: 'failure' })] }).status, 'fail');
    const dis = assessWorkflow(r, { ...off, workflow: { ...OLD_WF, state: 'disabled_manually' }, runs: [wfRun()] });
    assert.equal(dis.status, 'fail');
    assert.match(dis.detail, /disabled_manually/);
  });

  test('seguridad-semanal: un run manual reciente no tapa la falta del cron (filtro por schedule)', () => {
    const r = assessWorkflow(rule('seguridad-semanal'), { now: NOW, productionEnabled: false, workflow: OLD_WF, runs: [wfRun({ ageMs: H, event: 'workflow_dispatch' })] });
    assert.equal(r.status, 'fail');
  });

  test('ci-main: el último push en failure falla aunque haya un success anterior', () => {
    const runs = [wfRun({ ageMs: 3 * H, event: 'push', id: 1 }), wfRun({ ageMs: H, event: 'push', conclusion: 'failure', id: 2 })];
    assert.equal(assessWorkflow(rule('ci-main'), { now: NOW, productionEnabled: false, workflow: OLD_WF, runs }).status, 'fail');
  });

  test('evaluacion-mensual: el día se decide en Guayaquil (UTC-5)', () => {
    const r = rule('evaluacion-mensual');
    // 2027-03-02T04:59Z = 1 de marzo 23:59 en Guayaquil → día 1, aún no se exige.
    const d1 = assessWorkflow(r, { now: new Date('2027-03-02T04:59:00Z'), productionEnabled: true, workflow: OLD_WF, runs: [] });
    assert.equal(d1.status, 'ok');
    // 05:00Z = 2 de marzo 00:00 en Guayaquil → sin run de marzo, falla.
    const d2 = assessWorkflow(r, { now: new Date('2027-03-02T05:00:00Z'), productionEnabled: true, workflow: OLD_WF, runs: [] });
    assert.equal(d2.status, 'fail');
    // Un run del 1 de marzo 03:00Z es 28 de febrero en Guayaquil: no cuenta para marzo.
    const feb = { ...wfRun(), created_at: '2027-03-01T03:00:00Z', run_started_at: '2027-03-01T03:00:00Z', updated_at: '2027-03-01T03:01:00Z' };
    assert.equal(assessWorkflow(r, { now: new Date('2027-03-05T15:00:00Z'), productionEnabled: true, workflow: OLD_WF, runs: [feb] }).status, 'fail');
  });
});

describe('[B] alerta: issue sin duplicados', () => {
  test('la etiqueta ya existe (422): igual se crea el issue', async () => {
    const calls = [];
    const r = await issueMain({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'apivasa/practica_agente', FAILURES: 'ritmo-diario', RUN_URL: '' }, fetchImpl: fakeGitHubFetch({ labelStatus: 422, calls }), now: NOW, log: () => {} });
    assert.equal(r.action, 'created');
    assert.equal(r.number, 501);
  });

  test('un PR abierto con la etiqueta salud no cuenta como issue abierto', async () => {
    const calls = [];
    const r = await issueMain({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'apivasa/practica_agente', FAILURES: 'pages', RUN_URL: '' }, fetchImpl: fakeGitHubFetch({ openIssues: [{ number: 9, pull_request: {} }], calls }), now: NOW, log: () => {} });
    assert.equal(r.action, 'created');
  });

  test('dos alertas seguidas: la segunda comenta el issue abierto', async () => {
    const created = [];
    const comments = [];
    let open = null;
    const github = {
      findOpenIssue: async () => open,
      ensureLabel: async () => null,
      createIssue: async (title, body, labels) => {
        created.push({ title, labels });
        open = { number: 42 };
        return open;
      },
      commentIssue: async (n, body) => comments.push({ n, body }),
    };
    await upsertHealthIssue({ github, failures: ['supabase'], runUrl: '', now: NOW });
    await upsertHealthIssue({ github, failures: ['supabase'], runUrl: '', now: NOW });
    assert.equal(created.length, 1);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].n, 42);
  });

  test('error de la API al crear el issue: issue.js rechaza (el job alert queda en rojo)', async () => {
    const f = async (url, init = {}) => {
      const p = new URL(url).pathname;
      if (p.endsWith('/issues') && (init.method ?? 'GET') === 'GET') return { status: 200, ok: true, json: async () => [] };
      if (p.endsWith('/labels')) return { status: 201, ok: true, json: async () => ({}) };
      return { status: 403, ok: false, json: async () => ({}) };
    };
    await assert.rejects(issueMain({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'apivasa/practica_agente', FAILURES: 'pages', RUN_URL: '' }, fetchImpl: f, now: NOW, log: () => {} }), /HTTP 403/);
  });
});

describe('[E] runbook en docs/operacion.md', () => {
  const section = RUNBOOK.split(/^## Salud del sistema/m)[1]?.split(/^## /m)[0] ?? '';

  test('existe la sección «Salud del sistema» con su tabla de checks', () => {
    assert.ok(section.length > 0, 'falta la sección');
    assert.match(section, /\| Check \|/);
  });

  test('hay instrucciones para cada check que puede alertar', () => {
    const checks = ['pages', 'supabase', 'actions-api', ...WORKFLOW_RULES.map((r) => r.check)];
    const howTo = section.split(/^### Qué hacer ante cada alerta/m)[1] ?? '';
    assert.ok(howTo.length > 0, 'falta «Qué hacer ante cada alerta»');
    for (const c of checks) assert.ok(howTo.includes(`\`${c}\``), `el runbook no dice qué hacer ante ${c}`);
  });

  test('explica cómo relanzar salud.yml y cuándo cerrar el issue', () => {
    assert.match(section, /salud\.yml\/dispatches/);
    assert.match(section, /cerrar el issue/i);
  });
});
