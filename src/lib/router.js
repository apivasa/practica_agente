// Router por hash con guardas por rol. La decisión la toma resolveRoute
// (lógica pura); aquí solo se lee/reescribe el hash y se pinta la vista.
import { parseHash, resolveRoute } from './route-logic.js';

/**
 * @param {object} opts
 * @param {() => { authenticated: boolean, roles: string[] }} opts.getState
 * @param {(view: string, path: string) => void} opts.render
 * @param {Window} [opts.win]
 */
export function createRouter({ getState, render, win = window }) {
  function resolveCurrent() {
    const requested = parseHash(win.location.hash);
    const route = resolveRoute(requested, getState());
    if (route.redirected || win.location.hash !== `#${route.path}`) {
      // replaceState no dispara hashchange ni deja la ruta prohibida en el historial.
      win.history.replaceState(null, '', `#${route.path}`);
    }
    render(route.view, route.path);
    return route;
  }

  function navigate(path) {
    if (win.location.hash === `#${path}`) {
      resolveCurrent();
    } else {
      win.location.hash = path; // dispara hashchange -> resolveCurrent
    }
  }

  function start() {
    win.addEventListener('hashchange', resolveCurrent);
    return resolveCurrent();
  }

  return { start, navigate, refresh: resolveCurrent };
}
