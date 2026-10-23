import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signDevToken } from './dev-token';

const KEY_BYTES = Buffer.alloc(32, 7);
const KEY = KEY_BYTES.toString('base64');
const CONTEXT = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  membershipId: '00000000-0000-4000-8000-0000000000f1',
  scopeVersion: 1,
};

describe('signDevToken', () => {
  it('produces the format of the server-side signed tenant context: base64url(payload).base64url(hmac-sha256)', async () => {
    const token = await signDevToken(CONTEXT, KEY, () => 1_000);
    const [payloadPart, signaturePart, rest] = token.split('.');
    expect(rest).toBeUndefined();
    expect(JSON.parse(Buffer.from(payloadPart ?? '', 'base64url').toString('utf8'))).toEqual({ ...CONTEXT, exp: 1_300 });
    const expected = createHmac('sha256', KEY_BYTES).update(payloadPart ?? '').digest('base64url');
    expect(signaturePart).toBe(expected);
  });

  it('carries the assurance claims when they are given and omits them otherwise', async () => {
    const at = new Date('2026-10-23T01:00:00Z');
    const withClaims = await signDevToken({ ...CONTEXT, aal: 'aal2', aal2At: at }, KEY, () => 1_000);
    expect(JSON.parse(Buffer.from(withClaims.split('.')[0] ?? '', 'base64url').toString('utf8'))).toEqual({ ...CONTEXT, exp: 1_300, aal: 'aal2', aal2At: at.toISOString() });
    const plain = await signDevToken(CONTEXT, KEY, () => 1_000);
    expect(JSON.parse(Buffer.from(plain.split('.')[0] ?? '', 'base64url').toString('utf8'))).not.toHaveProperty('aal');
  });

  it('lets the lifetime be set', async () => {
    const token = await signDevToken(CONTEXT, KEY, () => 50, 60);
    expect(JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')).exp).toBe(110);
  });

  it('refuses a key shorter than 32 bytes', async () => {
    await expect(signDevToken(CONTEXT, Buffer.alloc(8).toString('base64'))).rejects.toThrow('key');
  });
});
