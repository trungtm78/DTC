import { DomainError } from './errors.ts';

export type ElementName =
  | 'nationalTitle'
  | 'motto'
  | 'agency'
  | 'number'
  | 'placeDate'
  | 'docTypeName'
  | 'summary'
  | 'body'
  | 'signerTitle'
  | 'signerName'
  | 'recipientsLabel'
  | 'recipientsList'
  | 'pageNumber';

export interface ElementStyle {
  sizePt: number;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
}

export interface Box {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SignatureLayout {
  leaderBox: Box;
  sealBox: Box;
}

export interface NumberFieldLayout {
  number: Box;
  symbol: Box;
  date: Box;
}

export interface WatermarkPolicy {
  /** Text drawn on every page while the profile or the template is not confirmed (BR-DOC-10). */
  text: string;
}

/** A `document_layout_profile` as the renderer needs it (Decree 30/2020 Appendix I as data, BR-DOC-13). */
export interface LayoutProfile {
  code: string;
  revision: number;
  pageSize: 'A4';
  marginsMm: { top: number; bottom: number; left: number; right: number };
  fontFamily: string;
  fontSubstitute?: string;
  elementStyles: Record<ElementName, ElementStyle>;
  signatureLayout: SignatureLayout;
  numberFieldLayout: NumberFieldLayout;
  watermarkPolicy: WatermarkPolicy;
  confirmationStatus: 'CONFIRMED' | 'PENDING_CONFIRMATION';
}

interface Range {
  min: number;
  max: number;
}

const MARGIN_RANGES: Readonly<Record<keyof LayoutProfile['marginsMm'], Range>> = {
  top: { min: 20, max: 25 },
  bottom: { min: 20, max: 25 },
  left: { min: 30, max: 35 },
  right: { min: 15, max: 20 },
};

const SIZE_RANGES: Readonly<Record<ElementName, Range>> = {
  nationalTitle: { min: 12, max: 13 },
  motto: { min: 13, max: 14 },
  agency: { min: 12, max: 13 },
  number: { min: 13, max: 14 },
  placeDate: { min: 13, max: 14 },
  docTypeName: { min: 13, max: 14 },
  summary: { min: 13, max: 14 },
  body: { min: 13, max: 14 },
  signerTitle: { min: 13, max: 14 },
  signerName: { min: 13, max: 14 },
  recipientsLabel: { min: 12, max: 12 },
  recipientsList: { min: 11, max: 11 },
  pageNumber: { min: 13, max: 14 },
};

const ELEMENT_NAMES = Object.keys(SIZE_RANGES) as ElementName[];

const style = (sizePt: number, flags: Partial<Omit<ElementStyle, 'sizePt'>> = {}): ElementStyle => ({
  sizePt,
  bold: flags.bold ?? false,
  italic: flags.italic ?? false,
  uppercase: flags.uppercase ?? false,
});

/** The default profile of the table of BR-DOC-13 (legal text still to be confirmed against the original: CXN-DOC-01). */
export const ND30_A4_STANDARD: LayoutProfile = {
  code: 'ND30_A4_STANDARD',
  revision: 1,
  pageSize: 'A4',
  marginsMm: { top: 20, bottom: 20, left: 30, right: 15 },
  fontFamily: 'Times New Roman',
  fontSubstitute: 'Tinos',
  elementStyles: {
    nationalTitle: style(13, { bold: true, uppercase: true }),
    motto: style(14, { bold: true }),
    agency: style(13, { bold: true, uppercase: true }),
    number: style(13),
    placeDate: style(14, { italic: true }),
    docTypeName: style(14, { bold: true, uppercase: true }),
    summary: style(14, { bold: true }),
    body: style(14),
    signerTitle: style(14, { bold: true, uppercase: true }),
    signerName: style(14, { bold: true }),
    recipientsLabel: style(12, { bold: true, italic: true }),
    recipientsList: style(11),
    pageNumber: style(14),
  },
  signatureLayout: {
    leaderBox: { xMm: 110, yMm: 215, widthMm: 70, heightMm: 40 },
    sealBox: { xMm: 95, yMm: 225, widthMm: 40, heightMm: 40 },
  },
  numberFieldLayout: {
    number: { xMm: 30, yMm: 42, widthMm: 40, heightMm: 6 },
    symbol: { xMm: 70, yMm: 42, widthMm: 50, heightMm: 6 },
    date: { xMm: 125, yMm: 50, widthMm: 60, heightMm: 6 },
  },
  // The watermark of BR-DOC-10 is Vietnamese ("awaiting confirmation"); escaped so the source stays English-only.
  watermarkPolicy: { text: 'CHO X\u00c1C NH\u1eacN' },
  confirmationStatus: 'PENDING_CONFIRMATION',
};

function outOfRange(field: string): DomainError {
  return new DomainError('LAYOUT_OUT_OF_LEGAL_RANGE', 422, field);
}

function stateInvalid(field: string): DomainError {
  return new DomainError('LAYOUT_STATE_INVALID', 409, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BOX_FIELDS = ['xMm', 'yMm', 'widthMm', 'heightMm'] as const;

/** A box of the signature or number layout must be an object of four finite numbers: the renderer and the form place it. */
function assertBox(value: unknown, field: string): void {
  if (!isRecord(value) || BOX_FIELDS.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw stateInvalid(field);
}

/**
 * Refuses a profile whose margins or sizes leave the ranges of BR-DOC-13 (a profile is data: this is the guard). A member
 * of the stored JSON that is not the object it should be is LAYOUT_STATE_INVALID, never a native error.
 */
export function assertLayoutWithinLegalRange(profile: LayoutProfile): void {
  if (profile.pageSize !== 'A4') throw outOfRange('pageSize');
  for (const [name, range] of Object.entries(MARGIN_RANGES) as [keyof LayoutProfile['marginsMm'], Range][]) {
    const value = profile.marginsMm[name];
    if (!Number.isFinite(value) || value < range.min || value > range.max) throw outOfRange(`marginsMm.${name}`);
  }
  if (!isRecord(profile.elementStyles)) throw stateInvalid('elementStyles');
  for (const name of ELEMENT_NAMES) {
    const element = profile.elementStyles[name] as unknown;
    if (element === undefined) throw outOfRange(`elementStyles.${name}`);
    if (!isRecord(element)) throw stateInvalid(`elementStyles.${name}`);
    const range = SIZE_RANGES[name];
    const size = element.sizePt;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < range.min || size > range.max) {
      throw outOfRange(`elementStyles.${name}.sizePt`);
    }
  }
  if (!isRecord(profile.signatureLayout)) throw stateInvalid('signatureLayout');
  for (const name of ['leaderBox', 'sealBox'] as const) assertBox(profile.signatureLayout[name], `signatureLayout.${name}`);
  if (!isRecord(profile.numberFieldLayout)) throw stateInvalid('numberFieldLayout');
  for (const name of ['number', 'symbol', 'date'] as const) assertBox(profile.numberFieldLayout[name], `numberFieldLayout.${name}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DomainError('LAYOUT_STATE_INVALID', 409, field);
  return value as Record<string, unknown>;
}

/** The columns of a `document_layout_profile` row (jsonb already parsed). */
export interface LayoutProfileRow {
  profile_code: string;
  revision: number;
  page_size: string;
  margins_mm: unknown;
  font_family: string;
  font_substitute?: string | null;
  element_styles: unknown;
  signature_layout: unknown;
  number_field_layout: unknown;
  watermark_policy: unknown;
  confirmation_status: string;
}

/** Maps a stored row to a profile and applies the legal range guard; a malformed row is LAYOUT_STATE_INVALID. */
export function layoutProfileOf(row: LayoutProfileRow): LayoutProfile {
  const margins = record(row.margins_mm, 'margins_mm');
  const profile: LayoutProfile = {
    code: row.profile_code,
    revision: row.revision,
    pageSize: row.page_size as 'A4',
    marginsMm: {
      top: Number(margins.top),
      bottom: Number(margins.bottom),
      left: Number(margins.left),
      right: Number(margins.right),
    },
    fontFamily: row.font_family,
    ...(row.font_substitute === undefined || row.font_substitute === null ? {} : { fontSubstitute: row.font_substitute }),
    elementStyles: record(row.element_styles, 'element_styles') as Record<ElementName, ElementStyle>,
    signatureLayout: record(row.signature_layout, 'signature_layout') as unknown as SignatureLayout,
    numberFieldLayout: record(row.number_field_layout, 'number_field_layout') as unknown as NumberFieldLayout,
    watermarkPolicy: { text: String(record(row.watermark_policy, 'watermark_policy').text ?? '') },
    confirmationStatus: row.confirmation_status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
  };
  assertLayoutWithinLegalRange(profile);
  return profile;
}
