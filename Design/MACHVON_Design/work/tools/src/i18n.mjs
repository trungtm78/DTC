import { readFileSync } from 'node:fs';

export const DEFAULT_LOCALE = 'vi';

export function loadMessages(locale = DEFAULT_LOCALE) {
  const url = new URL(`./messages/${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function translate(messages, key, params = {}) {
  const template = messages[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}
