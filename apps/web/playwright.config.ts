import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { defineConfig } from '@playwright/test';

/** The baseline PNGs of 04_Design_Assets were rendered with the installed Google Chrome; compare with the same engine when it is there. */
const SYSTEM_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close((closeError) => (closeError ? reject(closeError) : resolve(port)));
    });
  });
}

const port = Number(process.env.E2E_PORT ?? (await freePort()));
// The test workers load this file again: keeping the port in the environment makes them agree with the dev server.
process.env.E2E_PORT = String(port);
const channel = process.env.E2E_BROWSER_CHANNEL ?? (existsSync(SYSTEM_CHROME) ? 'chrome' : undefined);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One browser at a time: the machine runs real PostgreSQL servers and other builds alongside.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: './e2e/test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...(channel === undefined ? {} : { channel }),
    deviceScaleFactor: 1,
    locale: 'vi-VN',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_DEV_SESSION_KEY: process.env.VITE_DEV_SESSION_KEY ?? Buffer.alloc(32, 7).toString('base64') },
  },
});
