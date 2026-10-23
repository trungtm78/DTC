import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { WEB_ROUTES } from '../src/routes/routes.generated.ts';
import { diffImages } from './support/diff.ts';
import type { Region } from './support/diff.ts';
import { upsertVisual } from './support/report.ts';
import type { VisualEntry } from './support/report.ts';

const ASSETS = fileURLToPath(new URL('../../../Design/MACHVON_Design/04_Design_Assets', import.meta.url));
const OUT = fileURLToPath(new URL('./__diff__', import.meta.url));
/** AC-ST-KERNEL-031-1: at most 0.1 percent of the pixels of a screen may differ, anti-aliasing excluded. This is a target, never a tuning knob. */
const RATIO_TARGET = 0.001;
const VIEWPORT = { width: 1440, height: 1000 };
/** The prototype export lays the sidebar out statically, so the element screenshot has the height of the content. */
/** The export ran with the prototype's design-studio bar (56px, as `--studio-height`), which made the baselines 944 px high; the application has no such bar, so the capture reserves the same 56px. */
const EXPORT_STYLE = '.studio{position:static!important}.workspace-sidebar.sidebar{position:static!important}:root{--studio-height:56px!important}';
const SIDEBAR_WIDTH = 252;
const TOPBAR_HEIGHT = 54;
const STATES = ['loading', 'empty', 'error', 'denied', 'offline', 'expired'] as const;
/** `E2E_REQUIRE_VISUAL=1` turns every pending case into a failure; the final integration sets it. */
const REQUIRE_VISUAL = process.env.E2E_REQUIRE_VISUAL === '1';

const pathOf = (id: string): string => {
  const route = WEB_ROUTES.find((candidate) => candidate.id === id);
  if (route === undefined) throw new Error(`route ${id} is not in the route table`);
  return route.path;
};

const sizeOf = (file: string): { width: number; height: number } => {
  const { width, height } = PNG.sync.read(readFileSync(file));
  return { width, height };
};

/** Opens a route and captures `#screen-capture` the way work/export_screens.cjs captured the baselines. */
async function capture(page: Page, id: string, file: string, query = ''): Promise<{ implemented: boolean }> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${pathOf(id)}${query}`);
  await page.waitForSelector('.workspace-breadcrumb');
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: EXPORT_STYLE });
  const implemented = (await page.locator('[data-screen-id]').count()) === 0;
  await page.locator('#screen-capture').screenshot({ path: file });
  return { implemented };
}

function record(entry: VisualEntry): void {
  upsertVisual(entry);
  if (entry.status === 'pending' && REQUIRE_VISUAL) throw new Error(`${entry.id} is pending (${entry.reason}) and E2E_REQUIRE_VISUAL=1`);
  if (entry.status === 'fail') {
    throw new Error(
      entry.reason === undefined
        ? `${entry.id}: ${entry.differentPixels} of ${entry.totalPixels} pixels differ (ratio ${entry.ratio}, target ${RATIO_TARGET}); see ${entry.diffPath}`
        : `${entry.id}: ${entry.reason}`,
    );
  }
}

function compare(id: string, actual: string, expected: string, region?: Region): VisualEntry {
  const diffPath = `${OUT}/${id.replace(/[^A-Za-z0-9-]/g, '_')}.diff.png`;
  let result;
  try {
    result = diffImages(actual, expected, { diffPath, region });
  } catch (error) {
    // Images that cannot be compared (another size) are a failed case with the reason, not a lost one.
    return { id, status: 'fail', reason: error instanceof Error ? error.message : String(error) };
  }
  const status = result.ratio <= RATIO_TARGET ? 'pass' : 'fail';
  return { id, status, ratio: result.ratio, differentPixels: result.differentPixels, totalPixels: result.totalPixels, diffPath };
}

for (const id of ['ADM-01', 'ADM-03'] as const) {
  test(`${id} matches its baseline PNG`, async ({ page }) => {
    const actual = `${OUT}/${id}.actual.png`;
    const expected = `${ASSETS}/screens/${id}.png`;
    const { implemented } = await capture(page, id, actual);
    if (!implemented) {
      record({ id, status: 'pending', reason: 'the screen is not implemented yet (the route renders the fallback)' });
      return;
    }
    record(compare(id, actual, expected));
  });
}

// The frame (sidebar and top bar) is the same on every screen, so ADM-01's baseline is compared region by region
// whether or not ADM-01's own content exists yet. The heights differ, hence the common height of the sidebar region.
test('shell frame: sidebar and top bar of ADM-01 match the baseline regions', async ({ page }) => {
  const actual = `${OUT}/shell-frame.actual.png`;
  const expected = `${ASSETS}/screens/ADM-01.png`;
  await capture(page, 'ADM-01', actual);
  const height = Math.min(sizeOf(actual).height, sizeOf(expected).height);
  const sidebar = compare('shell-frame:sidebar', actual, expected, { x: 0, y: 0, width: SIDEBAR_WIDTH, height });
  const topbar = compare('shell-frame:topbar', actual, expected, { x: SIDEBAR_WIDTH, y: 0, width: VIEWPORT.width - SIDEBAR_WIDTH, height: TOPBAR_HEIGHT });
  upsertVisual(sidebar);
  upsertVisual(topbar);
  expect.soft(sidebar.ratio ?? 1, `sidebar region: ${sidebar.differentPixels} of ${sidebar.totalPixels} pixels differ, see ${sidebar.diffPath}`).toBeLessThanOrEqual(RATIO_TARGET);
  expect.soft(topbar.ratio ?? 1, `top bar region: ${topbar.differentPixels} of ${topbar.totalPixels} pixels differ, see ${topbar.diffPath}`).toBeLessThanOrEqual(RATIO_TARGET);
});

// The state baselines (04_Design_Assets/states/web-*.png) are renders of the prototype's HOME-01 from before the Ruby
// palette: indigo buttons and selection, a sidebar with groups open, a toast. Those parts cannot match and are not
// compared; what is compared is the card itself (frame, glyph or skeleton, title and body), which the palette does not
// touch. The primary button of the message cards is left out of the region for the same reason (indigo against ruby).
const STATE_CARD: Region = { x: 517, y: 200, width: 659, height: 208 };
const STATE_SKELETON: Region = { x: 287, y: 177, width: 1119, height: 366 };

for (const state of STATES) {
  test(`state demo ${state} matches the card of states/web-${state}.png`, async ({ page }) => {
    const actual = `${OUT}/state-${state}.actual.png`;
    await capture(page, 'HOME-01', actual, `?demoState=${state}`);
    record(compare(`state:${state}`, actual, `${ASSETS}/states/web-${state}.png`, state === 'loading' ? STATE_SKELETON : STATE_CARD));
  });
}
