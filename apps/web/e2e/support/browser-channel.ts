import { existsSync } from 'node:fs';

/** The baseline PNGs of 04_Design_Assets were rendered with the installed Google Chrome; compare with the same engine when it is there. */
export const SYSTEM_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * The Playwright browser channel: `E2E_BROWSER_CHANNEL` when it is set (an empty value selects Playwright's own Chromium),
 * otherwise `chrome` when it is installed. Shared by playwright.config.ts and the specs that launch their own browsers.
 */
export function browserChannel(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | undefined {
  const chosen = env.E2E_BROWSER_CHANNEL;
  if (chosen !== undefined) return chosen === '' ? undefined : chosen;
  return exists(SYSTEM_CHROME) ? 'chrome' : undefined;
}
