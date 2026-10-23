import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFHexString, PDFName, PDFString, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, PDFRef } from 'pdf-lib';
import { documentIdOf } from '@machvon/kernel';
import type { Box, ElementName, LayoutProfile, PdfRenderer, RenderContent, RenderRequest, RenderedPdf } from '@machvon/kernel';

/** Identifies the drawing code, the libraries and the fonts: every change of the bytes of a render bumps it. */
export const RENDERER_VERSION = 'machvon-pdf/1.0.1 pdf-lib/1.17.1 tinos/1';

const POINTS_PER_MM = 72 / 25.4;
// ISO 216 A4 in points, as pdf-lib's own PageSizes.A4 rounds it.
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const LINE_HEIGHT = 1.3;
const HEADER_GAP_MM = 2;
const PARAGRAPH_GAP_LINES = 0.5;
const WATERMARK_SIZE_PT = 64;
const WATERMARK_OPACITY = 0.15;
const FONT_FILES = { regular: 'Tinos-Regular.ttf', bold: 'Tinos-Bold.ttf', italic: 'Tinos-Italic.ttf' } as const;
const FONT_DIRECTORY_ENV = 'MACHVON_DOC_RESOURCES';
const RESOURCE_CANDIDATES = [
  ['src', 'modules', 'doc'],
  ['apps', 'api', 'src', 'modules', 'doc'],
] as const;

export interface FontSet {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
}

/** The fixed words of a state document that the template does not carry (resources/state-text.json). */
export interface StateText {
  nationalTitle: string;
  motto: string;
  numberPrefix: string;
  placeDateFormat: string;
  recipientsLabel: string;
  recipientBullet: string;
  pageNumberFormat: string;
}

export interface RendererResources {
  fonts: FontSet;
  text: StateText;
}

/**
 * The directory that holds `fonts/` and `state-text.json`: `MACHVON_DOC_RESOURCES`, or the module directory found
 * from the working directory of the process (the repository root or the API package).
 */
export function resourceDirectory(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [...(env[FONT_DIRECTORY_ENV] === undefined ? [] : [env[FONT_DIRECTORY_ENV]]), ...RESOURCE_CANDIDATES.map((parts) => join(cwd, ...parts))];
  const found = candidates.find((directory) => directory !== undefined && existsSync(join(directory, 'fonts', FONT_FILES.regular)));
  if (found === undefined) throw new Error(`document renderer resources not found (set ${FONT_DIRECTORY_ENV})`);
  return resolve(found);
}

export function loadRendererResources(directory: string = resourceDirectory()): RendererResources {
  const font = (file: string): Uint8Array => new Uint8Array(readFileSync(join(directory, 'fonts', file)));
  const text = JSON.parse(readFileSync(join(directory, 'state-text.json'), 'utf8')) as StateText;
  return { fonts: { regular: font(FONT_FILES.regular), bold: font(FONT_FILES.bold), italic: font(FONT_FILES.italic) }, text };
}

export const mmToPt = (millimetres: number): number => millimetres * POINTS_PER_MM;

/** Where text goes on the page, from the margins of the layout profile (points, origin at the bottom left like PDF). */
export function pageMetrics(profile: LayoutProfile): { left: number; right: number; top: number; bottom: number; contentWidth: number } {
  const left = mmToPt(profile.marginsMm.left);
  const right = A4_WIDTH_PT - mmToPt(profile.marginsMm.right);
  return { left, right, top: A4_HEIGHT_PT - mmToPt(profile.marginsMm.top), bottom: mmToPt(profile.marginsMm.bottom), contentWidth: right - left };
}

// Tinos has no bold italic cut: an element that is both is drawn bold.
interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface Pen {
  font: PDFFont;
  size: number;
  upper: boolean;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ').filter((part) => part.length > 0)) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The drawing of one document: a cursor over pages, with the layout profile deciding every size and margin. */
class Drawing {
  private readonly pdf: PDFDocument;
  private readonly profile: LayoutProfile;
  private readonly fonts: Fonts;
  private readonly text: StateText;
  private readonly watermark: string | null;
  private readonly metrics: ReturnType<typeof pageMetrics>;
  private readonly signable: boolean;
  private page: PDFPage;
  /** The page the signer block was drawn on (the signature fields belong there); the last page when the document has no signer. */
  private signerPage: PDFPage | undefined;
  private cursor: number;

  /**
   * `signable` is a rendering that carries the signature form (revision 0): the number, the symbol and the date are
   * written into the form fields by the numbering revision, so their regions stay empty here. Text drawn under a field
   * could not be removed after the signature without breaking it.
   */
  constructor(pdf: PDFDocument, profile: LayoutProfile, fonts: Fonts, text: StateText, watermark: string | null, signable = false) {
    this.signable = signable;
    this.pdf = pdf;
    this.profile = profile;
    this.fonts = fonts;
    this.text = text;
    this.watermark = watermark;
    this.metrics = pageMetrics(profile);
    this.page = this.startPage();
    this.cursor = this.metrics.top;
  }

  private pen(element: ElementName): Pen {
    const style = this.profile.elementStyles[element];
    return { font: style.bold ? this.fonts.bold : style.italic ? this.fonts.italic : this.fonts.regular, size: style.sizePt, upper: style.uppercase };
  }

  private startPage(): PDFPage {
    const page = this.pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    if (this.watermark !== null) {
      const font = this.fonts.bold;
      const width = font.widthOfTextAtSize(this.watermark, WATERMARK_SIZE_PT);
      // Centred on the page and turned 45 degrees: the pivot of the rotation is the start of the text.
      const shift = (width / 2) * Math.SQRT1_2;
      page.drawText(this.watermark, {
        x: A4_WIDTH_PT / 2 - shift,
        y: A4_HEIGHT_PT / 2 - shift,
        size: WATERMARK_SIZE_PT,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: WATERMARK_OPACITY,
        rotate: degrees(45),
      });
    }
    const pageNumber = this.pdf.getPageCount();
    if (pageNumber > 1) {
      // BR-DOC-13: from the second page the number is centred in the top margin.
      const pen = this.pen('pageNumber');
      const label = this.text.pageNumberFormat.replace('{page}', String(pageNumber));
      const width = pen.font.widthOfTextAtSize(label, pen.size);
      page.drawText(label, { x: (A4_WIDTH_PT - width) / 2, y: A4_HEIGHT_PT - mmToPt(this.profile.marginsMm.top) / 2 - pen.size / 2, size: pen.size, font: pen.font });
    }
    return page;
  }

  private ensureSpace(height: number): void {
    if (this.cursor - height >= this.metrics.bottom) return;
    this.page = this.startPage();
    this.cursor = this.metrics.top;
  }

  private shown(text: string, pen: Pen): string {
    return pen.upper ? text.toUpperCase() : text;
  }

  /** Draws centred text inside a column and returns the height it used. */
  private centred(text: string, element: ElementName, columnLeft: number, columnWidth: number, top: number): number {
    const pen = this.pen(element);
    let used = 0;
    for (const line of wrap(this.shown(text, pen), pen.font, pen.size, columnWidth)) {
      const width = pen.font.widthOfTextAtSize(line, pen.size);
      this.page.drawText(line, { x: columnLeft + (columnWidth - width) / 2, y: top - used - pen.size, size: pen.size, font: pen.font });
      used += pen.size * LINE_HEIGHT;
    }
    return used;
  }

  /** Draws left-aligned text in a box of the profile, wrapped to the width of the box; returns the height it used (points). */
  private atBox(text: string, element: ElementName, box: Box): number {
    const pen = this.pen(element);
    const lines = wrap(this.shown(text, pen), pen.font, pen.size, mmToPt(box.widthMm));
    lines.forEach((line, index) => {
      this.page.drawText(line, { x: mmToPt(box.xMm), y: A4_HEIGHT_PT - mmToPt(box.yMm) - pen.size - index * pen.size * LINE_HEIGHT, size: pen.size, font: pen.font });
    });
    return lines.length * pen.size * LINE_HEIGHT;
  }

  /** The page that carries the signature fields: the page of the signer block, else the last page. */
  get signaturePage(): PDFPage {
    return this.signerPage ?? this.pdf.getPage(this.pdf.getPageCount() - 1);
  }

  header(content: RenderContent): void {
    const { left, contentWidth } = this.metrics;
    const leftWidth = contentWidth * 0.42;
    const rightLeft = left + contentWidth * 0.42;
    const rightWidth = contentWidth * 0.58;
    const top = this.cursor;
    let leftUsed = 0;
    if (content.parentAgency !== null) leftUsed += this.centred(content.parentAgency, 'agency', left, leftWidth, top);
    leftUsed += this.centred(content.agency, 'agency', left, leftWidth, top - leftUsed);
    let rightUsed = this.centred(this.text.nationalTitle, 'nationalTitle', rightLeft, rightWidth, top);
    rightUsed += this.centred(this.text.motto, 'motto', rightLeft, rightWidth, top - rightUsed);
    const rule = this.pen('motto');
    const mottoWidth = rule.font.widthOfTextAtSize(this.text.motto, rule.size);
    const ruleY = top - rightUsed;
    this.page.drawLine({
      start: { x: rightLeft + (rightWidth - mottoWidth) / 2, y: ruleY },
      end: { x: rightLeft + (rightWidth + mottoWidth) / 2, y: ruleY },
      thickness: 0.5,
    });
    // The number and the date sit where the profile puts them, pushed down together when a long agency name needs the room.
    const headerBottomMm = (A4_HEIGHT_PT - (top - Math.max(leftUsed, rightUsed))) / POINTS_PER_MM;
    const { number, date } = this.profile.numberFieldLayout;
    const shift = Math.max(0, headerBottomMm + HEADER_GAP_MM - number.yMm);
    const numberUsed = this.signable ? 0 : this.atBox(content.numberText, 'number', { ...number, yMm: number.yMm + shift });
    const dateUsed = this.signable ? 0 : this.atBox(content.placeDate, 'placeDate', { ...date, yMm: date.yMm + shift });
    // The region of each line is its box, or the taller wrapped text that was drawn in it.
    const bottomOf = (box: Box, used: number): number => box.yMm + shift + Math.max(box.heightMm, used / POINTS_PER_MM);
    this.cursor = A4_HEIGHT_PT - mmToPt(Math.max(bottomOf(number, numberUsed), bottomOf(date, dateUsed)) + HEADER_GAP_MM);
  }

  titleBlock(content: RenderContent): void {
    const { left, contentWidth } = this.metrics;
    this.cursor -= this.centred(content.docTypeName, 'docTypeName', left, contentWidth, this.cursor);
    if (content.summary !== null) this.cursor -= this.centred(content.summary, 'summary', left, contentWidth, this.cursor);
    this.cursor -= mmToPt(4);
  }

  body(content: RenderContent): void {
    const { left, contentWidth } = this.metrics;
    for (const block of content.blocks) {
      const pen = block.kind === 'heading' ? { ...this.pen('body'), font: this.fonts.bold } : this.pen('body');
      const height = pen.size * LINE_HEIGHT;
      for (const line of wrap(this.shown(block.text, pen), pen.font, pen.size, contentWidth)) {
        this.ensureSpace(height);
        this.page.drawText(line, { x: left, y: this.cursor - pen.size, size: pen.size, font: pen.font });
        this.cursor -= height;
      }
      this.cursor -= height * PARAGRAPH_GAP_LINES;
    }
  }

  footer(content: RenderContent): void {
    const { left, right, contentWidth } = this.metrics;
    const signerWidth = Math.min(mmToPt(this.profile.signatureLayout.leaderBox.widthMm), contentWidth);
    const signerLeft = right - signerWidth;
    const titlePen = this.pen('signerTitle');
    const namePen = this.pen('signerName');
    const gap = mmToPt(this.profile.signatureLayout.leaderBox.heightMm);
    const recipientsPen = this.pen('recipientsList');
    const labelPen = this.pen('recipientsLabel');
    // Only the label and the first recipient have to fit where the block starts; the rest of the list breaks over pages.
    const recipientsHead = content.recipients.length === 0 ? 0 : (labelPen.size + recipientsPen.size) * LINE_HEIGHT;
    const signerHeight = content.signerTitle === null ? 0 : titlePen.size * LINE_HEIGHT * 2 + gap + namePen.size * LINE_HEIGHT;
    this.ensureSpace(Math.max(signerHeight, recipientsHead) + mmToPt(4));
    const top = this.cursor - mmToPt(4);
    this.signerPage = this.page;
    if (content.signerTitle !== null) {
      let used = this.centred(content.signerTitle, 'signerTitle', signerLeft, signerWidth, top);
      used += gap;
      if (content.signerName !== null) this.centred(content.signerName, 'signerName', signerLeft, signerWidth, top - used);
    }
    if (content.recipients.length > 0) {
      this.page.drawText(this.text.recipientsLabel, { x: left, y: top - labelPen.size, size: labelPen.size, font: labelPen.font });
      let y = top - labelPen.size * LINE_HEIGHT;
      const lineHeight = recipientsPen.size * LINE_HEIGHT;
      for (const recipient of content.recipients) {
        if (y - lineHeight < this.metrics.bottom) {
          this.page = this.startPage();
          y = this.metrics.top;
        }
        this.page.drawText(`${this.text.recipientBullet}${recipient}`, { x: left, y: y - recipientsPen.size, size: recipientsPen.size, font: recipientsPen.font });
        y -= lineHeight;
      }
    }
  }
}

const FIELD_FONT_SIZE_PT = 10;
const WIDGET_PRINT_FLAG = 4;
const SIG_FLAGS_SIGNATURES_EXIST_AND_APPEND_ONLY = 3;

function rectOf(box: Box): number[] {
  const left = mmToPt(box.xMm);
  const top = A4_HEIGHT_PT - mmToPt(box.yMm);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return [round(left), round(top - mmToPt(box.heightMm)), round(left + mmToPt(box.widthMm)), round(top)];
}

/**
 * The AcroForm of revision 0 (BR-DOC-14 a): the empty text fields numbering fills in and the two signature fields, placed
 * by the layout profile. The number fields sit on the first page, the signature fields on the page of the signer block.
 */
function addSignatureForm(pdf: PDFDocument, layout: LayoutProfile, signaturePage: PDFPage): void {
  const { context } = pdf;
  const first = pdf.getPage(0);
  const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const widget = (name: string, kind: 'Tx' | 'Sig', page: PDFPage, box: Box): PDFRef => {
    const entries = { Type: 'Annot', Subtype: 'Widget', FT: kind, T: PDFString.of(name), F: WIDGET_PRINT_FLAG, P: page.ref, Rect: rectOf(box) };
    const ref = context.register(context.obj(kind === 'Tx' ? { ...entries, DA: PDFString.of(`/F1 ${FIELD_FONT_SIZE_PT} Tf 0 g`) } : entries));
    page.node.addAnnot(ref);
    return ref;
  };
  const { number, symbol, date } = layout.numberFieldLayout;
  const fields = [
    widget('doc_number', 'Tx', first, number),
    widget('doc_symbol', 'Tx', first, symbol),
    widget('doc_date', 'Tx', first, date),
    widget('sig_leader', 'Sig', signaturePage, layout.signatureLayout.leaderBox),
    widget('sig_org', 'Sig', signaturePage, layout.signatureLayout.sealBox),
  ];
  const form = context.register(
    context.obj({ Fields: fields, SigFlags: SIG_FLAGS_SIGNATURES_EXIST_AND_APPEND_ONLY, DA: PDFString.of('/F1 0 Tf 0 g'), DR: { Font: { F1: font } } }),
  );
  pdf.catalog.set(PDFName.of('AcroForm'), form);
}

/** The instant 00:00 on the as-of date in Vietnam (UTC+7): the `CreationDate` of the PDF. */
function creationDateOf(asOfDate: string): Date {
  const date = new Date(`${asOfDate}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) throw new RangeError('as-of date is not a calendar date');
  return date;
}

/**
 * The `pdf-lib` adapter of the rendering port (F14, BR-DOC-12). The same request gives the same bytes: no clock (the
 * dates come from the as-of date), no randomness (the font subset tag is fixed and the file identifier is the first
 * 16 bytes of the input hash), no locale or time zone dependent call.
 */
export class PdfLibRenderer implements PdfRenderer {
  readonly rendererVersion = RENDERER_VERSION;
  private readonly resources: RendererResources;

  constructor(resources: RendererResources = loadRendererResources()) {
    this.resources = resources;
  }

  async render(request: RenderRequest): Promise<RenderedPdf> {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const created = creationDateOf(request.asOfDate);
    pdf.setTitle(request.content.docTypeName);
    pdf.setProducer(RENDERER_VERSION);
    pdf.setCreator(RENDERER_VERSION);
    pdf.setCreationDate(created);
    pdf.setModificationDate(created);
    const id = PDFHexString.of(documentIdOf(request.inputHash));
    pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);
    const fonts: Fonts = {
      regular: await pdf.embedFont(this.resources.fonts.regular, { subset: true, customName: 'Tinos-Regular' }),
      bold: await pdf.embedFont(this.resources.fonts.bold, { subset: true, customName: 'Tinos-Bold' }),
      italic: await pdf.embedFont(this.resources.fonts.italic, { subset: true, customName: 'Tinos-Italic' }),
    };
    const drawing = new Drawing(pdf, request.layout, fonts, this.resources.text, request.watermarkText, request.signatureFields === true);
    drawing.header(request.content);
    drawing.titleBlock(request.content);
    drawing.body(request.content);
    drawing.footer(request.content);
    if (request.signatureFields === true) addSignatureForm(pdf, request.layout, drawing.signaturePage);
    const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rendererVersion: RENDERER_VERSION,
      fontSubstitute: request.layout.fontSubstitute ?? null,
      pageCount: pdf.getPageCount(),
    };
  }
}
