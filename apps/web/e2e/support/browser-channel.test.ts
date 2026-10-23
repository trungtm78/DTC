import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYSTEM_CHROME, browserChannel } from './browser-channel.ts';

test('the installed Google Chrome is used when it is there, because the baseline PNGs were rendered with it', () => {
  assert.equal(browserChannel({}, (path) => path === SYSTEM_CHROME), 'chrome');
});

test('without the installed Chrome Playwright\'s own Chromium is used', () => {
  assert.equal(browserChannel({}, () => false), undefined);
});

test('E2E_BROWSER_CHANNEL overrides the choice, and an empty value selects Playwright\'s Chromium', () => {
  assert.equal(browserChannel({ E2E_BROWSER_CHANNEL: 'msedge' }, () => true), 'msedge');
  assert.equal(browserChannel({ E2E_BROWSER_CHANNEL: '' }, () => true), undefined);
});
