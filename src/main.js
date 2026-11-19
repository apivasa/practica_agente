// Punto de entrada del front: arma el marco de la app, carga sesión y roles,
// y delega en el router por hash qué vista mostrar.
// S-04: primero el anti-framing; si la página está enmarcada, elimina #app y la app no arranca.
import './security/anti-framing.js';
import './styles.css';
import { createRouter } from './lib/router.js';
import { distinctRoles, findRoute, ROLE_LABELS, CHOOSER_PATH, LOGIN_PATH } from './lib/route-logic.js';
import { getSupabase } from './lib/supabase.js';
import { getRoles, getSession, onSessionChange, signIn, signOut, MSG_NOT_CONFIGURED } from './lib/session.js';
import { el } from './views/dom.js';
import { renderLogin } from './views/login.js';
import { renderRoleHome } from './views/role-home.js';
import { renderChooser } from './views/chooser.js';
import { renderNoRole } from './views/no-role.js';
import { renderRoleShell } from './views/role-shell.js';
import { renderIndicators } from './views/kpi_manager/indicators.js';
import { renderCommitments } from './views/custodian/commitments.js';
import { renderMeasurements } from './views/custodian/measurements.js';

export const APP_TITLE = 'App de control de capacidad RUN';

const state = { session: null, rows: [], rolesError: null };

function viewState() {
  return { authenticated: Boolean(state.session), roles: distinctRoles(state.rows) };
}

async function loadSession(session) {
  state.session = session ?? null;
  state.rows = [];
  state.rolesError = null;
  if (!state.session) return;
  try {
    state.rows = await getRoles(state.session.user.id);
  } catch (err) {
    state.rolesError = err.message;
  }
}

function renderHeader(header, roles) {
  const children = [el('h1', { text: APP_TITLE })];
  if (state.session) {
    const nav = el('nav', { class: 'session-bar', 'aria-label': 'Sesión' }, [
      el('span', { class: 'user-email', text: state.session.user.email ?? '' }),
      roles.length > 1 && el('a', { href: `#${CHOOSER_PATH}`, class: 'btn btn-link', text: 'Cambiar de rol' }),
      el('button', { type: 'button', class: 'btn', text: 'Cerrar sesión', onclick: handleLogout }),
    ]);
    children.push(nav);
  }
  header.replaceChildren(...children);
}

let router;
let header;
let content;

const home = (ctx) => renderRoleHome({ role: ctx.role, rows: ctx.rows });

// Vista registrada (ROUTES[].view) -> función que la pinta (ADR 0009).
const VIEWS = Object.freeze({
  login: () => renderLogin({ onSubmit: handleLogin, notice: getSupabase() ? null : MSG_NOT_CONFIGURED }),
  chooser: (ctx) => renderChooser({ roles: ctx.roles }),
  'no-role': () => renderNoRole({ message: state.rolesError }),
  kpi_manager: home,
  custodian: home,
  committee: home,
  unit_leader: home,
  'kpi-indicators': (ctx) => renderIndicators(ctx),
  'custodian-commitments': (ctx) => renderCommitments(ctx),
  'custodian-measurements': (ctx) => renderMeasurements(ctx),
});

function render(view, path) {
  const { roles } = viewState();
  renderHeader(header, roles);
  const route = findRoute(path);
  const ctx = { role: route?.role ?? null, path, rows: state.rows, roles, session: state.session };
  const paint = Object.prototype.hasOwnProperty.call(VIEWS, view) ? VIEWS[view] : VIEWS['no-role'];
  let node = paint(ctx);
  if (route) node = renderRoleShell({ role: route.role, path, content: node });
  content.replaceChildren(node);
  const title = route && route.view !== route.role ? `${route.label} · ${ROLE_LABELS[route.role]}` : ROLE_LABELS[view];
  document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
}

async function handleLogin(email, password) {
  const result = await signIn(email, password);
  if (!result.ok) return result;
  await loadSession(result.session);
  router.navigate('/'); // el router decide la ruta propia del rol
  return result;
}

async function handleLogout() {
  await signOut();
  await loadSession(null);
  router.navigate(LOGIN_PATH);
}

async function boot(root) {
  header = el('header', { class: 'app-header' });
  content = el('main', { id: 'content', class: 'app-main', tabindex: '-1' });
  root.replaceChildren(header, content);

  await loadSession(await getSession().catch(() => null));
  router = createRouter({ getState: viewState, render });
  router.start();

  onSessionChange(async (event, session) => {
    // Cambios externos (otra pestaña, token expirado). Los de esta pestaña ya se aplicaron.
    const sameUser = (session?.user?.id ?? null) === (state.session?.user?.id ?? null);
    if (event === 'SIGNED_OUT' || !sameUser) {
      await loadSession(session);
      router.refresh();
    } else if (session) {
      state.session = session;
    }
  });
}

const root = document.getElementById('app');
if (root) {
  boot(root);
}
