import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import vi from '../src/i18n/vi.json' with { type: 'json' };
import { sql, stackInfo } from './support/stack.ts';

/**
 * DOC-05, DOC-06 and DOC-07 in a real browser against the real API and database (apps/api/test/e2e-stack): the leader signs a
 * document, the clerk numbers it and puts the organisation seal on it, and the verification screen shows both signatures. The
 * stack signs with a test authority through the MOCK adapter, which approves by itself, and trusts that authority's root.
 * The flow works on a document of its own, so the documents the visual cases read keep their state.
 */

async function open(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}devUser=owner`);
  await page.waitForSelector('[data-screen-id], [role="alert"], [role="status"]');
}

interface DocumentRow {
  status: string;
  version: string;
  document_number: number | null;
  symbol: string | null;
  stages: string[];
}

async function stateOf(outgoingId: string): Promise<DocumentRow> {
  const [row] = await sql<{ status: string; version: string; document_number: number | null; symbol: string | null; document_id: string }>(
    'select o.status, o.version::text as version, d.document_number, d.symbol, o.document_id from machvon.outgoing_document o join machvon.document d on d.id = o.document_id where o.id = $1',
    [outgoingId],
  );
  if (row === undefined) throw new Error('no such document');
  const stages = await sql<{ stage: string }>('select stage from machvon.document_version where document_id = $1 order by version', [row.document_id]);
  return { status: row.status, version: row.version, document_number: row.document_number, symbol: row.symbol, stages: stages.map((entry) => entry.stage) };
}

test.describe('DOC-05 leader signing, DOC-06 numbering and seal, DOC-07 verification', () => {
  test('the leader signs, the clerk numbers and seals, and both signatures verify', async ({ page }) => {
    const id = stackInfo().documents.flowSubmitted;
    expect((await stateOf(id)).status).toBe('SUBMITTED');

    await open(page, `/doc/doc-05?doc=${id}`);
    await expect(page.getByRole('heading', { level: 1, name: vi['doc.signing.page.title'] })).toBeVisible();
    await expect(page.locator('[data-check="certificate"]')).toHaveAttribute('data-state', 'pass');
    await page.getByRole('button', { name: vi['doc.signing.start.action'] }).click();
    await expect(page.getByRole('button', { name: vi['doc.signing.complete.action'] })).toBeVisible();
    expect((await stateOf(id)).status).toBe('SUBMITTED');
    await expect(page.locator('[data-check="session"]')).toHaveAttribute('data-state', 'pass');
    await expect(page.locator('[data-check="adapter"]')).toContainText(vi['doc.outgoing.adapterStatus.mock']);

    await page.getByRole('button', { name: vi['doc.signing.complete.action'] }).click();
    await expect(page.getByText(vi['doc.signing.signed.notice'])).toBeVisible();
    expect(await stateOf(id)).toMatchObject({ status: 'SIGNED', stages: ['RENDERED_FINAL', 'LEADER_SIGNED'] });

    await page.getByText(vi['doc.signing.signed.number.link']).click();
    await expect(page.getByRole('heading', { level: 1, name: vi['doc.outgoing.page.title'] })).toBeVisible();
    await expect(page.getByLabel(vi['doc.outgoing.symbol.label'], { exact: true })).toHaveValue(/^\d{2}\/QD-UBND$/);
    await page.getByRole('button', { name: vi['doc.outgoing.assign.action'] }).click();
    await expect(page.getByText(/^Đã cấp số \d{2}, ký hiệu \d{2}\/QD-UBND\.$/)).toBeVisible();
    const numbered = await stateOf(id);
    expect(numbered).toMatchObject({ status: 'NUMBERED', stages: ['RENDERED_FINAL', 'LEADER_SIGNED', 'NUMBERED'] });
    expect(numbered.symbol).toMatch(/^\d{2}\/QD-UBND$/);

    await page.getByRole('button', { name: vi['doc.outgoing.seal.action'] }).click();
    await page.getByRole('button', { name: vi['doc.outgoing.sealComplete.action'] }).click();
    await expect(page.getByText(vi['doc.outgoing.sealed.notice'])).toBeVisible();
    expect(await stateOf(id)).toMatchObject({ status: 'SEALED', stages: ['RENDERED_FINAL', 'LEADER_SIGNED', 'NUMBERED', 'ORG_SEALED'] });

    await page.getByText(vi['doc.outgoing.sealed.verify.link']).click();
    await expect(page.getByRole('heading', { level: 1, name: vi['doc.signatureReport.page.title'] })).toBeVisible();
    await expect(page.locator('[data-signature-index]')).toHaveCount(2);
    await expect(page.locator('[data-signature-index="0"]')).toContainText(vi['doc.signatureReport.role.leader']);
    await expect(page.locator('[data-signature-index="1"]')).toContainText(vi['doc.signatureReport.role.organization']);

    const audited = await sql<{ action: string }>("select action from machvon.audit_event where resource_id = $1 and action like 'outgoing_document.%'", [id]);
    expect(audited.map((row) => row.action).sort()).toEqual([
      'outgoing_document.leader_signing.complete',
      'outgoing_document.leader_signing.start',
      'outgoing_document.number',
      'outgoing_document.organization_seal.complete',
      'outgoing_document.organization_seal.start',
    ]);
  });

  test('the numbering screen of a signed document shows its steps and the next number, and changes nothing', async ({ page }) => {
    const id = stackInfo().documents.visualSigned;
    await open(page, `/doc/doc-06?doc=${id}`);
    await expect(page.locator('[data-step]')).toHaveCount(7);
    await expect(page.locator('[data-step="register"]')).toHaveAttribute('data-state', 'current');
    await expect(page.getByLabel(vi['doc.outgoing.register.label'], { exact: true })).toContainText('UBND');
    expect((await stateOf(id)).status).toBe('SIGNED');
  });

  test('a date in a year without an open register leaves nothing to number with', async ({ page }) => {
    const id = stackInfo().documents.visualSigned;
    await open(page, `/doc/doc-06?doc=${id}`);
    await page.getByLabel(vi['doc.outgoing.date.label'], { exact: true }).fill('2999-01-01');
    await expect(page.getByText(vi['doc.outgoing.register.none'])).toBeVisible();
    await expect(page.getByRole('button', { name: vi['doc.outgoing.assign.action'] })).toBeDisabled();
    expect((await stateOf(id)).status).toBe('SIGNED');
  });
});
