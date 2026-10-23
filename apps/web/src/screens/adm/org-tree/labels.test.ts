import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n';
import en from '../../../i18n/en.json';
import vi_ from '../../../i18n/vi.json';
import { problemMessage, statusLabel, unitTypeLabel } from './labels';
import type { ProblemReason, ProblemView } from './problems';
import { UNIT_TYPES } from './types';

// Strict: a key that is missing from a catalogue throws, so every label below is proved to exist in both languages.
const translators = (['vi', 'en'] as const).map((locale) => createTranslator({ locale, catalogues: { vi: vi_, en }, strict: true }).t);

const REASONS: readonly ProblemReason[] = ['cycle', 'depth', 'codeTaken', 'validity', 'invalid', 'fieldNotAllowed', 'scopeDenied', 'notFound', 'conflict', 'stepUp', 'session', 'general'];

describe('labels', () => {
  it.each(translators.map((t, index) => [index === 0 ? 'vi' : 'en', t] as const))('writes a distinct message for every failure reason in %s', (_locale, t) => {
    const messages = REASONS.map((reason) => problemMessage(t, { reason, field: undefined, currentVersion: reason === 'conflict' ? 8 : undefined, kind: 'general' } satisfies ProblemView));
    expect(new Set(messages).size).toBe(REASONS.length);
    expect(messages.every((message) => message !== '')).toBe(true);
  });

  it('puts the current version into the conflict message, and nothing when the server did not send one', () => {
    const [vi] = translators;
    expect(problemMessage(vi as typeof translators[number], { reason: 'conflict', field: undefined, currentVersion: 8, kind: 'conflict' })).toContain('8');
    expect(problemMessage(vi as typeof translators[number], { reason: 'conflict', field: undefined, currentVersion: undefined, kind: 'conflict' })).not.toContain('{version}');
  });

  it.each(translators)('names the four statuses and passes an unknown one through', (t) => {
    const names = ['Planned', 'Active', 'Superseded', 'Dissolved'].map((status) => statusLabel(t, status));
    expect(new Set(names).size).toBe(4);
    expect(statusLabel(t, 'SomethingNew')).toBe('SomethingNew');
  });

  it.each(translators)('names every unit type', (t) => {
    const names = UNIT_TYPES.map((type) => unitTypeLabel(t, type));
    expect(new Set(names).size).toBe(UNIT_TYPES.length);
  });
});
