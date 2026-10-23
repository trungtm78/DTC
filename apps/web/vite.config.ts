import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The design package is the single source of the mockup: the web imports its stylesheets and navigation data from there. */
export const DESIGN_ROOT = fileURLToPath(new URL('../../Design/MACHVON_Design', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@design': DESIGN_ROOT } },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});
