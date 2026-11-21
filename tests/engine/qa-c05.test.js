// C-05 — QA del contenido del correo (engine/alert-email.js, funciones puras).
// Diseño: el correo repite la alerta de la bandeja del destinatario ("las mismas alertas de
// su bandeja"); criterio: "el correo no expone datos de otras unidades". Además, los nombres
// que vienen de la BD se tratan como texto (escape HTML, sin inyección de cabeceras).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAlertEmail,
  escapeHtml,
  plainText,
  safeHttpsUrl,
  alertKindLabel,
  ALERT_KIND_LABELS,
  EMAIL_SUBJECT_MAX,
  EMAIL_MESSAGE_MAX,
} from '../../engine/index.js';
import { ALERT_KIND_LABELS as FRONT_LABELS } from '../../src/lib/dashboard.js';

const alert = (payload = {}, extra = {}) => ({
  kind: 'pace_behind',
  sent_at: '2027-02-10T11:23:45.000Z',
  payload: { unit_name: 'Unidad Beta', message: 'Unidad Beta: VULN va atrasado frente al ritmo esperado.', severity: 'normal', ...payload },
  ...extra,
});

describe('C-05 QA motor: el correo repite la alerta de la bandeja', () => {
  test('mismas etiquetas de tipo que la bandeja (una sola fuente)', () => {
    assert.equal(FRONT_LABELS, ALERT_KIND_LABELS);
    for (const k of ['color_change', 'pace_behind', 'critical_intake', 'exception_expired']) {
      assert.ok(alertKindLabel(k).length > 0 && alertKindLabel(k) !== k, k);
    }
  });

  test('el mensaje de la bandeja aparece tal cual en texto y en HTML', () => {
    const m = formatAlertEmail(alert());
    assert.ok(m.text.startsWith('Unidad Beta: VULN va atrasado frente al ritmo esperado.'));
    assert.ok(m.html.includes('Unidad Beta: VULN va atrasado frente al ritmo esperado.'));
    assert.equal(m.subject, 'Atraso frente al ritmo - Unidad Beta');
    assert.ok(m.text.includes('Fecha: 2027-02-10 11:23 UTC'));
  });

  test('alerta grave: asunto marcado como urgente', () => {
    assert.ok(formatAlertEmail(alert({ severity: 'high' })).subject.startsWith('[Urgente] '));
    assert.ok(!formatAlertEmail(alert({ severity: 'normal' })).subject.includes('Urgente'));
  });

  test('solo usa unit_name y message: otros campos del payload no salen en el correo', () => {
    const m = formatAlertEmail(
      alert({
        indicator_changes: [{ unit: 'Unidad Alfa', note: 'SECRETO-ALFA' }],
        restrictions: ['dato-interno-x'],
        reason: 'razon-interna-y',
        other_unit_name: 'Unidad Gamma',
      }),
    );
    const all = `${m.subject}${m.text}${m.html}`;
    for (const s of ['Unidad Alfa', 'SECRETO-ALFA', 'dato-interno-x', 'razon-interna-y', 'Unidad Gamma']) {
      assert.ok(!all.includes(s), s);
    }
  });

  test('payload ausente, nulo o arreglo: correo válido con la etiqueta del tipo', () => {
    for (const payload of [undefined, null, [], 'texto']) {
      const m = formatAlertEmail({ kind: 'color_change', payload });
      assert.equal(m.subject, 'Cambio de color');
      assert.ok(m.text.startsWith('Cambio de color'));
    }
    const nothing = formatAlertEmail(undefined);
    assert.equal(nothing.subject, '—');
  });

  test('tipo desconocido: se muestra como texto y escapado', () => {
    const m = formatAlertEmail({ kind: '<b>raro</b>', payload: {} });
    assert.ok(m.html.includes('&lt;b&gt;raro&lt;/b&gt;'));
    assert.ok(!m.html.includes('<b>raro'));
    assert.equal(alertKindLabel('__proto__'), '__proto__');
    assert.equal(alertKindLabel(null), '—');
  });
});

describe('C-05 QA motor: escape y saneamiento', () => {
  test('escapeHtml cubre & < > " \'', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(5), '5');
  });

  test('nombre de unidad con HTML: escapado en HTML, intacto como texto en el asunto', () => {
    const name = '<a href="javascript:x">Unidad</a> & Cía';
    const m = formatAlertEmail(alert({ unit_name: name, message: `${name}: rojo` }));
    assert.ok(!m.html.includes('<a href="javascript'));
    assert.ok(m.html.includes('&lt;a href=&quot;javascript:x&quot;&gt;Unidad&lt;/a&gt; &amp; Cía'));
    assert.ok(m.subject.endsWith(name));
  });

  test('CR/LF, tabuladores y marcas bidi se eliminan (asunto de una línea)', () => {
    const m = formatAlertEmail(alert({ unit_name: 'Uni\r\ndad\u202e X\tY\u2028Z' }));
    assert.ok(!/[\r\n\t\u202e\u2028]/.test(m.subject));
    assert.ok(m.subject.endsWith('Uni dad X Y Z'));
  });

  test('plainText: no cadena → vacío; recorta con elipsis justo en el máximo', () => {
    assert.equal(plainText({}, 10), '');
    assert.equal(plainText(null, 10), '');
    assert.equal(plainText(12, 10), '12');
    assert.equal(plainText('abcdefghij', 10), 'abcdefghij');
    const cut = plainText('abcdefghijk', 10);
    assert.equal(cut.length, 10);
    assert.ok(cut.endsWith('…'));
  });

  test('asunto y mensaje respetan sus topes', () => {
    const m = formatAlertEmail(alert({ severity: 'high', unit_name: 'U'.repeat(500), message: 'm'.repeat(5000) }));
    assert.ok(m.subject.length <= EMAIL_SUBJECT_MAX);
    assert.ok(m.text.split('\n')[0].length <= EMAIL_MESSAGE_MAX);
  });

  test('fecha mal formada no se muestra', () => {
    assert.ok(!formatAlertEmail(alert({}, { sent_at: 'ayer' })).text.includes('Fecha'));
    assert.ok(!formatAlertEmail(alert({}, { sent_at: 123 })).text.includes('Fecha'));
  });
});

describe('C-05 QA motor: enlace a la app', () => {
  test('solo https y sin credenciales', () => {
    assert.equal(safeHttpsUrl('https://org.github.io/app/'), 'https://org.github.io/app/');
    for (const bad of ['http://org.github.io/', 'javascript:alert(1)', 'https://u:p@org.github.io/', 'no es url', '', '  ', null, 7]) {
      assert.equal(safeHttpsUrl(bad), null, String(bad));
    }
  });

  test('con URL válida el correo enlaza; con inválida no hay enlace', () => {
    const ok = formatAlertEmail(alert(), { appUrl: 'https://org.github.io/app/?a=1&b="2"' });
    assert.ok(ok.text.includes('Ver en la app: https://org.github.io/app/'));
    assert.match(ok.html, /<a href="https:\/\/org\.github\.io\/app\/\?a=1&amp;b=/);
    assert.ok(!/href="[^"]*"[^>]*"/.test(ok.html.match(/<a [^>]*>/)[0].replace(/^<a href="[^"]*"/, '')));
    const bad = formatAlertEmail(alert(), { appUrl: 'javascript:alert(1)' });
    assert.ok(!bad.html.includes('<a '));
    assert.ok(!bad.text.includes('Ver en la app'));
  });
});
