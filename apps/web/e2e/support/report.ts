import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPORT_PATH = resolve(HERE, '..', 'report.json');

/** One id per Playwright invocation (playwright.config.ts sets E2E_RUN_ID, the workers inherit it); what an earlier run wrote is stale. */
export const currentRunId = (): string => process.env.E2E_RUN_ID ?? 'unscoped';

/** The run id given to a visual entry that an older report holds without one: it is never the current run. */
const LEGACY_RUN_ID = 'before-run-ids';

export type WalkViewport = '1440' | '390';

export interface RouteWalkEntry {
  id: string;
  path: string;
  viewport: WalkViewport;
  sidebarGroup: boolean;
  breadcrumb: boolean;
  activeItem: boolean;
  consoleErrors: string[];
  /** document scrollWidth minus innerWidth; positive means horizontal overflow. */
  overflowPx: number;
  loadError?: string;
  /** Why this entry counts as broken (empty when it does not). */
  problems: string[];
}

export interface VisualEntry {
  id: string;
  /** `stale`: written by an earlier run and not run again by the latest one, so it proves nothing. */
  status: 'pass' | 'fail' | 'pending' | 'stale';
  ratio?: number;
  differentPixels?: number;
  totalPixels?: number;
  /** For pending: what is missing. */
  reason?: string;
  diffPath?: string;
  /** The run that wrote the entry. */
  runId?: string;
}

export interface E2eReport {
  generatedAt: string;
  routeWalk?: { routes: number; entries: RouteWalkEntry[]; runId?: string; stale?: boolean };
  visual?: VisualEntry[];
}

/** The problems of one walked route; the 1440 px page must have the whole frame and no overflow, both widths no console errors. */
export function problemsOf(entry: Omit<RouteWalkEntry, 'problems'>): string[] {
  const problems: string[] = [];
  if (entry.loadError !== undefined) problems.push(`load: ${entry.loadError}`);
  if (entry.consoleErrors.length > 0) problems.push(`console errors: ${entry.consoleErrors.length}`);
  if (!entry.breadcrumb) problems.push('no breadcrumb');
  if (entry.viewport === '1440') {
    if (!entry.sidebarGroup) problems.push('no sidebar group');
    if (!entry.activeItem) problems.push('no active item');
    if (entry.overflowPx > 0) problems.push(`horizontal overflow ${entry.overflowPx}px`);
  }
  return problems;
}

/** Reads the report file; absent when no run has written one yet. */
export function readReport(path: string = REPORT_PATH): E2eReport | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as E2eReport) : undefined;
}

/** What an earlier run left in the report proves nothing about this run: its visual cases turn stale and its walk is flagged. */
function markStale(report: E2eReport, runId: string): E2eReport {
  const visual = report.visual?.map((entry) =>
    entry.runId === runId || entry.status === 'stale'
      ? entry
      : { ...entry, status: 'stale' as const, reason: `not run again by the latest run (earlier run: ${entry.status}${entry.reason === undefined ? '' : `, ${entry.reason}`})` },
  );
  const walk = report.routeWalk;
  const routeWalk = walk === undefined || walk.runId === runId ? walk : { ...walk, stale: true };
  return { ...report, ...(visual === undefined ? {} : { visual }), ...(routeWalk === undefined ? {} : { routeWalk }) };
}

/**
 * Merges a part into the report file: the walk and the visual spec run separately and each keeps the other's result,
 * but whatever an earlier run wrote is marked stale, so an old pass can never be read as a result of this run.
 */
export function writeReportPart(part: Partial<Omit<E2eReport, 'generatedAt'>>, path: string = REPORT_PATH, runId: string = currentRunId()): E2eReport {
  // What this call writes belongs to this run; an entry that already carries another run id keeps it and turns stale
  // below. Entries inherited from an older report are tagged by their reader (see upsertVisual), never here.
  const tagged: typeof part = {
    ...part,
    ...(part.routeWalk === undefined ? {} : { routeWalk: { ...part.routeWalk, runId, stale: undefined } }),
    ...(part.visual === undefined ? {} : { visual: part.visual.map((entry) => ({ ...entry, runId: entry.runId ?? runId })) }),
  };
  const merged: E2eReport = { ...readReport(path), ...tagged, generatedAt: new Date().toISOString() };
  const report = markStale(merged, runId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + String.fromCharCode(10));
  return report;
}

/** Records one visual case now, replacing an earlier entry with the same id (a failed test restarts the worker, so memory is not enough). */
export function upsertVisual(entry: VisualEntry, path: string = REPORT_PATH, runId: string = currentRunId()): E2eReport {
  // Entries of reports that predate run ids keep no id of their own and must not inherit this run's.
  const others = (readReport(path)?.visual ?? []).filter((existing) => existing.id !== entry.id).map((existing) => ({ ...existing, runId: existing.runId ?? LEGACY_RUN_ID }));
  return writeReportPart({ visual: [...others, { ...entry, runId }].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }, path, runId);
}

/** After a failure before the cases could record: every listed case this run did not record yet fails with the reason. */
export function recordMissingVisuals(ids: readonly string[], reason: string, path: string = REPORT_PATH, runId: string = currentRunId()): void {
  const recorded = new Set((readReport(path)?.visual ?? []).filter((entry) => entry.runId === runId).map((entry) => entry.id));
  for (const id of ids) if (!recorded.has(id)) upsertVisual({ id, status: 'fail', reason }, path, runId);
}
