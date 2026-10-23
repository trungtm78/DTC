import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { WEB_ROUTES } from './support/web-routes.ts';
import { diffImages } from './support/diff.ts';
import type { Region } from './support/diff.ts';
import { recordMissingVisuals, upsertVisual } from './support/report.ts';
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

// A case that fails before it could record (navigation, capture, a timeout) must not leave an earlier pass in the report:
// every visual id the test would have recorded, and did not record in this run, is written as a failure afterwards.
const CASE_IDS = new Map<string, string[]>();
function visualTest(title: string, ids: string[], body: Parameters<typeof test>[2]): void {
  CASE_IDS.set(title, ids);
  test(title, body);
}

test.afterEach(({ page }, testInfo) => {
  if (testInfo.status === 'passed' || testInfo.status === 'skipped') return;
  const reason = testInfo.error?.message ?? testInfo.status ?? 'failed';
  recordMissingVisuals(CASE_IDS.get(testInfo.title) ?? [], `${reason.split(String.fromCharCode(10))[0] ?? 'failed'} (at ${page.url()})`);
});

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
  // Every route without an implementation renders NotImplementedScreen, which marks itself.
  const implemented = (await page.locator('[data-not-implemented]').count()) === 0;
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

// The mockup of these two screens is the generic prototype page (step cards for ADM-01, placeholder matrix for ADM-03);
// the application replaces that content with the real tree, form, matrix and grants table, so the whole page cannot be
// compared. What the real screen must keep from the mockup is its frame, and every region below is gated at the target
// ratio against the screen's own baseline PNG:
//   - the shell frame (sidebar with the screen's active item, top bar with its breadcrumb);
//   - the page heading (title and subtitle);
//   - ADM-01: the top-left corner of the card with its title;
//   - ADM-03: the two card titles and the right card's note callout.
// Not compared, because the real screen shows something else on purpose: the heading action buttons (the mockup's
// generic "Xuất" and "Lưu / Tiếp tục" are replaced by the screen's real actions), everything inside the cards below their
// titles (step cards and placeholder matrix against the real tree, form, role matrix and grants table), the card heights
// and the footer note (it follows the content height and names the real data scope). The ratio of the whole page is
// measured and attached to the test as an informational annotation, never as a pass criterion.
const HEADING: Region = { x: 286, y: 85, width: 520, height: 65 };
const SIDEBAR: Region = { x: 0, y: 0, width: SIDEBAR_WIDTH, height: 944 };
const TOPBAR: Region = { x: SIDEBAR_WIDTH, y: 0, width: VIEWPORT.width - SIDEBAR_WIDTH, height: TOPBAR_HEIGHT };
// NOT-01 and NOT-02 (notification inbox and details): the mockup shows four sample notifications with their body text and
// time; the API serves the title key, priority and read state only, so the content inside the cards is not compared. The
// shell frame and the page heading are. NOT-02's heading region starts at the back link above the title.
const NOTIFICATION_HEADING: Region = { x: 286, y: 85, width: 520, height: 100 };
const SCREEN_REGIONS: Record<'ADM-01' | 'ADM-03' | 'NOT-01' | 'NOT-02', Record<string, Region>> = {
  'ADM-01': {
    sidebar: SIDEBAR,
    topbar: TOPBAR,
    heading: HEADING,
    'card-top-left': { x: 287, y: 177, width: 493, height: 63 },
  },
  'ADM-03': {
    sidebar: SIDEBAR,
    topbar: TOPBAR,
    heading: HEADING,
    'left-card-title': { x: 287, y: 177, width: 692, height: 60 },
    'right-card-title': { x: 999, y: 177, width: 407, height: 60 },
    'right-card-note': { x: 999, y: 177, width: 407, height: 140 },
  },
  'NOT-01': {
    sidebar: SIDEBAR,
    topbar: TOPBAR,
    heading: HEADING,
  },
  'NOT-02': {
    sidebar: SIDEBAR,
    topbar: TOPBAR,
    heading: NOTIFICATION_HEADING,
  },
};

for (const id of ['ADM-01', 'ADM-03', 'NOT-01', 'NOT-02'] as const) {
  const regionIds = Object.keys(SCREEN_REGIONS[id]).map((name) => `${id}:${name}`);
  visualTest(`${id}: the page frame regions match the baseline PNG`, regionIds, async ({ page }, testInfo) => {
    const actual = `${OUT}/${id}.actual.png`;
    const expected = `${ASSETS}/screens/${id}.png`;
    // The tenant owner sees the screen with its data (the API stack seeds the fixture tenant).
    const { implemented } = await capture(page, id, actual, '?devUser=owner');
    if (!implemented) {
      record({ id, status: 'pending', reason: 'the screen is not implemented yet (the route renders the fallback)' });
      return;
    }
    // The real page is taller than the mockup when it holds data: the informational ratio then covers the first rows both share.
    const shared = Math.min(sizeOf(actual).height, sizeOf(expected).height);
    const whole = compare(`${id}:whole-page`, actual, expected, { x: 0, y: 0, width: VIEWPORT.width, height: shared });
    const note =
      whole.ratio === undefined ? `${id} whole page: ${whole.reason}` : `${id} whole page (first ${shared} rows): ratio ${whole.ratio.toFixed(4)} (${whole.differentPixels} of ${whole.totalPixels} pixels); not gated`;
    testInfo.annotations.push({ type: 'informational', description: note });
    process.stdout.write(`${note}
`);
    for (const [name, region] of Object.entries(SCREEN_REGIONS[id])) record(compare(`${id}:${name}`, actual, expected, region));
  });
}

// The frame (sidebar and top bar) is the same on every screen, so ADM-01's baseline is compared region by region
// whether or not ADM-01's own content exists yet. The heights differ, hence the common height of the sidebar region.
visualTest('shell frame: sidebar and top bar of ADM-01 match the baseline regions', ['shell-frame:sidebar', 'shell-frame:topbar'], async ({ page }) => {
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
  visualTest(`state demo ${state} matches the card of states/web-${state}.png`, [`state:${state}`], async ({ page }) => {
    const actual = `${OUT}/state-${state}.actual.png`;
    await capture(page, 'HOME-01', actual, `?demoState=${state}`);
    record(compare(`state:${state}`, actual, `${ASSETS}/states/web-${state}.png`, state === 'loading' ? STATE_SKELETON : STATE_CARD));
  });
}
