// S-01 — Pruebas de seguridad de GitHub Actions (categoría 5) y cadena de
// suministro (categoría 6). Análisis por líneas, sin dependencias de YAML.
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

// Workflows que hacen git push con GITHUB_TOKEN y por eso conservan las
// credenciales del checkout. Cualquier otro debe usar persist-credentials: false.
const PUSHING_WORKFLOWS = new Set(['lockfile.yml']);

const codeLines = (text) =>
  text.split('\n').map((l, i) => ({ n: i + 1, l })).filter(({ l }) => !/^\s*#/.test(l));

test('hay workflows que revisar', () => {
  assert.ok(workflows.length >= 3, 'se esperaban ci.yml, lockfile.yml y seguridad.yml');
  assert.ok(workflows.some((w) => w.name === 'seguridad.yml'), 'falta seguridad.yml');
});

for (const wf of workflows) {
  test(`${wf.name}: permissions explícito a nivel de workflow`, () => {
    assert.match(wf.text, /^permissions:/m, 'falta bloque permissions: de nivel superior');
    assert.doesNotMatch(wf.text, /^permissions:\s*write-all/m);
    const header = wf.text.split(/^jobs:/m)[0];
    assert.doesNotMatch(header, /:\s*write\b/, 'permisos de escritura a nivel de workflow');
  });

  test(`${wf.name}: acciones de terceros fijadas por SHA completo con comentario de versión`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      const m = l.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
      if (!m) continue;
      const ref = m[1];
      if (ref.startsWith('./')) continue;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${wf.name}:${n} sin SHA: ${ref}`);
      assert.match(m[2], /#\s*v\d+/, `${wf.name}:${n} falta comentario de versión`);
    }
  });

  test(`${wf.name}: sin pull_request_target ni workflow_run`, () => {
    assert.doesNotMatch(wf.text, /pull_request_target|workflow_run/);
  });

  test(`${wf.name}: sin inyección de expresiones de datos controlados por terceros`, () => {
    const risky = /\$\{\{\s*github\.(event\.(pull_request|issue|comment|review|head_commit|commits|pages)|head_ref)/;
    for (const { n, l } of codeLines(wf.text)) {
      assert.doesNotMatch(l, risky, `${wf.name}:${n} usa datos del evento en una expresión`);
    }
  });

  test(`${wf.name}: sin versiones "latest" de herramientas`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      assert.doesNotMatch(l, /version:\s*['"]?latest/, `${wf.name}:${n}`);
    }
  });

  test(`${wf.name}: npm ci / npm install sin scripts de ciclo de vida`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      for (const cmd of l.matchAll(/npm (ci|install)\b[^;&|]*/g)) {
        assert.match(cmd[0], /--ignore-scripts/, `${wf.name}:${n} ${cmd[0].trim()}`);
      }
    }
  });

  test(`${wf.name}: checkout sin credenciales persistidas salvo si hace push`, () => {
    const lines = wf.text.split('\n');
    lines.forEach((l, i) => {
      if (!/uses:\s*actions\/checkout@/.test(l)) return;
      const indent = l.search(/\S/);
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const s = lines[j];
        if (s.trim() === '') continue;
        if (s.search(/\S/) <= indent) break;
        block.push(s);
      }
      const persisted = !block.some((s) => /persist-credentials:\s*false/.test(s));
      if (PUSHING_WORKFLOWS.has(wf.name)) return;
      assert.equal(persisted, false, `${wf.name}:${i + 1} checkout sin persist-credentials: false`);
    });
  });

  // C-03/C-04: inputs de workflow_dispatch / workflow_call solo llegan a la shell por env.
  test(`${wf.name}: inputs nunca interpolados en run:, solo mapeados a env`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      if (!/\$\{\{[^}]*\b(inputs\.|github\.event\.inputs)/.test(l)) continue;
      assert.match(l, /^\s+[A-Z_][A-Z0-9_]*:\s*\$\{\{\s*(inputs|github\.event\.inputs)\.[\w-]+\s*\}\}\s*$/, `${wf.name}:${n} interpola un input fuera de env`);
    }
  });

  // C-03/C-04: la clave secreta del backend solo en workflows que no ejecutan código de un PR.
  test(`${wf.name}: SUPABASE_SECRET_KEY solo con disparadores schedule / workflow_dispatch`, () => {
    if (!/secrets\.SUPABASE_SECRET_KEY/.test(wf.text)) return;
    const header = wf.text.split(/^jobs:/m)[0];
    assert.doesNotMatch(header, /^\s{2}(push|pull_request|pull_request_target|workflow_run|workflow_call|issue_comment|repository_dispatch):/m);
    assert.match(wf.text, /vars\.EVALUATION_ENABLED|environment:/, 'falta guarda de activación de producción');
  });

  // C-03 (H-C03-01): las fechas futuras solo se permiten en la integración local
  // (scripts/ci/integration.sh); ningún workflow define EVALUATE_ALLOW_FUTURE.
  test(`${wf.name}: no habilita EVALUATE_ALLOW_FUTURE`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      assert.doesNotMatch(l, /EVALUATE_ALLOW_FUTURE/, `${wf.name}:${n}`);
    }
  });

  test(`${wf.name}: no imprime secretos`, () => {
    for (const { n, l } of codeLines(wf.text)) {
      assert.doesNotMatch(l, /(echo|printf|cat)\b.*\$\{\{\s*secrets\./, `${wf.name}:${n}`);
      assert.doesNotMatch(l, /set\s+-x/, `${wf.name}:${n} set -x puede volcar secretos`);
    }
  });
}

test('lockfile.yml: solo ramas de trabajo y escritura a nivel de job', () => {
  const wf = workflows.find((w) => w.name === 'lockfile.yml');
  assert.ok(wf);
  const [header] = wf.text.split(/^jobs:/m);
  assert.match(header, /^permissions:\s*\{\}\s*$/m, 'permissions de workflow debe ser {}');
  const branches = header.match(/branches:\s*\[([^\]]*)\]/);
  assert.ok(branches, 'on.push.branches no declarado');
  assert.doesNotMatch(branches[1], /\bmain\b/);
  assert.doesNotMatch(branches[1], /'\*\*'|"\*\*"/);
  assert.match(wf.text, /if:\s*github\.ref_name != 'main'/);
});

test('lockfile.yml: relanza CI y Seguridad sobre el commit del bot', () => {
  // Los commits con GITHUB_TOKEN no disparan push: sin relanzar, el commit del
  // lockfile quedaría sin npm audit ni pruebas de seguridad.
  const wf = workflows.find((w) => w.name === 'lockfile.yml').text;
  for (const name of ['ci.yml', 'seguridad.yml']) {
    assert.match(wf, new RegExp(`gh workflow run ${name.replace('.', '\\.')} --ref "\\$\\{GITHUB_REF_NAME\\}"`), `no relanza ${name}`);
  }
  const target = workflows.find((w) => w.name === 'seguridad.yml').text;
  assert.match(target, /^\s{2}workflow_dispatch:/m, 'seguridad.yml debe aceptar workflow_dispatch');
});

test('seguridad.yml: security-events: write solo en el job de CodeQL', () => {
  const wf = workflows.find((w) => w.name === 'seguridad.yml');
  const occurrences = wf.text.match(/security-events:\s*write/g) ?? [];
  assert.equal(occurrences.length, 1);
  const jobs = wf.text.split(/^ {2}(?=[\w-]+:\s*$)/m);
  const codeql = jobs.find((j) => j.startsWith('codeql:'));
  assert.ok(codeql && /security-events:\s*write/.test(codeql));
});

test('seguridad.yml: corre en PR, push a main, semanal y manual, con las cinco herramientas', () => {
  const wf = workflows.find((w) => w.name === 'seguridad.yml').text;
  assert.match(wf, /^\s{2}pull_request:/m);
  assert.match(wf, /branches:\s*\[main\b/);
  assert.match(wf, /cron:\s*'17 6 \* \* 1'/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /gitleaks git\b/);
  assert.match(wf, /fetch-depth:\s*0/);
  // Escaneo del historial de la rama, no de todas las ramas remotas.
  assert.match(wf, /--log-opts="--full-history HEAD"/);
  assert.match(wf, /sha256sum -c/);
  assert.match(wf, /semgrep scan[\s\S]*--error/);
  assert.match(wf, /npm audit --omit=dev --audit-level=high/);
  assert.match(wf, /codeql-action\/analyze@/);
  assert.match(wf, /node --test 'tests\/security\/\*\.test\.js'/);
  // Ningún paso de seguridad se neutraliza para que pase (CLAUDE.md §4).
  assert.doesNotMatch(wf, /continue-on-error:\s*true/);
  assert.doesNotMatch(wf, /(gitleaks|semgrep|npm audit --omit)[^\n]*\|\|\s*true/);
});

test('seguridad.yml: job pentest-api contra Supabase local, obligatorio y sin omitir', () => {
  const wf = workflows.find((w) => w.name === 'seguridad.yml').text;
  const jobs = wf.split(/^ {2}(?=[\w-]+:\s*$)/m);
  const job = jobs.find((j) => j.startsWith('pentest-api:'));
  assert.ok(job, 'falta el job pentest-api (S-03)');
  assert.match(job, /supabase\/setup-cli@[0-9a-f]{40}/);
  assert.match(job, /version:\s*\d+\.\d+\.\d+/);
  assert.match(job, /supabase start\b/);
  assert.match(job, /supabase status -o env/);
  // Sin PENTEST_REQUIRE las pruebas de API se omitirían: sería un control desactivado.
  assert.match(job, /PENTEST_REQUIRE:\s*'1'/);
  assert.match(job, /node --test --test-concurrency=1 'tests\/security\/api\/\*\.test\.js'/);
  assert.doesNotMatch(job, /secrets\./, 'el pentest local no necesita secretos del repo');
  assert.doesNotMatch(job, /permissions:[\s\S]*write/);
});

test('dependabot.yml cubre github-actions y npm', () => {
  const p = join(ROOT, '.github', 'dependabot.yml');
  assert.ok(existsSync(p), 'falta .github/dependabot.yml');
  const text = readFileSync(p, 'utf8');
  assert.match(text, /package-ecosystem:\s*github-actions/);
  assert.match(text, /package-ecosystem:\s*npm/);
});

// C-03 + V-01..V-03: EVALUATE_ALLOW_FUTURE=1 solo lo exportan los dos scripts de CI que
// corren contra Supabase local (integración y semilla de evaluaciones para e2e). Cualquier
// otro script que lo defina es un hallazgo.
const ALLOW_FUTURE_SCRIPTS = ['scripts/ci/integration.sh', 'scripts/ci/seed-evaluations.sh'];
const walkFiles = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
  const p = `${dir}/${d.name}`;
  return d.isDirectory() ? walkFiles(p) : [p];
});

test('EVALUATE_ALLOW_FUTURE solo en los scripts de CI contra Supabase local', () => {
  const setters = walkFiles('scripts').filter((p) => {
    const text = readFileSync(join(ROOT, p), 'utf8');
    return text.split('\n').some((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)
      && /EVALUATE_ALLOW_FUTURE\s*=|EVALUATE_ALLOW_FUTURE:\s*\S/.test(l));
  });
  assert.deepEqual(setters.sort(), [...ALLOW_FUTURE_SCRIPTS].sort());
  for (const p of ALLOW_FUTURE_SCRIPTS) {
    const sh = readFileSync(join(ROOT, p), 'utf8');
    assert.match(sh, /^export EVALUATE_ALLOW_FUTURE=1$/m, p);
    assert.match(sh, /^set -euo pipefail$/m, `${p}: sin modo estricto`);
    assert.doesNotMatch(sh, /^set -[a-z]*x|set -o xtrace/m, `${p}: xtrace imprimiría la clave`);
    // Guarda local antes de exportar nada.
    const guard = sh.search(/http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*\) ;;/);
    assert.ok(guard > 0, `${p}: falta la guarda de Supabase local`);
    assert.ok(guard < sh.indexOf('export EVALUATE_ALLOW_FUTURE'), `${p}: exporta antes de la guarda`);
    // La clave secreta local se enmascara y nunca se imprime ni pasa a GITHUB_ENV/OUTPUT.
    assert.match(sh, /echo "::add-mask::\$\{SUPABASE_SECRET_KEY\}"/, `${p}: sin add-mask`);
    for (const { l } of codeLines(sh)) {
      if (/add-mask/.test(l)) continue;
      assert.doesNotMatch(l, /(echo|printf)[^\n]*\$\{?SUPABASE_SECRET_KEY/, `${p}: imprime la clave: ${l}`);
      assert.doesNotMatch(l, /GITHUB_ENV|GITHUB_OUTPUT/, `${p}: exporta a pasos siguientes: ${l}`);
    }
  }
  // El script además rechaza la variable si SUPABASE_URL no es local (allowFutureFromEnv).
  const dates = readFileSync(join(ROOT, 'scripts', 'lib', 'dates.js'), 'utf8');
  assert.match(dates, /EVALUATE_ALLOW_FUTURE solo se admite contra Supabase local/);
});

test('ci.yml: la semilla de evaluaciones corre en el job local y su clave no llega al build', () => {
  const ci = workflows.find((w) => w.name === 'ci.yml').text;
  const jobs = ci.split(/^ {2}(?=[\w-]+:\s*$)/m);
  const job = jobs.find((j) => /bash scripts\/ci\/seed-evaluations\.sh/.test(j));
  assert.ok(job, 'ningún job corre seed-evaluations.sh');
  assert.match(job, /supabase start\b/, 'seed-evaluations.sh fuera del job con Supabase local');
  assert.doesNotMatch(job, /secrets\./, 'el job e2e no necesita secretos del repo');
  assert.doesNotMatch(job, /SECRET_KEY[^\n]*>>\s*"?\$GITHUB_ENV/, 'la clave secreta pasa a GITHUB_ENV');
  assert.doesNotMatch(job, /^\s+permissions:[\s\S]*?write/m, 'permisos de escritura en el job e2e');
});

test('seguridad.yml: job dast (S-04) con ZAP fijado por digest, e2e de seguridad y fallo por riesgo alto', () => {
  const wf = workflows.find((w) => w.name === 'seguridad.yml').text;
  const jobs = wf.split(/^ {2}(?=[\w-]+:\s*$)/m);
  const dast = jobs.find((j) => j.startsWith('dast:'));
  assert.ok(dast, 'falta el job dast');
  assert.match(dast, /ZAP_IMAGE:\s*zaproxy\/zap-stable@sha256:[0-9a-f]{64}\s*$/m, 'imagen ZAP sin digest');
  assert.doesNotMatch(dast, /zap-stable:(latest|stable|\d)/, 'imagen ZAP por etiqueta móvil');
  assert.match(dast, /supabase start/);
  assert.match(dast, /sb_publishable_\*/);
  assert.doesNotMatch(dast, /SECRET_KEY/, 'el build del DAST no debe ver la clave secreta');
  assert.match(dast, /npx playwright test e2e\/security/);
  assert.match(dast, /zap-baseline\.py -t http:\/\/127\.0\.0\.1:4173\/practica_agente\//, 'ZAP solo contra el front local');
  assert.match(dast, /-c rules\.tsv/);
  assert.match(dast, /\[ "\$status" -eq 0 \]/, 'el código de salida de ZAP debe comprobarse');
  assert.match(dast, /riskcode \| tonumber\) >= 3/);
  assert.doesNotMatch(dast, /\|\|\s*true/);
  // Ninguna regla de ZAP se ignora para que el job pase.
  const rules = readFileSync(join(ROOT, '.zap', 'rules.tsv'), 'utf8');
  assert.doesNotMatch(rules, /\tIGNORE\t/);
  for (const id of ['10003', '10017', '10062', '90003']) assert.match(rules, new RegExp(`^${id}\\tFAIL\\t`, 'm'));
});
