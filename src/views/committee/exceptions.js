// C-02 · Comité: excepciones de todas las unidades (vigentes, vencidas,
// revocadas), formulario para aprobar y botón para revocar las propias.
// Todo el texto va por textContent (el()).
import { el } from '../dom.js';
import { EXCEPTION_MAX_DAYS, maxExpiry, validateExceptionDraft } from '../../../engine/exceptions.js';
import { SCOPE_LABELS, guayaquilDate, toListItems } from '../../lib/exceptions-logic.js';
import { listExceptions, createException, revokeException } from '../../data/exceptions.js';
import { listUnits } from '../../data/units.js';

/**
 * Pantalla autocontenida: carga sus datos y se repinta tras aprobar o revocar.
 * @param {{ session?: { user?: { id?: string } } | null }} ctx
 */
export function renderCommitteeExceptions(ctx = {}) {
  const userId = ctx.session?.user?.id ?? null;
  const today = guayaquilDate();
  const notice = el('div', { class: 'form-error', role: 'alert', 'aria-live': 'assertive' });
  const formBox = el('div', { class: 'form-box' });
  const listBox = el('div', { class: 'list-box', 'aria-busy': 'true' }, [el('p', { text: 'Cargando excepciones…' })]);

  async function reload() {
    listBox.setAttribute('aria-busy', 'true');
    try {
      const [rows, units] = await Promise.all([listExceptions(), listUnits()]);
      notice.replaceChildren();
      if (!formBox.firstChild) formBox.append(renderForm({ units, today, onCreate }));
      listBox.replaceChildren(renderList({ items: toListItems(rows, { today, userId, units }), onRevoke }));
    } catch (err) {
      listBox.replaceChildren();
      notice.replaceChildren(el('p', { text: err.message }));
    } finally {
      listBox.removeAttribute('aria-busy');
    }
  }
  async function onCreate(value) {
    await createException(value);
    formBox.replaceChildren();
    await reload();
  }
  async function onRevoke(id) {
    await revokeException(id);
    await reload();
  }

  reload();
  return el('section', { class: 'card', 'aria-labelledby': 'exc-title', 'data-view': 'committee-exceptions' }, [
    el('h2', { id: 'exc-title', text: 'Excepciones del comité' }),
    notice,
    formBox,
    listBox,
  ]);
}

function field(id, label, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    control,
    hint && el('p', { class: 'hint', id: `${id}-hint`, text: hint }),
    el('p', { class: 'form-error field-error', id: `${id}-error`, 'aria-live': 'polite' }),
  ]);
}

function renderForm({ units, today, onCreate }) {
  const limit = maxExpiry(today);
  const unit = el('select', { id: 'exc-unit', name: 'unit', required: true, 'aria-describedby': 'exc-unit-error' }, [
    el('option', { value: '', text: 'Elige una unidad' }),
    ...units.map((u) => el('option', { value: u.id, text: u.name })),
  ]);
  const scope = el('select', { id: 'exc-scope', name: 'scope', 'aria-describedby': 'exc-scope-error' },
    Object.entries(SCOPE_LABELS).map(([value, text]) => el('option', { value, text })));
  const reason = el('textarea', { id: 'exc-reason', name: 'reason', rows: '3', maxlength: '2000', required: true, 'aria-describedby': 'exc-reason-error' });
  const changeRef = el('input', { id: 'exc-change', name: 'change_ref', type: 'text', maxlength: '200', 'aria-describedby': 'exc-change-hint exc-change-error' });
  const expires = el('input', { id: 'exc-expires', name: 'expires_on', type: 'date', min: today, max: limit, required: true, 'aria-describedby': 'exc-expires-hint exc-expires-error' });
  const changeField = field('exc-change', 'Change autorizado', changeRef, 'Identificador del change que se permite iniciar (obligatorio para inicio puntual).');
  const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Aprobar excepción' });

  const syncScope = () => { changeField.hidden = scope.value !== 'change_start'; };
  scope.addEventListener('change', syncScope);
  syncScope();

  const form = el('form', { class: 'exc-form', novalidate: true, 'aria-labelledby': 'exc-form-title' }, [
    el('h3', { id: 'exc-form-title', text: 'Aprobar una excepción' }),
    field('exc-unit', 'Unidad', unit),
    field('exc-scope', 'Alcance', scope),
    changeField,
    field('exc-reason', 'Motivo', reason),
    field('exc-expires', 'Vence el', expires, `Hasta ${EXCEPTION_MAX_DAYS} días (máximo ${limit}). El día de vencimiento cuenta como vigente.`),
    status,
    submit,
  ]);

  const errorFields = { unitId: 'exc-unit', scope: 'exc-scope', reason: 'exc-reason', changeRef: 'exc-change', expiresOn: 'exc-expires' };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    for (const id of Object.values(errorFields)) form.querySelector(`#${id}-error`).textContent = '';
    const check = validateExceptionDraft(
      { unitId: unit.value, scope: scope.value, reason: reason.value, changeRef: changeRef.value, expiresOn: expires.value },
      today,
    );
    if (!check.ok) {
      for (const [key, msg] of Object.entries(check.errors)) {
        form.querySelector(`#${errorFields[key]}-error`).textContent = msg;
      }
      form.querySelector(`#${errorFields[Object.keys(check.errors)[0]]}`).focus();
      return;
    }
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      await onCreate(check.value);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      if (form.isConnected) {
        submit.disabled = false;
        form.removeAttribute('aria-busy');
      }
    }
  });
  return form;
}

function renderList({ items, onRevoke }) {
  if (items.length === 0) {
    return el('div', { class: 'exc-list' }, [
      el('h3', { text: 'Excepciones registradas' }),
      el('p', { class: 'placeholder', text: 'No hay excepciones registradas.' }),
    ]);
  }
  const rows = items.map((it) => {
    const actionMsg = el('span', { class: 'form-error', role: 'status', 'aria-live': 'polite' });
    let action;
    if (it.canRevoke) {
      action = el('button', {
        type: 'button', class: 'btn', text: 'Revocar',
        'aria-label': `Revocar excepción de ${it.unitName}`,
        onclick: async (event) => {
          const btn = event.currentTarget;
          btn.disabled = true;
          actionMsg.textContent = '';
          try {
            await onRevoke(it.id);
          } catch (err) {
            actionMsg.textContent = err.message;
            if (btn.isConnected) btn.disabled = false;
          }
        },
      });
    } else if (it.status === 'active') {
      action = el('span', { class: 'muted', text: 'Solo quien la aprobó puede revocarla' });
    }
    return el('tr', { 'data-id': it.id, 'data-status': it.status }, [
      el('td', { text: it.unitName }),
      el('td', { text: it.scopeLabel }),
      el('td', { text: it.changeRef ?? '—' }),
      el('td', { text: it.reason }),
      el('td', { text: it.expiresOn }),
      el('td', { text: it.revokedOn ? `${it.statusLabel} (${it.revokedOn})` : it.statusLabel }),
      el('td', { text: it.approvedByMe ? 'Tú' : 'Otro miembro del comité' }),
      el('td', {}, [action, actionMsg]),
    ]);
  });
  return el('div', { class: 'exc-list' }, [
    el('h3', { id: 'exc-list-title', text: 'Excepciones registradas' }),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data-table', 'aria-labelledby': 'exc-list-title' }, [
        el('thead', {}, [el('tr', {}, ['Unidad', 'Alcance', 'Change', 'Motivo', 'Vence', 'Estado', 'Aprobó', 'Acción']
          .map((h) => el('th', { scope: 'col', text: h })))]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}
