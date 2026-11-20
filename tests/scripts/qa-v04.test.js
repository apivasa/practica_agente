// V-04 — Pruebas QA (tester): bordes del workflow de salud que trazan al criterio
// "simulación de caída produce alerta" y al runbook de docs/operacion.md § Salud del sistema.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_RULES,
  assessWorkflow,
  checkWorkflows,
  createGitHubClient,
  guayaquilTime,
} from '../../scripts/health/lib.js';
import { main as checkMain } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const TOKEN = 'token-ficticio-qa';
const REPO = 'apivasa/practica_agente';
const rule = (check) => WORKFLOW_RULES.find((r) => r.check === check);
const OLD_WF = { state: 'active', created_at: '2026-01-01T00:00:00Z' };

function runAt(id, iso, { conclusion = 'success', event = 'schedule', minutes = 1, status = 'completed' } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: iso,
    run_started_at: iso,
    updated_at: new Date(Date.parse(iso) + minutes * 60_000).toISOString(),
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  };
}

/** fetch que responde a la API de GitHub según una función (path, method) → [status, body]. */
function ghFetch(route, calls = []) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ path: u.pathname.replace(`/repos/${REPO}/`, ''), search: u.search, method, body: init.body });
    const [status, body] = route(u.pathname.replace(`/repos/${REPO}/`, ''), method);
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
}

describe('API de Actions con error (runbook: "no se pudo consultar la API de Actions")', () => {
  for (const status of [500, 502, 503, 403]) {
    test(`HTTP ${status} en la API: cada check de workflow falla, sin filtrar el token, código 1`, async () => {
      const logs = [];
      const { code, results } = await checkMain({
        argv: ['--only=workflows'],
        env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO },
        fetchImpl: ghFetch(() => [status, { message: 'boom' }]),
        log: (s) => logs.push(s),
      });
      assert.equal(code, 1);
      assert.equal(results.length, WORKFLOW_RULES.length);
      for (const r of results) {
        assert.equal(r.status, 'fail');
        assert.match(r.detail, new RegExp(`no se pudo consultar la API de Actions .*HTTP ${status}`));
      }
      assert.ok(!logs.join('\n').includes(TOKEN));
    });
  }

  test('error solo en listRuns de un workflow: ese falla, los demás se evalúan', async () => {
    const now = new Date('2027-03-10T15:00:00Z');
    const fetchImpl = ghFetch((p) => {
      if (/^actions\/workflows\/[\w.-]+$/.test(p)) return [200, OLD_WF];
      if (p === 'actions/workflows/seguridad.yml/runs') return [503, {}];
      if (/\/runs$/.test(p)) return [200, { workflow_runs: [runAt(1, '2027-03-10T10:00:00Z', { event: 'push' })] }];
      return [404, {}];
    });
    const github = createGitHubClient({ token: TOKEN, repo: REPO, fetchImpl });
    const out = Object.fromEntries((await checkWorkflows({ env: {}, github, now })).map((r) => [r.check, r]));
    assert.equal(out['seguridad-semanal'].status, 'fail');
    assert.match(out['seguridad-semanal'].detail, /HTTP 503/);
    assert.equal(out['ci-main'].status, 'ok');
    assert.equal(out['ritmo-diario'].status, 'skip'); // producción inactiva
  });

  test('404 en el workflow: "no existe en la rama por defecto" (no se confunde con error de API)', async () => {
    const github = createGitHubClient({ token: TOKEN, repo: REPO, fetchImpl: ghFetch(() => [404, {}]) });
    const out = await checkWorkflows({ env: {}, github, now: new Date('2027-03-10T15:00:00Z') });
    for (const r of out) {
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /no existe en la rama por defecto/);
    }
  });

  test('GITHUB_REPOSITORY con formato inválido: el cliente se niega', () => {
    assert.throws(() => createGitHubClient({ token: TOKEN, repo: 'sin-barra', fetchImpl: async () => {} }), /GITHUB_REPOSITORY/);
  });
});

describe('workflow nunca corrido ("alerta si un workflow programado no corrió")', () => {
  const now = new Date('2027-03-10T15:00:00Z');
  test('ritmo-diario con producción activa, creado hace meses, sin runs: falla', () => {
    const r = assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: [], now, productionEnabled: true });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /sin runs completados/);
  });
  test('ritmo-diario solo con un run en curso (no completado), workflow viejo: falla', () => {
    const r = assessWorkflow(rule('ritmo-diario'), {
      workflow: OLD_WF, runs: [runAt(1, '2027-03-10T14:50:00Z', { status: 'in_progress' })], now, productionEnabled: true,
    });
    assert.equal(r.status, 'fail');
  });
  test('ritmo-diario creado hace 29 h sin runs: ok; hace 31 h: falla (umbral 30 h)', () => {
    const at = (h) => ({ state: 'active', created_at: new Date(now.getTime() - h * 3_600_000).toISOString() });
    assert.equal(assessWorkflow(rule('ritmo-diario'), { workflow: at(29), runs: [], now, productionEnabled: true }).status, 'ok');
    assert.equal(assessWorkflow(rule('ritmo-diario'), { workflow: at(31), runs: [], now, productionEnabled: true }).status, 'fail');
  });
  test('seguridad semanal nunca corrida por cron (solo runs push/dispatch), workflow viejo: falla', () => {
    // El cliente filtra por event=schedule; aunque llegaran otros eventos, la regla los descarta.
    const r = assessWorkflow(rule('seguridad-semanal'), {
      workflow: OLD_WF, runs: [runAt(1, '2027-03-10T10:00:00Z', { event: 'push' })], now, productionEnabled: false,
    });
    assert.equal(r.status, 'fail');
  });
  test('evaluacion-mensual sin runs nunca, día 10, workflow viejo: falla', () => {
    const r = assessWorkflow(rule('evaluacion-mensual'), { workflow: OLD_WF, runs: [], now, productionEnabled: true });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /2027-03/);
  });
  test('workflow deshabilitado manualmente (disabled_manually) también alerta', () => {
    const r = assessWorkflow(rule('ci-main'), { workflow: { state: 'disabled_manually' }, runs: [], now, productionEnabled: false });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /enable/);
  });
});

describe('umbrales exactos', () => {
  const now = new Date('2027-03-10T15:00:00Z');
  const hAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
  test('ritmo-diario: último run hace exactamente 30 h → ok; 30 h + 1 min → falla', () => {
    const ok = assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: [runAt(1, hAgo(30))], now, productionEnabled: true });
    assert.equal(ok.status, 'ok');
    const ko = assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: [runAt(1, hAgo(30 + 1 / 60))], now, productionEnabled: true });
    assert.equal(ko.status, 'fail');
  });
  test('duración exactamente 5 min → ok; 6 min → falla', () => {
    const r5 = assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: [runAt(1, hAgo(2), { minutes: 5 })], now, productionEnabled: true });
    assert.equal(r5.status, 'ok');
    const r6 = assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: [runAt(1, hAgo(2), { minutes: 6 })], now, productionEnabled: true });
    assert.equal(r6.status, 'fail');
  });
  test('seguridad: 8 días exactos → ok; 8 días + 1 h → falla', () => {
    assert.equal(assessWorkflow(rule('seguridad-semanal'), { workflow: OLD_WF, runs: [runAt(1, hAgo(192))], now, productionEnabled: false }).status, 'ok');
    assert.equal(assessWorkflow(rule('seguridad-semanal'), { workflow: OLD_WF, runs: [runAt(1, hAgo(193))], now, productionEnabled: false }).status, 'fail');
  });
  test('el run más reciente manda aunque la API no los devuelva ordenados', () => {
    const runs = [runAt(1, hAgo(40), { conclusion: 'failure' }), runAt(2, hAgo(3))];
    assert.equal(assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs, now, productionEnabled: true }).status, 'ok');
    const runs2 = [runAt(2, hAgo(40)), runAt(1, hAgo(3), { conclusion: 'failure' })];
    assert.equal(assessWorkflow(rule('ritmo-diario'), { workflow: OLD_WF, runs: runs2, now, productionEnabled: true }).status, 'fail');
  });
});

describe('cierre mensual con día 1 en fin de semana (cron 7 11 1 * * es por calendario)', () => {
  // 2027-05-01 es sábado; 2027-05-02, domingo.
  const R = rule('evaluacion-mensual');
  const aprilRun = runAt(1, '2027-04-01T11:07:00Z');
  test('sábado día 1 sin run de mayo: ok (aún puede estar en curso)', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [aprilRun], now: new Date('2027-05-01T20:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'ok');
  });
  test('domingo día 2 sin run de mayo: falla (el fin de semana no exime)', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [aprilRun], now: new Date('2027-05-02T15:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /2027-05/);
  });
  test('domingo día 2 con el run del sábado 1 en éxito: ok', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [runAt(2, '2027-05-01T11:07:00Z'), aprilRun], now: new Date('2027-05-02T15:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'ok');
  });
  test('día 2 en UTC pero aún día 1 en Guayaquil (04:00Z = 23:00 local): ok', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [aprilRun], now: new Date('2027-05-02T04:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'ok');
  });
  test('run a las 03:00Z del 1 de mayo cuenta como 30 de abril (Guayaquil), no como mayo', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [runAt(3, '2027-05-01T03:00:00Z')], now: new Date('2027-05-02T15:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'fail');
  });
  test('run de mayo en failure: falla', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [runAt(2, '2027-05-01T11:07:00Z', { conclusion: 'failure' })], now: new Date('2027-05-02T15:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'fail');
  });
  test('cierre mensual no exige antigüedad: run de hace 20 días en el mismo mes → ok', () => {
    const r = assessWorkflow(R, { workflow: OLD_WF, runs: [runAt(2, '2027-05-01T11:07:00Z')], now: new Date('2027-05-21T15:00:00Z'), productionEnabled: true });
    assert.equal(r.status, 'ok');
  });
});

describe('issue ya abierto → comenta en vez de duplicar', () => {
  const RUN = `https://github.com/${REPO}/actions/runs/999`;
  const now = new Date('2027-03-10T15:00:00Z');
  const route = (issues) => (p, m) => {
    if (p === 'issues' && m === 'GET') return [200, issues];
    if (/^issues\/\d+\/comments$/.test(p)) return [201, {}];
    if (p === 'labels') return [201, {}];
    if (p === 'issues' && m === 'POST') return [201, { number: 50 }];
    return [404, {}];
  };
  test('dos alertas seguidas con issue abierto: dos comentarios, ningún issue ni etiqueta nuevos', async () => {
    const calls = [];
    for (let i = 0; i < 2; i++) {
      const out = await issueMain({ env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, FAILURES: 'pages', RUN_URL: RUN }, fetchImpl: ghFetch(route([{ number: 12 }]), calls), now, log: () => {} });
      assert.deepEqual(out, { action: 'commented', number: 12 });
    }
    assert.equal(calls.filter((c) => c.method === 'POST' && c.path === 'issues/12/comments').length, 2);
    assert.ok(!calls.some((c) => c.method === 'POST' && (c.path === 'issues' || c.path === 'labels')));
    const get = calls.find((c) => c.method === 'GET' && c.path === 'issues');
    assert.match(get.search, /state=open/);
    assert.match(get.search, /labels=salud/);
    const comment = JSON.parse(calls.find((c) => c.path === 'issues/12/comments').body);
    assert.match(comment.body, /- `pages`/);
    assert.match(comment.body, /actions\/runs\/999/);
  });
  test('solo hay un PR con la etiqueta salud (no un issue): crea issue', async () => {
    const calls = [];
    const out = await issueMain({ env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, FAILURES: 'supabase', RUN_URL: RUN }, fetchImpl: ghFetch(route([{ number: 3, pull_request: {} }]), calls), now, log: () => {} });
    assert.deepEqual(out, { action: 'created', number: 50 });
    assert.ok(calls.some((c) => c.method === 'POST' && c.path === 'labels'));
  });
  test('etiqueta ya existe (422): se tolera y se crea el issue', async () => {
    const out = await issueMain({
      env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, FAILURES: 'pages', RUN_URL: RUN },
      fetchImpl: ghFetch((p, m) => (p === 'labels' ? [422, {}] : route([])(p, m))),
      now,
      log: () => {},
    });
    assert.equal(out.action, 'created');
  });
  test('403 al crear el issue (sin permiso issues:write): el script lanza (job alert en rojo, visible)', async () => {
    await assert.rejects(
      issueMain({
        env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, FAILURES: 'pages', RUN_URL: RUN },
        fetchImpl: ghFetch((p, m) => (p === 'issues' && m === 'POST' ? [403, {}] : route([])(p, m))),
        now,
        log: () => {},
      }),
      (e) => /HTTP 403/.test(e.message) && !e.message.includes(TOKEN),
    );
  });
  test('5xx al buscar issues abiertos: lanza en vez de crear un duplicado a ciegas', async () => {
    const calls = [];
    await assert.rejects(
      issueMain({ env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, FAILURES: 'pages', RUN_URL: RUN }, fetchImpl: ghFetch((p, m) => (p === 'issues' && m === 'GET' ? [502, {}] : route([])(p, m)), calls), now, log: () => {} }),
      /HTTP 502/,
    );
    assert.ok(!calls.some((c) => c.method === 'POST'));
  });
});

test('guayaquilTime: UTC-5 fijo, cruza el día hacia atrás', () => {
  assert.equal(guayaquilTime(new Date('2027-05-02T03:30:00Z')), '2027-05-01 22:30 (America/Guayaquil)');
});
