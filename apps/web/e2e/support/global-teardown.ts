import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { STACK_DIR, STACK_PID_PATH, STACK_STOP_PATH } from './stack-paths.ts';

const POLL_MS = 500;
const PATIENCE_MS = 60_000;

/**
 * Asks the API stack to stop and waits until it has removed its pid file, which it does last, after the database
 * server is down. If it does not answer, the web server teardown of Playwright still ends its process tree.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STACK_PID_PATH)) return;
  mkdirSync(STACK_DIR, { recursive: true });
  writeFileSync(STACK_STOP_PATH, 'stop');
  const deadline = Date.now() + PATIENCE_MS;
  while (existsSync(STACK_PID_PATH) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
