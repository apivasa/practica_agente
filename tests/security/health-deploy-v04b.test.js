// V-04b — Seguridad del check `deploy-main` (scripts/health/lib.js, check.js, salud.yml).
// Categoría 5 (automatizaciones): campos de la API de Actions que el atacante puede
// controlar (display_title, head_branch, head_commit.message, actor) no llegan al log
// ni al issue; el token no se filtra; un `warn` no oculta un fallo; un run de otro
// evento (p. ej. pull_request desde un fork con rama "main") no puede alterar el check;
// permisos mínimos de salud.yml. Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_RULE, assessDeploy, checkDeploy, createGitHubClient, issueBody, parseFailures } from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';

const ROOT = new URL('../../', import.meta.url);
const NOW = new Date('2027-03-10T15:00:00Z');
const WF = { state: 'active', created_at: '2026-11-19T00:00:00Z' };
const TOKEN = 'ghs_SECRETO_DE_PRUEBA_V04b_0123456789';
const minAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const PAYLOAD = 'x\n::error::INYECTADO\n%0A::add-mask::y | ](javascript:alert(1)) <img src=x onerror=alert(1)>';

function run(id, { min = 120, status = 'completed', conclusion = 'success', event = 'push' } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: minAgo(min),
    run_started_at: minAgo(min),
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
    // Campos controlables por quien empuja o abre un PR:
    display_title: PAYLOAD,
    name: PAYLOAD,
    head_branch: `main${PAYLOAD}`,
    head_commit: { message: PAYLOAD, author: { name: PAYLOAD, email: 'x@example.invalid' } },
    actor: { login: PAYLOAD },
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

function fakeGitHub({ runs = [], status = 200, calls = [] } = {}) {
  const json = (s, body) => ({ ok: s >= 200 && s < 300, status: s, json: async () => body });
  return async (u, init = {}) => {
    calls.push({ url: String(u), headers: init.headers ?? {} });
    const p = new URL(u).pathname;
    if (status !== 200) return json(status, { message: `Bad credentials ${TOKEN}` });
    if (p.endsWith('/actions/workflows/deploy.yml')) return json(200, WF);
    if (p.endsWith('/actions/workflows/deploy.yml/runs')) return json(200, { workflow_runs: runs });
    if (/\/actions\/workflows\/[\w.-]+$/.test(p)) return json(200, WF);
    if (/\/actions\/workflows\/[\w.-]+\/runs$/.test(p)) return json(200, { workflow_runs: [] });
    throw new Error(`ruta no simulada: ${p}`);
  };
}
const client = (fetchImpl) => createGitHubClient({ token: TOKEN, repo: 'apivasa/practica_agente', fetchImpl });
const ENV = { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'apivasa/practica_agente', EVALUATION_ENABLED: 'false' };

async function runMain(runs, extraEnv = {}, status = 200) {
  const lines = [];
  const dir = mkdtempSync(join(tmpdir(), 'salud-v04b-'));
  const env = { ...ENV, GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'sum'), ...extraEnv };
  const out = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeGitHub({ runs, status }), now: NOW, log: (s) => lines.push(s) });
  return { ...out, lines, output: readFileSync(env.GITHUB_OUTPUT, 'utf8'), summary: readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') };
}

describe('cat. 5 · campos controlables de la API no llegan al log, summary ni issue', () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    test(`run ${conclusion} con display_title/head_branch/commit maliciosos`, async () => {
      const { lines, output, summary } = await runMain([run(7, { conclusion })]);
      const all = [...lines, output, summary].join('\n');
      assert.ok(!all.includes('INYECTADO'), 'un campo controlable llegó a la salida');
      assert.ok(!all.includes('javascript:'), 'markdown controlable en la salida');
      assert.ok(!all.includes('onerror'), 'HTML controlable en la salida');
      // Ninguna línea de log empieza con un comando de workflow que no sea el del propio tag.
      for (const l of lines.join('\n').split('\n')) {
        assert.ok(!/^::(?!error::FALLA |warning::(aviso|omitido) )/.test(l), `comando de workflow inesperado: ${l}`);
      }
      // $GITHUB_OUTPUT solo lleva `failures=` con nombres de check.
      assert.match(output, /^failures=[a-z0-9,-]*\n$/);
    });
  }

  test('el detalle de deploy-main solo usa status, conclusion y html_url (campos que genera GitHub)', () => {
    const r = assess([run(3, { conclusion: 'failure' }), run(2, { min: 300 })]);
    assert.equal(r.status, 'fail');
    assert.ok(!r.detail.includes('INYECTADO'));
    assert.match(r.detail, /^último despliegue terminó en failure — https:\/\/github\.com\/apivasa\/practica_agente\/actions\/runs\/3$/);
  });

  test('el cuerpo del issue no incluye el detalle: solo nombres de check validados y enlace al run validado', () => {
    assert.deepEqual(parseFailures(`deploy-main,${PAYLOAD},ci-main`), ['deploy-main', 'ci-main']);
    const body = issueBody({ failures: ['deploy-main'], runUrl: `https://github.com/a/b/actions/runs/1\n${PAYLOAD}`, now: NOW });
    assert.ok(!body.includes('INYECTADO'));
    assert.ok(body.includes('(enlace no disponible)'));
    assert.ok(body.includes('`deploy-main`'));
  });
});

describe('cat. 5 · runs de otros eventos no alteran el check (fork con rama "main")', () => {
  for (const event of ['pull_request', 'pull_request_target', 'workflow_run', 'repository_dispatch', 'schedule']) {
    test(`${event} en failure no provoca falso fallo y en success no tapa un fallo real`, () => {
      assert.equal(assess([run(9, { min: 10, conclusion: 'failure', event }), run(8)]).status, 'ok');
      assert.equal(assess([run(9, { min: 10, conclusion: 'success', event }), run(8, { conclusion: 'failure' })]).status, 'fail');
    });
  }
});

describe('cat. 5 · un aviso (warn) nunca oculta un fallo', () => {
  test('cancelado tras un fallo: falla', () => {
    const r = assess([run(3, { min: 30, conclusion: 'cancelled' }), run(2, { min: 60, conclusion: 'cancelled' }), run(1, { min: 90, conclusion: 'failure' })]);
    assert.equal(r.status, 'fail');
  });
  test('cancelado con otro run atascado > 60 min: falla', () => {
    const r = assess([run(4, { min: 90, status: 'in_progress' }), run(3, { min: 100, conclusion: 'cancelled' }), run(1, { min: 300 })]);
    assert.equal(r.status, 'fail');
  });
  test('skipped/neutral posteriores no tapan un failure', () => {
    assert.equal(assess([run(5, { min: 5, conclusion: 'skipped' }), run(4, { min: 6, conclusion: 'neutral' }), run(3, { conclusion: 'failure' })]).status, 'fail');
  });
  for (const conclusion of ['timed_out', 'startup_failure', 'action_required', 'stale', 'desconocido']) {
    test(`conclusión ${conclusion}: falla (lista de permitidos, no de prohibidos)`, () => {
      assert.equal(assess([run(3, { conclusion })]).status, 'fail');
    });
  }
  test('warn en deploy-main no rebaja el código de salida si otro check falla', async () => {
    // Error de API en el resto de workflows → fallan; deploy-main también, y el job sale 1.
    const { code } = await runMain([run(1, { conclusion: 'cancelled' })], {}, 500);
    assert.equal(code, 1);
  });
  test('warn solo: deploy-main fuera de failures pero el resultado queda visible como ::warning::', async () => {
    const { results, lines } = await runMain([run(1, { conclusion: 'cancelled' })]);
    assert.equal(results.find((r) => r.check === 'deploy-main').status, 'warn');
    assert.ok(lines.some((l) => l.startsWith('::warning::aviso deploy-main')));
  });
});

describe('cat. 5 · el token no se filtra', () => {
  test('error HTTP con el token en el cuerpo de respuesta: ni log, ni summary, ni output, ni detalle', async () => {
    const { lines, output, summary, results } = await runMain([], {}, 401);
    const all = [...lines, output, summary, JSON.stringify(results)].join('\n');
    assert.ok(!all.includes(TOKEN));
    assert.ok(!all.includes('Bad credentials'));
  });
  test('el token solo viaja en Authorization hacia api.github.com, nunca en la URL', async () => {
    const calls = [];
    await checkDeploy({ env: {}, github: client(fakeGitHub({ runs: [run(1)], calls })), now: NOW });
    assert.ok(calls.length > 0);
    for (const c of calls) {
      assert.equal(new URL(c.url).origin, 'https://api.github.com');
      assert.ok(!c.url.includes(TOKEN));
      assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    }
  });
  test('fetch que lanza con el token en el mensaje: el detalle se recorta y no rompe el job', async () => {
    const boom = async () => {
      throw new Error('x'.repeat(130) + TOKEN);
    };
    const [r] = await checkDeploy({ env: {}, github: client(boom), now: NOW });
    assert.equal(r.status, 'fail');
    assert.ok(!r.detail.includes(TOKEN));
  });
});

describe('cat. 5 · permisos de salud.yml', () => {
  const yml = readFileSync(new URL('.github/workflows/salud.yml', ROOT), 'utf8');
  const job = (name) => {
    const m = yml.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`));
    assert.ok(m, `job ${name} no encontrado`);
    return m[1];
  };
  const perms = (block) => {
    const m = block.match(/\n    permissions:\n((?:      [\w-]+: \w+\n)+)/);
    assert.ok(m, 'permissions explícitos en el job');
    return Object.fromEntries(m[1].trim().split('\n').map((l) => l.trim().split(/:\s*/)));
  };
  test('raíz: solo contents: read', () => {
    assert.match(yml, /\npermissions:\n  contents: read\n\n/);
  });
  test('check: contents y actions en lectura, nada más (deploy-main no requiere más)', () => {
    assert.deepEqual(perms(job('check')), { contents: 'read', actions: 'read' });
  });
  test('alert: contents read e issues write, nada más', () => {
    assert.deepEqual(perms(job('alert')), { contents: 'read', issues: 'write' });
  });
  test('sin pull_request_target ni clave secreta de Supabase; disparos solo schedule y dispatch', () => {
    assert.ok(!/pull_request/.test(yml));
    assert.ok(!/SUPABASE_SECRET_KEY|sb_secret_/.test(yml));
    assert.match(yml, /\non:\n  schedule:\n[\s\S]*?\n  workflow_dispatch:\n\npermissions:/);
  });
  test('el job alert no recibe detalles: solo FAILURES y RUN_URL además del token', () => {
    const envBlock = job('alert').match(/\n        env:\n((?:          .+\n)+)/)[1];
    const keys = envBlock.trim().split('\n').map((l) => l.trim().split(':')[0]).sort();
    assert.deepEqual(keys, ['FAILURES', 'GITHUB_TOKEN', 'RUN_URL']);
  });
});
