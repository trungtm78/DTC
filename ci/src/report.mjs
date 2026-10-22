import { translate } from './i18n.mjs';

const MAX_FINDINGS_PER_STAGE = 15;

export function formatReport(stages, messages, { failed = stages.filter((s) => s.status === 'fail').length } = {}) {
  const lines = [];
  for (const item of stages) {
    const label = translate(messages, `stage.${item.name}`);
    lines.push(`[${translate(messages, `status.${item.status}`)}] ${item.name} - ${label}`);
    for (const result of item.findings.slice(0, MAX_FINDINGS_PER_STAGE)) {
      lines.push(`    - ${translate(messages, result.messageKey, result.params)}`);
    }
    if (item.findings.length > MAX_FINDINGS_PER_STAGE) lines.push(`    ... +${item.findings.length - MAX_FINDINGS_PER_STAGE}`);
    if (item.findings.length === 0 && item.status !== 'pass' && item.output) {
      lines.push(...item.output.split('\n').slice(-8).map((row) => `    ${row}`));
    }
  }
  lines.push(failed === 0 ? translate(messages, 'report.verdictPass') : translate(messages, 'report.verdictFail', { count: failed }));
  return lines.join('\n');
}
