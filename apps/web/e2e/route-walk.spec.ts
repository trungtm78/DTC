import { test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { WEB_ROUTES } from './support/web-routes.ts';
import { problemsOf, writeReportPart } from './support/report.ts';
import { selectRoutes } from './support/routes-filter.ts';
import type { RouteWalkEntry, WalkViewport } from './support/report.ts';

const VIEWPORTS: Record<WalkViewport, { width: number; height: number }> = {
  '1440': { width: 1440, height: 1000 },
  '390': { width: 390, height: 844 },
};
// The dev server hands out every module of a page as its own request; more than four pages at once starve the browser
// (net::ERR_INSUFFICIENT_RESOURCES) on this memory-constrained machine and fail pages that are healthy.
const PARALLEL_PAGES = 4;
/** Hard ceiling for one route: navigation, first render and the checks. */
const PAGE_TIMEOUT_MS = 15_000;

async function walkViewport(browser: Browser, viewport: WalkViewport, routes: typeof WEB_ROUTES): Promise<RouteWalkEntry[]> {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  const entries: RouteWalkEntry[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    const page = await context.newPage();
    for (;;) {
      const route = routes[next];
      next += 1;
      if (route === undefined) break;
      const consoleErrors: string[] = [];
      const onConsole = (message: { type(): string; text(): string; location(): { url: string } }): void => {
        // A failed resource says only 404; the URL tells which one.
        if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`.trim());
      };
      const onPageError = (error: Error): void => void consoleErrors.push(error.message);
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      const measured: Omit<RouteWalkEntry, 'problems'> = {
        id: route.id,
        path: route.path,
        viewport,
        sidebarGroup: false,
        breadcrumb: false,
        activeItem: false,
        consoleErrors,
        overflowPx: 0,
      };
      try {
        await page.goto(`${route.path}?devUser=owner`, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        await page.waitForSelector('.workspace-breadcrumb', { timeout: PAGE_TIMEOUT_MS });
        // Lazy screens and the dev session mount after the frame; let the network settle before counting errors.
        await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT_MS });
        Object.assign(
          measured,
          await page.evaluate(() => ({
            sidebarGroup: document.querySelectorAll('.sidebar-section, .sidebar-destination').length > 0,
            breadcrumb: document.querySelector('.workspace-breadcrumb strong') !== null,
            activeItem: document.querySelector('.destination-active, .current-context-leaf, .sidebar [aria-current="page"]') !== null,
            overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          })),
        );
      } catch (error) {
        measured.loadError = error instanceof Error ? error.message.split('\n')[0] : String(error);
      }
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      entries.push({ ...measured, problems: problemsOf(measured) });
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: PARALLEL_PAGES }, worker));
  await context.close();
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

test('every web route renders the shell without console errors or overflow, at 1440 and 390 px', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  // `E2E_ROUTES=HOME-01,ADM-01` limits the walk (for a quick run); an id that is not in the table fails the run, because a
  // mistyped id would otherwise walk fewer pages, or none, and pass.
  const { selected: routes, unknown } = selectRoutes(WEB_ROUTES, process.env.E2E_ROUTES);
  if (unknown.length > 0 || routes.length === 0) {
    // No walk happened: a result left by an earlier run must not stand in for it.
    writeReportPart({ routeWalk: undefined });
    throw new Error(unknown.length > 0 ? `E2E_ROUTES names routes that are not in the route table: ${unknown.join(', ')}` : 'the route walk has no route to walk');
  }
  const entries: RouteWalkEntry[] = [];
  for (const viewport of ['1440', '390'] as const) entries.push(...(await walkViewport(browser, viewport, routes)));
  writeReportPart({ routeWalk: { routes: routes.length, entries } });

  const broken = entries.filter((entry) => entry.problems.length > 0);
  const summary = broken.map((entry) => `${entry.id}@${entry.viewport}: ${entry.problems.join('; ')}`);
  test.info().annotations.push({ type: 'routes', description: `${routes.length} routes, ${entries.length} pages, ${broken.length} broken` });
  if (broken.length > 0) throw new Error(`${broken.length} of ${entries.length} pages are broken:\n${summary.join('\n')}`);
});
