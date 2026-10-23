import { Injectable, Module } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import {
  ControlDatabase,
  EffectiveAccessStore,
  EntitlementStore,
  InMemoryAuthzCache,
  InMemoryEntitlementCache,
  TenantDatabase,
  TenantRegistry,
  UserSessionStore,
} from '@machvon/db';
import { ConsoleSpanExporter, InMemorySpanExporter, OtlpHttpSpanExporter, Tracer, loadErrorRegistry } from '@machvon/kernel';
import type { SpanExporter } from '@machvon/kernel';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import type { AuthGuardOptions } from './auth/auth.guard';
import { HttpJwksSource, discoverJwksUri } from './auth/jwks-source';
import { JwksTokenVerifier } from './auth/jwks-token-verifier';
import { LocalTenantTokenIssuer, issuerKeyFromPem } from './auth/tenant-token-issuer';
import type { Config } from './config/config';
import { DatabaseReadinessProbe, expectedMigrations } from './health/database-probe';
import { HealthController, READINESS_PROBE } from './health/health.controller';
import type { ReadinessProbe } from './health/health.controller';
import { operationIdOf } from './operation-id.decorator';
import { DatabaseTenantRuntime } from './session/tenant-runtime';
import { UserSessionDenyList } from './session/user-session-deny-list';
import { requestTelemetry } from './telemetry/request-telemetry';

/** Sets the operation id of the handler on the request, so the request span can name it (an allowlisted attribute). */
@Injectable()
class OperationNameInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ operationId?: string }>();
    const operation = operationIdOf(context.getHandler());
    if (operation !== undefined) request.operationId = operation;
    return next.handle();
  }
}

export interface BootstrapOverrides {
  /** Replaces the span exporter chosen by the configuration (tests). */
  exporter?: SpanExporter;
  /** Replaces the readiness probe (tests); the default asks the control-plane pool. */
  probe?: ReadinessProbe;
  /** Port to listen on; `0` picks a free one. Defaults to the configured port. */
  port?: number;
  fetch?: typeof fetch;
}

export interface RunningApi {
  app: NestExpressApplication;
  port: number;
  tracer: Tracer;
  /**
   * Graceful shutdown: stops accepting connections, lets in-flight requests finish (up to the configured timeout),
   * then closes the pools. Safe to call twice.
   */
  stop(): Promise<void>;
}

function exporterOf(config: Config, overrides: BootstrapOverrides): SpanExporter {
  if (overrides.exporter !== undefined) return overrides.exporter;
  const { exporter, otlpEndpoint, serviceName } = config.telemetry;
  if (exporter === 'console') return new ConsoleSpanExporter();
  if (exporter === 'otlp' && otlpEndpoint !== undefined) return new OtlpHttpSpanExporter({ endpoint: otlpEndpoint, serviceName, ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }) });
  return new InMemorySpanExporter();
}

/**
 * Builds and starts the API from a validated configuration: the three database pools (one per role), the real
 * authentication guard (identity provider keys, tenant tokens of this API), the policy decision point, tenant selection,
 * the command pipeline, the health checks and the request telemetry. The outbox relay and the scheduled jobs are not
 * started here: they need the broker and provisioning adapters of Task 20 (see docs/runbooks/api-runtime.md, Not yet wired).
 */
export async function bootstrap(config: Config, overrides: BootstrapOverrides = {}): Promise<RunningApi> {
  const pools = {
    app: new Pool({ connectionString: config.databaseUrls.app, max: 10 }),
    control: new Pool({ connectionString: config.databaseUrls.control, max: 4 }),
  };
  for (const pool of Object.values(pools)) pool.on('error', () => undefined);
  let app: NestExpressApplication | undefined;
  try {
    const tenants = new TenantDatabase(pools.app);
    const control = new ControlDatabase(pools.control);
    const authzCache = new InMemoryAuthzCache();
    const entitlementCache = new InMemoryEntitlementCache();
    const tenantRuntime = new DatabaseTenantRuntime(tenants);
    const access = new EffectiveAccessStore(tenants, authzCache);
    const sessions = new UserSessionStore(tenants);
    const denyList = new UserSessionDenyList(sessions);
    const issuer = new LocalTenantTokenIssuer({
      issuer: config.tenantToken.issuer,
      signingKey: issuerKeyFromPem(config.tenantToken.signingKeyPem, config.tenantToken.keyId),
      ...(config.tenantToken.retired === undefined ? {} : { retiredKeys: [issuerKeyFromPem(config.tenantToken.retired.pem, config.tenantToken.retired.keyId)] }),
    });
    const jwksUri = config.oidc.jwksUri ?? (await discoverJwksUri(config.oidc.issuer, overrides.fetch));
    const verifier = new JwksTokenVerifier({
      issuer: config.oidc.issuer,
      identityAudience: config.oidc.identityAudience,
      controlAudience: config.oidc.controlAudience,
      jwks: new HttpJwksSource({ jwksUri }),
      tenantTokenKeys: async () => (await issuer.publicKeys()).keys,
      tenantIssuer: config.tenantToken.issuer,
    });
    const authOptions: AuthGuardOptions = { verifier, denyList, controlAudience: config.oidc.controlAudience };
    const tracer = new Tracer({ exporter: exporterOf(config, overrides) });
    const probe = overrides.probe ?? new DatabaseReadinessProbe(pools.control, () => expectedMigrations(config.migrationsDir));

    @Module({
      imports: [
        AppModule.register({
          database: tenants,
          registry: loadErrorRegistry(config.errorCodesPath),
          auth: authOptions,
          policy: { database: tenants, access, denyList },
          session: { verifier, control, tenants, sessions, issuer, denyList },
          control: { database: control, registry: new TenantRegistry(control) },
          entitlements: { store: new EntitlementStore(tenants, entitlementCache), control },
          tenantState: { runtime: tenantRuntime, entitlementCache, authzCache },
        }),
      ],
      controllers: [HealthController],
      providers: [
        { provide: READINESS_PROBE, useValue: probe },
        { provide: APP_INTERCEPTOR, useClass: OperationNameInterceptor },
      ],
    })
    class RootModule {}

    app = await NestFactory.create<NestExpressApplication>(RootModule, { bodyParser: false, logger: ['error', 'warn'] });
    app.use(requestTelemetry(tracer));
    // The body size limit applies before any route parses a body; an oversized body is a 413 problem, never a crash.
    app.useBodyParser('json', { limit: config.maxBodyBytes });
    app.enableCors({
      origin: config.corsOrigins.length === 0 ? false : [...config.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'if-match', 'x-correlation-id', 'traceparent'],
      exposedHeaders: ['x-correlation-id', 'x-request-id', 'etag', 'retry-after', 'idempotency-replayed'],
      maxAge: 600,
    });
    app.disable('x-powered-by');
    await app.listen(overrides.port ?? config.port);
    const address = app.getHttpServer().address() as { port: number };
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        const server = app?.getHttpServer() as { closeIdleConnections?: () => void; closeAllConnections?: () => void } | undefined;
        const timer = setTimeout(() => server?.closeAllConnections?.(), config.shutdownTimeoutMs);
        try {
          // `close` stops accepting and resolves once in-flight requests have finished; idle keep-alive sockets are dropped at once.
          const closing = app?.close();
          server?.closeIdleConnections?.();
          await closing;
          await tracer.shutdown();
        } finally {
          clearTimeout(timer);
          await Promise.all([pools.app.end(), pools.control.end()]);
        }
      })();
      return stopping;
    };
    return { app, port: address.port, tracer, stop };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await Promise.all([pools.app.end(), pools.control.end()]).catch(() => undefined);
    throw error;
  }
}
