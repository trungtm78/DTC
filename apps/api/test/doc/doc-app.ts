import { randomBytes, randomUUID } from 'node:crypto';
import { APP_FILTER } from '@nestjs/core';
import { DocumentStore, EffectiveAccessStore, InMemoryAuthzCache, TenantDatabase } from '@machvon/db';
import type { MetricsSink } from '@machvon/kernel';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import type { TrustAnchor } from '../../src/modules/doc/cms-verification';
import type { RevocationAnswer } from '../../src/modules/doc/pades-verifier';
import { CommandModule } from '../../src/command.module';
import { PolicyModule } from '../../src/policy.module';
import { ProblemFilter } from '../../src/problem.filter';
import { DocumentVersionReadsController, DocumentsController } from '../../src/modules/doc/documents.controller';
import { DOCUMENT_FILE_PORT, MockDocumentFilePort } from '../../src/modules/doc/file-port';
import { PdfLibRenderer, loadRendererResources } from '../../src/modules/doc/pdf-renderer';
import { RegistersController } from '../../src/modules/doc/registers.controller';
import { SignaturesController } from '../../src/modules/doc/signatures.controller';
import { DOC_CLOCK, DOC_METRICS, DOC_REVOCATION, DOC_STATE_TEXT, DOC_TRUST_STORE, PDF_RENDERER } from '../../src/modules/doc/tokens';
import { ACTOR, AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from '../../../../packages/db/test/support/authz-fixtures';
import { TENANT_HEADER } from '../isolation/test-auth.guard';
import { ERROR_CODES_PATH, startTestApp } from '../isolation/test-app';
import type { RunningApp } from '../isolation/test-app';

export const SIGNING_KEY = randomBytes(32);
export const NOW = new Date('2026-10-23T03:00:00Z');

/** Members of tenant A. */
export const ADMIN = 1; // every document permission on the whole tenant
export const UNIT_TWO_CLERK = 2; // register and document reads/manage on the subtree of unit 2 only
export const NOBODY = 3; // no grant
export const RENDERER_ONLY = 4; // doc.render only

export interface Reply {
  status: number;
  headers: Headers;
  json: Record<string, unknown>;
}

export interface MetricEvent {
  name: string;
  labels: Record<string, string> | undefined;
}

export class DocApp {
  readonly harness = new AuthzHarness();
  readonly files = new MockDocumentFilePort();
  readonly metrics: MetricEvent[] = [];
  /** The trust anchors every tenant verifies against; tests set them before they verify. */
  anchors: TrustAnchor[] = [];
  /** What the revocation port answers when a verification asks for it. */
  revocationAnswer: RevocationAnswer = { status: 'GOOD' };
  app!: RunningApp;
  layoutProfileId = '';
  templateId = '';

  async start(): Promise<void> {
    const { harness } = this;
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: `/${unitId(1)}/` },
      { n: 2, path: `/${unitId(1)}/${unitId(2)}/`, parent: 1 },
    ]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: `/${unitId(1)}/` }]);
    for (const n of [ADMIN, UNIT_TWO_CLERK, NOBODY, RENDERER_ONLY]) await harness.seedMembership(TENANT_A, n, 1);
    await harness.seedMembership(TENANT_B, ADMIN, 1);
    const all = ['doc.render', 'doc.type.manage', 'doc.outgoing.read', 'document_version.read', 'doc.register.manage', 'doc.register.read', 'doc.signature.verify', 'doc.signature.read'];
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedRole(tenant, 1, 'DOC_ADMIN', all, 60);
      await harness.seedGrants(tenant, [{ n: 1, member: ADMIN, role: 1, kind: 'TENANT' }]);
    }
    await harness.seedRole(TENANT_A, 2, 'DOC_CLERK', ['doc.outgoing.read', 'document_version.read', 'doc.register.manage', 'doc.register.read', 'doc.signature.read'], 30);
    await harness.seedRole(TENANT_A, 3, 'DOC_RENDERER', ['doc.render'], 20);
    await harness.seedGrants(TENANT_A, [
      { n: 2, member: UNIT_TWO_CLERK, role: 2, kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
      { n: 3, member: RENDERER_ONLY, role: 3, kind: 'TENANT' },
    ]);
    const seeded = await harness.tenants.withTenant(contextFor(TENANT_A, memberId(ADMIN)), (tx) => new DocumentStore().seedDefaults(tx, ACTOR));
    this.layoutProfileId = seeded.layoutProfileId;
    this.templateId = seeded.templateId;
    const tenants = harness.tenants as TenantDatabase;
    const resources = loadRendererResources();
    const sink: MetricsSink = {
      increment: (name, labels) => {
        this.metrics.push({ name, labels });
      },
      gauge: () => undefined,
    };
    this.app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        CommandModule.register({ database: tenants }),
        PolicyModule.register({ database: tenants, access: new EffectiveAccessStore(tenants, new InMemoryAuthzCache()) }),
      ],
      controllers: [DocumentsController, DocumentVersionReadsController, RegistersController, SignaturesController],
      providers: [
        { provide: TenantDatabase, useValue: tenants },
        { provide: DOCUMENT_FILE_PORT, useValue: this.files },
        { provide: PDF_RENDERER, useValue: new PdfLibRenderer(resources) },
        { provide: DOC_STATE_TEXT, useValue: resources.text },
        { provide: DOC_METRICS, useValue: sink },
        { provide: DOC_CLOCK, useValue: () => NOW },
        { provide: DOC_TRUST_STORE, useValue: { forTenant: async () => ({ anchors: () => this.anchors }) } },
        { provide: DOC_REVOCATION, useValue: { check: async (): Promise<RevocationAnswer> => this.revocationAnswer } },
        { provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) },
      ],
    });
  }

  async stop(): Promise<void> {
    if (this.app) await this.app.close();
    await this.harness.stop();
  }

  async call(
    method: 'GET' | 'POST',
    url: string,
    options: { member: number; tenantId?: string; body?: unknown; ifMatch?: string; key?: string },
  ): Promise<Reply> {
    const token = signTenantContext({ tenantId: options.tenantId ?? TENANT_A, membershipId: memberId(options.member), scopeVersion: 1 }, SIGNING_KEY);
    const headers: Record<string, string> = { [TENANT_HEADER]: token, 'content-type': 'application/json' };
    if (method !== 'GET') headers['idempotency-key'] = options.key ?? `key-${randomUUID()}`;
    if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch;
    const response = await fetch(`${this.app.baseUrl}${url}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}) });
    return { status: response.status, headers: response.headers, json: (await response.json()) as Record<string, unknown> };
  }

  async count(sql: string, params: unknown[] = [], tenantId: string = TENANT_A): Promise<number> {
    return Number((await this.harness.owner<{ n: string }>(tenantId, [[sql, params]]))[0]?.n);
  }
}

export { ACTOR, TENANT_A, TENANT_B, memberId, unitId };
