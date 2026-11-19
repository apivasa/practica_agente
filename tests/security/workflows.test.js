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

test('dependabot.yml cubre github-actions y npm', () => {
  const p = join(ROOT, '.github', 'dependabot.yml');
  assert.ok(existsSync(p), 'falta .github/dependabot.yml');
  const text = readFileSync(p, 'utf8');
  assert.match(text, /package-ecosystem:\s*github-actions/);
  assert.match(text, /package-ecosystem:\s*npm/);
});
