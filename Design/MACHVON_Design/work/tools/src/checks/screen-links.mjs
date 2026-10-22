import { finding } from './finding.mjs';

export function checkScreenLinks(model) {
  const screenIds = new Set(model.screens.map((s) => s.id));
  const backlogIds = new Set(model.backlog.map((b) => b.id));
  const backlogScreens = new Set(model.backlog.map((b) => b.screen));
  const tracedScreens = new Set(model.trace.map((t) => t.screen));
  const findings = [];

  for (const screen of model.screens) {
    if (!backlogScreens.has(screen.id)) findings.push(finding('SCREEN_WITHOUT_BACKLOG', { screen: screen.id }));
    if (!tracedScreens.has(screen.id)) findings.push(finding('SCREEN_WITHOUT_TRACE', { screen: screen.id }));
  }
  for (const row of model.backlog) {
    if (!screenIds.has(row.screen)) {
      findings.push(finding('BACKLOG_UNKNOWN_SCREEN', { backlog: row.id, screen: row.screen }));
    }
  }
  for (const row of model.trace) {
    if (!screenIds.has(row.screen)) {
      findings.push(finding('TRACE_UNKNOWN_SCREEN', { requirement: row.requirement, screen: row.screen }));
    }
    if (!backlogIds.has(row.backlog_id)) {
      findings.push(finding('TRACE_UNKNOWN_BACKLOG', { requirement: row.requirement, backlog: row.backlog_id }));
    }
  }
  return findings;
}
