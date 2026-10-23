import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { DESIGN_ROOT } from './vite.config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@design': DESIGN_ROOT } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/vite-env.d.ts'],
      reporter: ['text'],
      thresholds: { lines: 90 },
    },
  },
});
