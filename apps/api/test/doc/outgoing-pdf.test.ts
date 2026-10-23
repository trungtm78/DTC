import { createHash } from 'node:crypto';
import { DomainError } from '@machvon/kernel';
import { applyNumbering } from '../../src/modules/doc/numbering-revision';
import { verifyPdfSignatures } from '../../src/modules/doc/pades-verifier';
import { describePdf } from '../../src/modules/doc/pdf-incremental';
import { dictionaryOf, nameOf, textOf } from '../../src/modules/doc/pdf-objects';
import { PdfLibRenderer } from '../../src/modules/doc/pdf-renderer';
import { revisionZero, signField } from './support/pdf-fixture';
import { NOW, SIGNED_AT, createWorld } from './support/pki-world';
import type { World } from './support/pki-world';
import { sampleRequest } from './render-fixture';

jest.setTimeout(60_000);

const VALUES = { docNumber: '05', docSymbol: '05/QĐ-UBND', docDate: '23/10/2026' };
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function renderedWithFields(): Promise<Buffer> {
  const rendered = await new PdfLibRenderer().render({ ...sampleRequest(), signatureFields: true });
  return Buffer.from(rendered.bytes);
}

function fieldNames(pdf: Uint8Array): Map<string, { type: string | null; hasValue: boolean }> {
  const found = new Map<string, { type: string | null; hasValue: boolean }>();
  for (const value of describePdf(pdf).objects.values()) {
    const dictionary = dictionaryOf(value);
    const name = textOf(dictionary?.get('T'));
    if (dictionary !== null && name !== null) found.set(name, { type: nameOf(dictionary.get('FT')), hasValue: dictionary.has('V') });
  }
  return found;
}

describe('revision 0 with the signature form (BR-DOC-14 a)', () => {
  it('carries the three number fields and the two signature fields, all empty, in a classic file', async () => {
    const pdf = await renderedWithFields();
    expect(fieldNames(pdf)).toEqual(
      new Map([
        ['doc_number', { type: 'Tx', hasValue: false }],
        ['doc_symbol', { type: 'Tx', hasValue: false }],
        ['doc_date', { type: 'Tx', hasValue: false }],
        ['sig_leader', { type: 'Sig', hasValue: false }],
        ['sig_org', { type: 'Sig', hasValue: false }],
      ]),
    );
    expect(pdf.toString('latin1')).not.toContain('/Type /XRef');
  });

  it('is the same bytes for the same input and a different file from the one without the form', async () => {
    const first = await renderedWithFields();
    expect((await renderedWithFields()).equals(first)).toBe(true);
    const plain = await new PdfLibRenderer().render(sampleRequest());
    expect(Buffer.from(plain.bytes).equals(first)).toBe(false);
    expect(fieldNames(plain.bytes).size).toBe(0);
  });
});

describe('numbering revision (BR-DOC-14 c)', () => {
  let world: World;
  beforeAll(async () => {
    world = await createWorld();
  });

  it('keeps every byte of the earlier revisions and records their hash', async () => {
    const pdf = await renderedWithFields();
    const numbered = applyNumbering(pdf, VALUES);
    expect(numbered.prefixSha256).toBe(sha256(pdf));
    expect(sha256(numbered.pdf.subarray(0, pdf.length))).toBe(sha256(pdf));
    expect(numbered.pdf.length).toBeGreaterThan(pdf.length);
  });

  it('fills the three fields and leaves the signature fields empty', async () => {
    const numbered = applyNumbering(await renderedWithFields(), VALUES).pdf;
    const names = fieldNames(numbered);
    for (const name of ['doc_number', 'doc_symbol', 'doc_date']) expect(names.get(name)?.hasValue).toBe(true);
    for (const name of ['sig_leader', 'sig_org']) expect(names.get(name)?.hasValue).toBe(false);
  });

  it('keeps the leader signature valid and inside the allowed changes', async () => {
    const signed = await signField(await renderedWithFields(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
    const numbered = applyNumbering(signed, VALUES).pdf;
    const report = await verifyPdfSignatures(numbered, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures).toHaveLength(1);
    expect(report.signatures[0]).toMatchObject({ role: 'LEADER', status: 'VALID', incrementalChangesAllowed: true });
  });

  it('ends sealed: leader, number and seal give two valid signatures and the whole file is covered', async () => {
    const leader = await signField(await renderedWithFields(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
    const numbered = applyNumbering(leader, VALUES).pdf;
    world.setTime(new Date('2026-10-23T08:30:00Z'));
    const sealed = await signField(numbered, { field: 'sig_org', identity: world.organization, signingTime: new Date('2026-10-23T08:30:00Z'), timestamps: world.tsa });
    const report = await verifyPdfSignatures(sealed, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures.map((signature) => [signature.role, signature.status, signature.incrementalChangesAllowed])).toEqual([
      ['LEADER', 'VALID', true],
      ['ORGANIZATION', 'VALID', true],
    ]);
    expect(report.signatures[1]?.coversEndOffset).toBe(sealed.length);
    expect(sha256(sealed.subarray(0, leader.length))).toBe(sha256(leader));
  });

  it('refuses a file without the fields, with a value already, or numbered twice', async () => {
    const code = (work: () => unknown): string | undefined => {
      try {
        work();
      } catch (error) {
        return error instanceof DomainError ? error.code : String(error);
      }
      return undefined;
    };
    const plain = Buffer.from((await new PdfLibRenderer().render(sampleRequest())).bytes);
    expect(code(() => applyNumbering(plain, VALUES))).toBe('INCREMENTAL_UPDATE_FAILED');
    const once = applyNumbering(revisionZero(), VALUES).pdf;
    expect(code(() => applyNumbering(once, VALUES))).toBe('INCREMENTAL_UPDATE_FAILED');
  });

  it('shows a crossed D and any other character the font lacks without breaking the stream', () => {
    const numbered = applyNumbering(revisionZero(), { docNumber: '5', docSymbol: 'Đ(1)\\ ệ', docDate: '1/1/2027' }).pdf.toString('latin1');
    expect(numbered).toContain(`(\u0080\\(1\\)\\\\ ?) Tj`);
  });
});
