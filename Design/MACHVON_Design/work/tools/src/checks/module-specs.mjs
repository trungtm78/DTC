import { finding } from './finding.mjs';

// Number of numbered sections in 01_Documents/05_modules/_KHUNG_DAC_TA.md.
export const REQUIRED_SECTIONS = 13;

const SECTION_HEADING = /^##\s+(\d+)\./;

function sectionBodies(markdown) {
  const bodies = new Map();
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      current = Number(heading[1]);
      bodies.set(current, []);
    } else if (current !== null && line.trim()) {
      bodies.get(current).push(line);
    }
  }
  return bodies;
}

export function checkModuleSpecs(model) {
  if (!model.moduleSpecs) return [];
  const findings = [];
  const modules = [...new Set(model.screens.map((screen) => screen.module))].sort();

  for (const module of modules) {
    const spec = model.moduleSpecs[module];
    if (spec === undefined) {
      findings.push(finding('MODULE_SPEC_MISSING', { module }));
      continue;
    }
    const bodies = sectionBodies(spec);
    for (let section = 1; section <= REQUIRED_SECTIONS; section += 1) {
      if (!bodies.has(section)) findings.push(finding('MODULE_SPEC_SECTION_MISSING', { module, section }));
      else if (bodies.get(section).length === 0) findings.push(finding('MODULE_SPEC_SECTION_EMPTY', { module, section }));
    }
  }
  return findings;
}
