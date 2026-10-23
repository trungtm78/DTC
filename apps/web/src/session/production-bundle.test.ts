// @vitest-environment node
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { DESIGN_ROOT } from '../../vite.config';
import { DEV_SESSION_MARKER } from './dev-tenants';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function productionBuild(): Promise<{ chunks: Rollup.OutputChunk[]; assets: Rollup.OutputAsset[] }> {
  // Vitest sets NODE_ENV=test, which Vite reads as a development build (import.meta.env.DEV true).
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await collect();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

async function collect(): Promise<{ chunks: Rollup.OutputChunk[]; assets: Rollup.OutputAsset[] }> {
  const result = await build({
    root: WEB_ROOT,
    configFile: false,
    mode: 'production',
    logLevel: 'silent',
    plugins: [react()],
    resolve: { alias: { '@design': DESIGN_ROOT } },
    build: { write: false, minify: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => ('output' in entry ? entry.output : []));
  return {
    chunks: outputs.filter((item): item is Rollup.OutputChunk => item.type === 'chunk'),
    assets: outputs.filter((item): item is Rollup.OutputAsset => item.type === 'asset'),
  };
}

describe('production bundle', () => {
  it('never contains the development session, and carries the prototype stylesheets from the design package', async () => {
    const { chunks, assets } = await productionBuild();
    const code = chunks.map((chunk) => chunk.code).join('\n');
    expect(code).not.toContain(DEV_SESSION_MARKER);
    expect(code).not.toContain('DevSessionProvider');
    expect(code).not.toContain('VITE_DEV_SESSION_KEY');
    const css = assets
      .filter((asset) => asset.fileName.endsWith('.css'))
      .map((asset) => String(asset.source))
      .join('\n');
    expect(css).toContain('.workspace-sidebar');
    expect(css).toContain('[data-mv-tenant-theme]');
  }, 120_000);
});
