import { finding } from './checks/finding.mjs';
import { listOperations } from './checks/openapi.mjs';
import { parseSql } from './sql.mjs';

// Baseline-first rule: the v1.3 package (git tag baseline-v1.3) is the foundation. Nothing in it
// may disappear, and every deliberate change to a baseline record needs a change request (CR).

const MIN_PARAGRAPH_LENGTH = 60;
const EDITED_PREFIX_LENGTH = 60;
const APPENDIX_HEADING = /^##\s+Phụ lục: ánh xạ nội dung baseline/m;
// The mapping appendix must quote at least the first 30 characters of a removed paragraph.
const MAPPING_PREFIX_LENGTH = 30;

const LOST_CODE = {
  dictionary: 'BASELINE_COLUMN_LOST',
};

export function diffRecords(baseline, current, keyOf) {
  const currentByKey = new Map(current.map((record) => [keyOf(record), record]));
  const lost = [];
  const changed = [];
  for (const record of baseline) {
    const key = keyOf(record);
    const now = currentByKey.get(key);
    if (!now) {
      lost.push(key);
      continue;
    }
    const fields = [...new Set([...Object.keys(record), ...Object.keys(now)])]
      .filter((field) => JSON.stringify(record[field]) !== JSON.stringify(now[field]))
      .sort();
    if (fields.length > 0) changed.push({ key, fields });
  }
  return { lost, changed };
}

export function flattenDictionary(entities) {
  return Object.entries(entities).flatMap(([table, columns]) =>
    Object.entries(columns).map(([column, type]) => ({ id: `${table}.${column}`, type })),
  );
}

export function matchesPattern(value, pattern) {
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(value);
}

export function buildChangeLog(diffs, register) {
  const entries = [];
  for (const [collection, { changed }] of Object.entries(diffs)) {
    for (const { key, fields } of changed) {
      const rule = register.find((item) => item.collection === collection && matchesPattern(key, item.match));
      entries.push({ collection, key, fields, cr: rule?.cr ?? null, reason: rule?.reason ?? null });
    }
  }
  return entries;
}

export function checkBaseline(diffs, changeLog) {
  const findings = [];
  for (const [collection, { lost }] of Object.entries(diffs)) {
    for (const key of lost) findings.push(finding(LOST_CODE[collection] ?? 'BASELINE_ID_LOST', { collection, key }));
  }
  for (const entry of changeLog.filter((item) => item.cr === null)) {
    findings.push(finding('BASELINE_CHANGE_WITHOUT_CR', { collection: entry.collection, key: entry.key, fields: entry.fields.join(', ') }));
  }
  return findings;
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim();

export function removedParagraphs(baselineText, currentText) {
  const current = normalise(currentText);
  const appendixStart = currentText.search(APPENDIX_HEADING);
  const appendix = appendixStart < 0 ? '' : normalise(currentText.slice(appendixStart));
  return baselineText
    .split(/\n\s*\n/)
    .map(normalise)
    .filter((paragraph) => paragraph.length >= MIN_PARAGRAPH_LENGTH)
    .filter((paragraph) => !current.includes(paragraph))
    // Edited in place: the opening survives, only the rest changed (the edit carries a CR marker).
    .filter((paragraph) => !current.includes(paragraph.slice(0, EDITED_PREFIX_LENGTH)))
    .filter((paragraph) => !appendix.includes(paragraph.slice(0, MAPPING_PREFIX_LENGTH)));
}

export function collectDiffs(baseline, current) {
  const byKey = (record) => record.id;
  const operationsOf = (openapi) =>
    listOperations(openapi).map(({ path, method, operation }) => ({ id: operation.operationId, path, method, operation }));
  return {
    screens: diffRecords(baseline.screens, current.screens, byKey),
    backlog: diffRecords(baseline.backlog, current.backlog, byKey),
    trace: diffRecords(baseline.trace, current.trace, (r) => `${r.requirement}|${r.screen}`),
    tests: diffRecords(baseline.tests, current.tests, byKey),
    decisions: diffRecords(baseline.decisions, current.decisions, byKey),
    operations: diffRecords(operationsOf(baseline.openapi), operationsOf(current.openapi), byKey),
    tables: diffRecords(
      [...parseSql(baseline.sql).tables.keys()].map((id) => ({ id })),
      [...parseSql(current.sql).tables.keys()].map((id) => ({ id })),
      byKey,
    ),
    dictionary: diffRecords(flattenDictionary(baseline.entities), flattenDictionary(current.entities), byKey),
  };
}
