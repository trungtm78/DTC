import { DomainError } from '../src/errors.ts';
import { ND30_A4_STANDARD, assertLayoutWithinLegalRange, layoutProfileOf } from '../src/pdf-layout.ts';
import type { LayoutProfile } from '../src/pdf-layout.ts';

function detailOf(profile: LayoutProfile): { code: string; detail: string | undefined } | undefined {
  try {
    assertLayoutWithinLegalRange(profile);
    return undefined;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, detail: error.detail };
    throw error;
  }
}

function withMargin(key: 'top' | 'bottom' | 'left' | 'right', value: number): LayoutProfile {
  return { ...ND30_A4_STANDARD, marginsMm: { ...ND30_A4_STANDARD.marginsMm, [key]: value } };
}

function withSize(key: keyof LayoutProfile['elementStyles'], size: number): LayoutProfile {
  return {
    ...ND30_A4_STANDARD,
    elementStyles: { ...ND30_A4_STANDARD.elementStyles, [key]: { ...ND30_A4_STANDARD.elementStyles[key], sizePt: size } },
  };
}

describe('ND30_A4_STANDARD (BR-DOC-13)', () => {
  it('uses the default values of the table of BR-DOC-13', () => {
    expect(ND30_A4_STANDARD.code).toBe('ND30_A4_STANDARD');
    expect(ND30_A4_STANDARD.revision).toBe(1);
    expect(ND30_A4_STANDARD.marginsMm).toEqual({ top: 20, bottom: 20, left: 30, right: 15 });
    expect(ND30_A4_STANDARD.fontFamily).toBe('Times New Roman');
    expect(ND30_A4_STANDARD.elementStyles.nationalTitle.sizePt).toBe(13);
    expect(ND30_A4_STANDARD.elementStyles.motto.sizePt).toBe(14);
    expect(ND30_A4_STANDARD.elementStyles.body.sizePt).toBe(14);
    expect(ND30_A4_STANDARD.elementStyles.recipientsLabel.sizePt).toBe(12);
    expect(ND30_A4_STANDARD.elementStyles.recipientsList.sizePt).toBe(11);
  });

  it('is within its own legal range', () => {
    expect(detailOf(ND30_A4_STANDARD)).toBeUndefined();
  });
});

describe('assertLayoutWithinLegalRange', () => {
  it.each([
    ['top', 19.9, 'marginsMm.top'],
    ['top', 25.1, 'marginsMm.top'],
    ['bottom', 25.1, 'marginsMm.bottom'],
    ['left', 29.9, 'marginsMm.left'],
    ['left', 35.1, 'marginsMm.left'],
    ['right', 14.9, 'marginsMm.right'],
    ['right', 20.1, 'marginsMm.right'],
  ] as const)('refuses margin %s = %s', (key, value, detail) => {
    expect(detailOf(withMargin(key, value))).toEqual({ code: 'LAYOUT_OUT_OF_LEGAL_RANGE', detail });
  });

  it.each([
    ['top', 25],
    ['bottom', 20],
    ['left', 35],
    ['right', 20],
  ] as const)('accepts the boundary of margin %s = %s', (key, value) => {
    expect(detailOf(withMargin(key, value))).toBeUndefined();
  });

  it.each([
    ['nationalTitle', 11.9],
    ['nationalTitle', 13.1],
    ['motto', 12.9],
    ['motto', 14.1],
    ['body', 15],
    ['signerTitle', 12],
  ] as const)('refuses the size %s = %s', (key, size) => {
    expect(detailOf(withSize(key, size))).toEqual({ code: 'LAYOUT_OUT_OF_LEGAL_RANGE', detail: `elementStyles.${key}.sizePt` });
  });

  it('fixes the recipients label at 12 pt and the list at 11 pt', () => {
    expect(detailOf(withSize('recipientsLabel', 13))?.detail).toBe('elementStyles.recipientsLabel.sizePt');
    expect(detailOf(withSize('recipientsList', 12))?.detail).toBe('elementStyles.recipientsList.sizePt');
  });

  it('refuses a page size other than A4 and a missing element style', () => {
    expect(detailOf({ ...ND30_A4_STANDARD, pageSize: 'LETTER' as 'A4' })?.detail).toBe('pageSize');
    const rest = Object.fromEntries(Object.entries(ND30_A4_STANDARD.elementStyles).filter(([name]) => name !== 'body'));
    expect(detailOf({ ...ND30_A4_STANDARD, elementStyles: rest as LayoutProfile['elementStyles'] })?.detail).toBe('elementStyles.body');
  });
});

describe('layoutProfileOf (a document_layout_profile row to a profile)', () => {
  const row = {
    profile_code: 'ND30_A4_STANDARD',
    revision: 1,
    page_size: 'A4',
    margins_mm: { top: 20, bottom: 20, left: 30, right: 15 },
    font_family: 'Times New Roman',
    font_substitute: 'Tinos',
    element_styles: ND30_A4_STANDARD.elementStyles,
    signature_layout: ND30_A4_STANDARD.signatureLayout,
    number_field_layout: ND30_A4_STANDARD.numberFieldLayout,
    watermark_policy: { text: 'DRAFT' },
    confirmation_status: 'PENDING_CONFIRMATION',
  };

  it('maps the columns and keeps the confirmation state', () => {
    const profile = layoutProfileOf(row);
    expect(profile.code).toBe('ND30_A4_STANDARD');
    expect(profile.fontSubstitute).toBe('Tinos');
    expect(profile.confirmationStatus).toBe('PENDING_CONFIRMATION');
    expect(profile.watermarkPolicy.text).toBe('DRAFT');
  });

  it('refuses a row that is out of range or malformed', () => {
    expect(() => layoutProfileOf({ ...row, margins_mm: { top: 30, bottom: 20, left: 30, right: 15 } })).toThrow(DomainError);
    expect(() => layoutProfileOf({ ...row, margins_mm: 'wide' })).toThrow(DomainError);
    expect(() => layoutProfileOf({ ...row, element_styles: null })).toThrow(DomainError);
  });
});
