// C-05: formato del correo de una alerta (engine/alert-email.js).
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
} from '../../engine/index.js';
import { ALERT_KIND_LABELS as FRONT_LABELS } from '../../src/lib/dashboard.js';

const alert = (over = {}) => ({
  id: 'a1',
  kind: 'color_change',
  sent_at: '2027-02-01T11:07:30.123Z',
  payload: { unit_name: 'Unidad Alfa', message: 'Unidad Alfa: el color pasó de verde a rojo en 2027-01.', severity: 'high' },
  ...over,
});

describe('formatAlertEmail', () => {
  test('asunto, texto y HTML con los datos de la alerta', () => {
    const m = formatAlertEmail(alert(), { appUrl: 'https://example.test/app/' });
    assert.equal(m.subject, '[Urgente] Cambio de color - Unidad Alfa');
    assert.match(m.text, /^Unidad Alfa: el color pasó de verde a rojo en 2027-01\./);
    assert.match(m.text, /Tipo: Cambio de color/);
    assert.match(m.text, /Unidad: Unidad Alfa/);
    assert.match(m.text, /Fecha: 2027-02-01 11:07 UTC/);
    assert.match(m.text, /Ver en la app: https:\/\/example\.test\/app\//);
    assert.match(m.html, /<a href="https:\/\/example\.test\/app\/">Ver en la app<\/a>/);
    assert.match(m.html, /<strong>Urgente\.<\/strong>/);
  });

  test('nombres con HTML se escapan (sin etiquetas inyectadas)', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert("x")</script>&';
    const m = formatAlertEmail(alert({ payload: { unit_name: evil, message: `${evil}: cambió`, severity: 'normal' } }));
    assert.doesNotMatch(m.html, /<img|<script|onerror=alert\(1\)>/i);
    assert.match(m.html, /&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;/);
    assert.match(m.html, /&amp;/);
    // El texto plano conserva el texto tal cual (no es HTML).
    assert.match(m.text, /<img src=x/);
  });

  test('saltos de línea y controles no llegan al asunto (sin inyección de cabeceras)', () => {
    const m = formatAlertEmail(alert({ payload: { unit_name: 'A\r\nBcc: x@y.test', message: 'hola' } }));
    assert.doesNotMatch(m.subject, /[\r\n]/);
    assert.equal(m.subject, 'Cambio de color - A Bcc: x@y.test');
  });

  test('asunto recortado y mensaje por defecto si falta', () => {
    const m = formatAlertEmail(alert({ kind: 'pace_behind', payload: { unit_name: 'U'.repeat(500) } }));
    assert.ok(m.subject.length <= EMAIL_SUBJECT_MAX);
    assert.match(m.text, /^Atraso frente al ritmo\n/);
  });

  test('payload ausente o no objeto no rompe', () => {
    for (const payload of [null, undefined, 'x', [1], 42]) {
      const m = formatAlertEmail({ kind: 'exception_expired', payload });
      assert.equal(m.subject, 'Vencimiento de excepción');
      assert.doesNotMatch(m.text, /Unidad:|Fecha:/);
    }
    assert.equal(formatAlertEmail(null).subject, '—');
  });

  test('appUrl que no es https no se enlaza', () => {
    for (const appUrl of ['javascript:alert(1)', 'http://example.test/', 'https://u:p@example.test/', 'nada', '']) {
      const m = formatAlertEmail(alert(), { appUrl });
      assert.doesNotMatch(m.html, /<a /);
      assert.doesNotMatch(m.text, /Ver en la app/);
    }
  });

  test('el payload solo aporta tipo, unidad, mensaje y fecha (otros campos no salen)', () => {
    const m = formatAlertEmail(alert({ payload: { unit_name: 'U1', message: 'm', other_unit: 'SECRETA', recipient_email: 'z@z.test' } }));
    assert.doesNotMatch(m.text + m.html, /SECRETA|z@z\.test/);
  });
});

describe('utilidades', () => {
  test('escapeHtml', () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
  });
  test('plainText', () => {
    assert.equal(plainText('  a\n\tb\u202e c ', 50), 'a b c');
    assert.equal(plainText({}, 10), '');
    assert.equal(plainText('abcdefghij', 5), 'abcd…');
  });
  test('safeHttpsUrl', () => {
    assert.equal(safeHttpsUrl('https://x.test'), 'https://x.test/');
    assert.equal(safeHttpsUrl('ftp://x.test'), null);
    assert.equal(safeHttpsUrl(5), null);
  });
  test('alertKindLabel y una sola fuente de etiquetas con el front', () => {
    assert.equal(alertKindLabel('critical_intake'), 'Ingreso de P0/P1');
    assert.equal(alertKindLabel('toString'), 'toString');
    assert.equal(FRONT_LABELS, ALERT_KIND_LABELS);
  });
});
