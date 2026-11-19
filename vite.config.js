import { defineConfig, loadEnv } from 'vite';
import { buildCsp } from './src/security/csp.js';

// S-04: inyecta la CSP como <meta http-equiv> (GitHub Pages no admite
// cabeceras). Solo en build: el servidor de desarrollo de Vite usa estilos
// inline para HMR. `vite preview` sirve dist/, que ya la lleva.
function cspMeta(supabaseUrl) {
  const content = buildCsp(supabaseUrl);
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' },
      ],
    },
  };
}

// GitHub Pages publica el sitio bajo /<repo>/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: '/practica_agente/',
    plugins: [cspMeta(env.VITE_SUPABASE_URL)],
    build: {
      outDir: 'dist',
    },
  };
});
