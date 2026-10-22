import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { DomainError, versionConflict } from '@machvon/kernel';
import { Command, Scope } from '../src/command.decorator';
import type { CommandScope } from '../src/command-scope';
import { OperationId } from '../src/operation-id.decorator';

export const WIDGET_STATE = Symbol('WIDGET_STATE');

/** Switches the failing sample command between broken and healed. */
export interface WidgetState {
  failing: boolean;
  /** Number of times the createWidget handler body ran (not replays). */
  executions: number;
}

interface WidgetBody {
  name: string;
}

/** Test-only commands standing in for the write endpoints that modules add later. */
@Controller('test/widgets')
export class WidgetController {
  constructor(@Inject(WIDGET_STATE) private readonly state: WidgetState) {}

  @Post()
  @HttpCode(200)
  @OperationId('test_create_widget')
  @Command({ operation: 'createWidget' })
  async create(@Scope() scope: CommandScope, @Body() body: WidgetBody): Promise<{ id: string; status: string; version: number }> {
    this.state.executions += 1;
    const id = randomUUID();
    await scope.tx.query('insert into public.test_widget (tenant_id, id, name, version) values ($1, $2, $3, 5)', [scope.tenant.tenantId, id, body.name]);
    await scope.audit({ action: 'widget.create', resourceType: 'widget', resourceId: id, diff: { name: body.name, password: 'hunter2' } });
    await scope.emit({
      aggregateType: 'widget',
      aggregateId: id,
      aggregateVersion: 5,
      type: 'WidgetCreated',
      schemaVersion: 1,
      payload: { id },
      eventKey: `widget:${id}`,
    });
    return { id, status: 'SUBMITTED', version: 5 };
  }

  @Put(':id')
  @OperationId('test_update_widget')
  @Command({ operation: 'updateWidget', versioned: true })
  async update(@Scope() scope: CommandScope, @Param('id') id: string, @Body() body: WidgetBody): Promise<{ id: string; version: number }> {
    const updated = await scope.tx.query<{ version: number }>(
      'update public.test_widget set name = $3, version = version + 1 where tenant_id = $1 and id = $2 and version = $4 returning version',
      [scope.tenant.tenantId, id, body.name, scope.expectedVersion],
    );
    const row = updated[0];
    if (row === undefined) {
      const current = await scope.tx.query<{ version: number }>('select version from public.test_widget where tenant_id = $1 and id = $2', [scope.tenant.tenantId, id]);
      if (current[0] === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
      throw versionConflict(current[0].version, { name: body.name });
    }
    await scope.audit({ action: 'widget.update', resourceType: 'widget', resourceId: id, diff: { name: body.name } });
    return { id, version: row.version };
  }

  @Post('deny')
  @HttpCode(200)
  @OperationId('test_deny_widget')
  @Command({ operation: 'denyWidget' })
  deny(): never {
    throw new DomainError('SCOPE_DENIED', 403);
  }

  @Post('fail')
  @HttpCode(200)
  @OperationId('test_fail_widget')
  @Command({ operation: 'failWidget' })
  async fail(@Scope() scope: CommandScope, @Body() body: WidgetBody): Promise<{ id: string; version: number }> {
    const id = randomUUID();
    await scope.tx.query('insert into public.test_widget (tenant_id, id, name, version) values ($1, $2, $3, 1)', [scope.tenant.tenantId, id, body.name]);
    await scope.audit({ action: 'widget.fail', resourceType: 'widget', resourceId: id, diff: {} });
    await scope.emit({
      aggregateType: 'widget',
      aggregateId: id,
      aggregateVersion: 1,
      type: 'WidgetFailed',
      schemaVersion: 1,
      payload: { id },
      eventKey: `widget-fail:${id}`,
    });
    if (this.state.failing) throw new Error('database exploded: relation "secret_table" violates constraint');
    return { id, version: 1 };
  }

  @Post('silent')
  @HttpCode(200)
  @OperationId('test_silent_widget')
  @Command({ operation: 'silentWidget' })
  async silent(@Scope() scope: CommandScope, @Body() body: WidgetBody): Promise<{ ok: true }> {
    await scope.tx.query('insert into public.test_widget (tenant_id, id, name, version) values ($1, $2, $3, 1)', [scope.tenant.tenantId, randomUUID(), body.name]);
    return { ok: true };
  }
}
