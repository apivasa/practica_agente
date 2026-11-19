// Menú para elegir rol cuando el usuario tiene más de uno.
import { el } from './dom.js';
import { ROLE_LABELS, ROLE_ROUTES } from '../lib/route-logic.js';

export function renderChooser({ roles }) {
  return el('section', { class: 'card', 'aria-labelledby': 'chooser-title' }, [
    el('h2', { id: 'chooser-title', text: 'Elige con qué rol entrar' }),
    el('ul', { class: 'role-list' }, roles.map((role) =>
      el('li', {}, [el('a', { href: `#${ROLE_ROUTES[role]}`, class: 'btn', text: ROLE_LABELS[role] })]),
    )),
  ]);
}
