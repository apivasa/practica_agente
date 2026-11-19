// Ayudantes de formulario accesibles (etiqueta asociada, errores anunciados).
import { el } from './dom.js';

let seq = 0;
/** id único para asociar etiqueta y control. */
export const uid = (prefix) => `${prefix}-${++seq}`;

/** Campo con etiqueta visible. `control` debe tener id. */
export function field(label, control, hint) {
  const hintNode = hint ? el('small', { class: 'hint', id: `${control.id}-hint`, text: hint }) : null;
  if (hintNode) control.setAttribute('aria-describedby', hintNode.id);
  return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control, hintNode]);
}

/** <select> con opciones [{ value, label }]. */
export function select(id, options, value) {
  const node = el('select', { id, name: id });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value ?? '')) opt.selected = true;
    node.append(opt);
  }
  return node;
}

/** Párrafos de estado: uno para avisos (status) y otro para errores (alert). */
export function messages() {
  const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const error = el('div', { class: 'form-error', role: 'alert', 'aria-live': 'assertive' });
  return {
    status,
    error,
    ok(text) { error.replaceChildren(); status.textContent = text; },
    fail(lines) {
      status.textContent = '';
      const list = [].concat(lines);
      error.replaceChildren(list.length === 1
        ? el('p', { text: list[0] })
        : el('ul', {}, list.map((l) => el('li', { text: l }))));
    },
    clear() { status.textContent = ''; error.replaceChildren(); },
  };
}

/** Tabla simple: headers [texto], rows [[nodo|texto]]. */
export function table(caption, headers, rows) {
  return el('table', { class: 'data-table' }, [
    el('caption', { text: caption }),
    el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { scope: 'col', text: h })))]),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, [typeof c === 'string' ? c : c ?? '']))))),
  ]);
}
