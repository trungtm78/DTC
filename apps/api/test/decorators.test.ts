import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { DomainError } from '@machvon/kernel';
import { OperationId, implementedOperationIds } from '../src/operation-id.decorator';
import { tenantContextOf } from '../src/tenant-context.decorator';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';

@Controller('things')
class ThingsController {
  @Get()
  @OperationId('listThings')
  list(): string[] {
    return [];
  }

  @Get(':id')
  @OperationId('getThing')
  get(): string {
    return '';
  }

  @Get('unlabelled')
  unlabelled(): string {
    return '';
  }

  get notAHandler(): number {
    return 1;
  }
}

@Controller('other')
class OtherController {
  @OperationId('getOther')
  get(): string {
    return '';
  }
}

describe('implementedOperationIds', () => {
  it('collects the operationIds declared on handlers and skips unlabelled members and accessors', () => {
    expect([...implementedOperationIds([ThingsController])].sort()).toEqual(['getThing', 'listThings']);
  });

  it('merges several controllers and is empty for none', () => {
    expect([...implementedOperationIds([ThingsController, OtherController])].sort()).toEqual(['getOther', 'getThing', 'listThings']);
    expect(implementedOperationIds([]).size).toBe(0);
  });
});

describe('tenantContextOf', () => {
  it('returns the context a guard attached to the request', () => {
    const request = { tenantContext: { tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 3, extra: 'dropped' } };
    expect(tenantContextOf(request)).toEqual({ tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 3 });
  });

  it('fails with TENANT_CONTEXT_INVALID when no guard authenticated the request', () => {
    expect(() => tenantContextOf({})).toThrow(DomainError);
    expect(() => tenantContextOf({ tenantContext: { tenantId: "'; drop table x" } })).toThrow('TENANT_CONTEXT_INVALID');
  });
});
