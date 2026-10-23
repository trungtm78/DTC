import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPORT_PATH = resolve(HERE, '..', 'report.json');

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
  status: 'pass' | 'fail' | 'pending';
  ratio?: number;
  differentPixels?: number;
  totalPixels?: number;
  /** For pending: what is missing. */
  reason?: string;
  diffPath?: string;
}

export interface E2eReport {
  generatedAt: string;
  routeWalk?: { routes: number; entries: RouteWalkEntry[] };
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

/** Merges a part into the report file: the walk and the visual spec run separately and each keeps the other's result. */
export function writeReportPart(part: Partial<Omit<E2eReport, 'generatedAt'>>, path: string = REPORT_PATH): E2eReport {
  const report: E2eReport = { ...readReport(path), ...part, generatedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + String.fromCharCode(10));
  return report;
}

/** Records one visual case now, replacing an earlier entry with the same id (a failed test restarts the worker, so memory is not enough). */
export function upsertVisual(entry: VisualEntry, path: string = REPORT_PATH): E2eReport {
  const others = (readReport(path)?.visual ?? []).filter((existing) => existing.id !== entry.id);
  return writeReportPart({ visual: [...others, entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }, path);
}
