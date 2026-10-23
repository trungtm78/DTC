import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { defineConfig } from '@playwright/test';
import { STACK_INFO_PATH } from './e2e/support/stack-paths.ts';

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

// One id for this invocation: the report marks what an earlier run wrote as stale (the workers inherit it).
process.env.E2E_RUN_ID ??= randomUUID();

const port = Number(process.env.E2E_PORT ?? (await freePort()));
// The test workers load this file again: keeping the port in the environment makes them agree with the dev server.
process.env.E2E_PORT = String(port);
// The API stack the browser talks to: its port and the key that signs the development session tokens are fixed here,
// before any process starts, and kept in the environment so the test workers (which load this file again) agree.
const apiPort = Number(process.env.E2E_API_PORT ?? (await freePort()));
process.env.E2E_API_PORT = String(apiPort);
const sessionKey = process.env.E2E_SESSION_KEY ?? randomBytes(32).toString('base64');
process.env.E2E_SESSION_KEY = sessionKey;
process.env.E2E_STACK_INFO = STACK_INFO_PATH;
const fixtureUsers: unknown = (JSON.parse(readFileSync(new URL('./e2e/support/e2e-fixtures.json', import.meta.url), 'utf8')) as { users: unknown }).users;
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
  globalTeardown: './e2e/support/global-teardown.ts',
  webServer: [
    {
      // The real API over a real database, seeded with the fixture tenants and users (apps/api/test/e2e-stack).
      command: 'node e2e/support/clean-orphans.ts && npm run e2e:stack -w @machvon/api',
      url: `http://127.0.0.1:${apiPort}/__e2e/health`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { E2E_API_PORT: String(apiPort), E2E_SESSION_KEY: sessionKey, E2E_STACK_INFO: STACK_INFO_PATH },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_DEV_SESSION_KEY: sessionKey,
        VITE_DEV_USERS: JSON.stringify(fixtureUsers),
        VITE_API_BASE_URL: '/api',
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
