import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Public } from '../public.decorator';

export const READINESS_PROBE = Symbol('READINESS_PROBE');

/** What the readiness check asks of the process; the database implementation lives in `database-probe.ts`. */
export interface ReadinessProbe {
  /** Rejects when the database cannot answer a trivial query. */
  database(): Promise<void>;
  /** The names of the migrations the code expects that the database has not applied (empty when up to date). */
  pendingMigrations(): Promise<readonly string[]>;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: { database: 'ok' | 'down'; migrations: 'ok' | 'pending' | 'unknown' };
  pending_migrations?: number;
}

interface Reply {
  status(code: number): Reply;
}

/**
 * `/health/live`: the process is up (always 200, it asks nothing of the database, so a database outage does not make an
 * orchestrator restart healthy processes). `/health/ready`: 200 only when the database answers and no migration is
 * pending, else 503; the body names counts and states, never an error text or a connection detail.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_PROBE) private readonly probe: ReadinessProbe) {}

  @Public()
  @Get('live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: Reply): Promise<ReadinessReport> {
    let database: 'ok' | 'down' = 'ok';
    try {
      await this.probe.database();
    } catch {
      database = 'down';
    }
    let migrations: 'ok' | 'pending' | 'unknown' = 'unknown';
    let pending = 0;
    if (database === 'ok') {
      try {
        pending = (await this.probe.pendingMigrations()).length;
        migrations = pending === 0 ? 'ok' : 'pending';
      } catch {
        migrations = 'unknown';
      }
    }
    const ready = database === 'ok' && migrations === 'ok';
    if (!ready) reply.status(503);
    return { status: ready ? 'ready' : 'not_ready', checks: { database, migrations }, ...(pending > 0 ? { pending_migrations: pending } : {}) };
  }
}
