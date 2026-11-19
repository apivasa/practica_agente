// Marco de las pantallas de un rol: menú con las rutas del registro filtradas
// por rol (ADR 0009, decisión 4) y el contenido de la pantalla.
import { el } from './dom.js';
import { routesForRole } from '../lib/route-logic.js';

export function renderRoleShell({ role, path, content }) {
  const routes = routesForRole(role);
  const nav = routes.length > 1
    ? el('nav', { class: 'role-nav', 'aria-label': 'Pantallas del rol' }, [
      el('ul', {}, routes.map((r) => el('li', {}, [
        el('a', { href: `#${r.path}`, 'aria-current': r.path === path ? 'page' : null, text: r.label }),
      ]))),
    ])
    : null;
  return el('div', { class: 'role-shell' }, [nav, content]);
}
