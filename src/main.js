// Punto de entrada del front: arma el marco de la app, carga sesión y roles,
// y delega en el router por hash qué vista mostrar.
// S-04: primero el anti-framing; si la página está enmarcada, elimina #app y la app no arranca.
import './security/anti-framing.js';
import './styles.css';
import { createRouter } from './lib/router.js';
import { distinctRoles, ROLE_LABELS, CHOOSER_PATH, LOGIN_PATH } from './lib/route-logic.js';
import { getSupabase } from './lib/supabase.js';
import { getRoles, getSession, onSessionChange, signIn, signOut, MSG_NOT_CONFIGURED } from './lib/session.js';
import { el } from './views/dom.js';
import { renderLogin } from './views/login.js';
import { renderRoleHome } from './views/role-home.js';
import { renderChooser } from './views/chooser.js';
import { renderNoRole } from './views/no-role.js';

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

function render(view) {
  const { roles } = viewState();
  renderHeader(header, roles);
  let node;
  if (view === 'login') {
    node = renderLogin({ onSubmit: handleLogin, notice: getSupabase() ? null : MSG_NOT_CONFIGURED });
  } else if (view === 'chooser') {
    node = renderChooser({ roles });
  } else if (view === 'no-role') {
    node = renderNoRole({ message: state.rolesError });
  } else {
    node = renderRoleHome({ role: view, rows: state.rows });
  }
  content.replaceChildren(node);
  document.title = view in ROLE_LABELS ? `${ROLE_LABELS[view]} · ${APP_TITLE}` : APP_TITLE;
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
