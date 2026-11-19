import { defineConfig } from 'vite';

// GitHub Pages publica el sitio bajo /<repo>/.
export default defineConfig({
  base: '/practica_agente/',
  build: {
    outDir: 'dist',
  },
});
