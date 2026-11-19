// Usuario autenticado sin filas en user_roles: no ve nada (ver H-F03-06).
import { el } from './dom.js';

export function renderNoRole({ message } = {}) {
  return el('section', { class: 'card', 'aria-labelledby': 'norole-title' }, [
    el('h2', { id: 'norole-title', text: 'Sin acceso' }),
    el('p', {
      role: message ? 'alert' : null,
      text: message ?? 'Tu cuenta no tiene un rol asignado. Pide a la gestora de KPIs que te asigne uno.',
    }),
  ]);
}
