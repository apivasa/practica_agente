// Piezas comunes de los tableros V-01/V-02/V-03 (DOM por textContent, sin estilos inline).
import { el } from './dom.js';
import { field, select } from './form.js';
import {
  colorKey, colorLabel, describeAlert, levelLabel, restrictionLabel, scopeLabel,
} from '../lib/dashboard.js';

/** Insignia de color: texto + clase (el color nunca va solo, por accesibilidad). */
export function colorBadge(color) {
  return el('span', { class: `badge badge-${colorKey(color)}`, text: colorLabel(color) });
}

/** Nivel de escalada con sus restricciones efectivas. */
export function escalationInfo(evaluation) {
  if (!evaluation) return el('span', { class: 'muted', text: 'Sin evaluación' });
  const restrictions = Array.isArray(evaluation.restrictions) ? evaluation.restrictions : [];
  return el('div', { class: 'escalation' }, [
    el('strong', { text: levelLabel(evaluation.escalation_level) }),
    restrictions.length
      ? el('ul', { class: 'restrictions' }, restrictions.map((r) => el('li', { text: restrictionLabel(r) })))
      : null,
  ]);
}

/**
 * V-08: candado vigente hoy (resultado de unitLockToday): nivel, restricciones efectivas,
 * "Inicio autorizado: REF" y en qué cierre se basa. Todo por textContent.
 */
export function lockTodayInfo(lock) {
  if (!lock || !lock.ok) return el('span', { class: 'muted', text: lock?.reason ?? 'Sin cierre vigente' });
  const restrictions = Array.isArray(lock.restrictions) ? lock.restrictions : [];
  const authorized = Array.isArray(lock.authorizedLabels) ? lock.authorizedLabels : [];
  return el('div', { class: 'escalation lock-today' }, [
    el('strong', { text: levelLabel(lock.level) }),
    restrictions.length
      ? el('ul', { class: 'restrictions' }, restrictions.map((r) => el('li', { text: restrictionLabel(r) })))
      : null,
    ...authorized.map((t) => el('p', { class: 'authorized-start', text: t })),
    el('p', { class: 'small muted', text: lock.basis ?? '' }),
  ]);
}

/** Selector de mes; llama a onChange(mes) al cambiar. */
export function monthPicker(id, months, value, onChange) {
  const sel = select(id, months.map((m) => ({ value: m, label: m })), value);
  sel.addEventListener('change', () => onChange(sel.value));
  return field('Mes', sel);
}

/**
 * Lista de excepciones vigentes.
 * @param {any[]} list ya filtrada con activeExceptions
 * @param {(unitId: string) => string} unitName
 */
export function exceptionsTable(list, unitName, caption = 'Excepciones vigentes') {
  if (!list.length) return el('p', { class: 'muted', text: 'No hay excepciones vigentes.' });
  return el('table', { class: 'data-table' }, [
    el('caption', { text: caption }),
    el('thead', {}, [el('tr', {}, ['Unidad', 'Alcance', 'Motivo', 'Ref. de change', 'Vence'].map((h) => el('th', { scope: 'col', text: h })))]),
    el('tbody', {}, list.map((e) => el('tr', {}, [
      el('td', { text: unitName(e.unit_id) }),
      el('td', { text: scopeLabel(e.scope) }),
      el('td', { text: e.reason ?? '' }),
      el('td', { text: e.change_ref ?? '—' }),
      el('td', { text: e.expires_on }),
    ]))),
  ]);
}

/**
 * Bandeja de alertas propias con "Marcar como leída".
 * @param {{ alerts: any[], onRead: (id: string) => Promise<void> }} opts
 */
export function alertsInbox({ alerts, onRead, title = 'Mis alertas' }) {
  const items = alerts.map(describeAlert);
  const unread = items.filter((a) => !a.read).length;
  const list = items.length
    ? el('ul', { class: 'alerts-list' }, items.map((a) => {
      const btn = a.read ? null : el('button', {
        type: 'button', class: 'btn', text: 'Marcar como leída',
        'aria-label': `Marcar como leída: ${a.kind} del ${a.sentAt}`,
      });
      if (btn) {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try { await onRead(a.id); } finally { btn.disabled = false; }
        });
      }
      return el('li', { class: `alert-item${a.read ? ' is-read' : ''}${a.high ? ' is-high' : ''}`, 'data-alert-id': a.id }, [
        el('p', { class: 'alert-head' }, [
          el('strong', { text: a.kind }),
          el('span', { class: 'muted', text: ` · ${a.sentAt}${a.read ? ' · leída' : ''}` }),
        ]),
        el('p', { class: 'alert-message', text: a.message }),
        btn,
      ]);
    }))
    : el('p', { class: 'muted', text: 'No tienes alertas.' });
  return el('section', { class: 'alerts-inbox', 'aria-labelledby': 'alerts-title' }, [
    el('h3', { id: 'alerts-title', text: title }),
    el('p', { class: 'alerts-count', text: `Sin leer: ${unread}` }),
    list,
  ]);
}
