import { randomUUID } from 'node:crypto';
import { MockInvitationMailer } from '../src/modules/adm/invitation-mailer';
import { createInvitationToken, hashEmail, hashInvitationToken, parseInvitationToken, sameHash } from '../src/modules/adm/invitation-token';

describe('invitation token', () => {
  const tenantId = randomUUID();

  it('carries its tenant and is hashed as a whole; only the hash is a stored form', () => {
    const { token, hash } = createInvitationToken(tenantId);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(parseInvitationToken(token)).toEqual({ tenantId, hash });
    expect(hash).toBe(hashInvitationToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(hash);
  });

  it('is different every time, even for the same tenant', () => {
    expect(createInvitationToken(tenantId).token).not.toBe(createInvitationToken(tenantId).token);
  });

  it('refuses to be made for something that is not a tenant id', () => {
    expect(() => createInvitationToken('not-a-uuid')).toThrow('tenant id');
  });

  it.each([
    ['an empty string', ''],
    ['no separator', 'a'.repeat(60)],
    ['three parts', 'a.b.c'],
    ['characters outside base64url', `${'A'.repeat(22)}.${'*'.repeat(43)}`],
    ['a secret of the wrong length', `${Buffer.alloc(16).toString('base64url')}.${'A'.repeat(42)}`],
    ['a tenant part of the wrong length', `${Buffer.alloc(8).toString('base64url')}.${'A'.repeat(43)}`],
  ])('does not parse %s', (_label, token) => {
    expect(parseInvitationToken(token)).toBeUndefined();
  });

  it('compares hashes in constant time and never accepts an empty or unequal pair', () => {
    const { hash } = createInvitationToken(tenantId);
    expect(sameHash(hash, hash)).toBe(true);
    expect(sameHash(hash, createInvitationToken(tenantId).hash)).toBe(false);
    expect(sameHash('', '')).toBe(false);
    expect(sameHash(hash, hash.slice(2))).toBe(false);
  });

  it('hashes an email ignoring case and surrounding blanks', () => {
    expect(hashEmail('  Person@Example.TEST ')).toBe(hashEmail('person@example.test'));
    expect(hashEmail('person@example.test')).not.toBe(hashEmail('other@example.test'));
  });
});

describe('MockInvitationMailer', () => {
  it('keeps what it was asked to send and finds the newest message to an address', async () => {
    const mailer = new MockInvitationMailer();
    const base = { tenantId: randomUUID(), invitationId: randomUUID(), expiresAt: new Date() };
    await mailer.send({ ...base, toEmail: 'a@example.test', token: 'first' });
    await mailer.send({ ...base, toEmail: 'a@example.test', token: 'second' });
    await mailer.send({ ...base, toEmail: 'b@example.test', token: 'other' });
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.lastTo(' A@Example.test ')?.token).toBe('second');
    expect(mailer.lastTo('nobody@example.test')).toBeUndefined();
  });
});
