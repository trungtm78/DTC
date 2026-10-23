import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type TelemetryExporterKind = 'none' | 'console' | 'otlp';

export interface Config {
  port: number;
  /** One connection string per database role (no role may use another's). */
  databaseUrls: { app: string; control: string; outboxRelay: string };
  oidc: { issuer: string; identityAudience: string; controlAudience: string; jwksUri: string | undefined };
  tenantToken: { issuer: string; signingKeyPem: string; keyId: string; retired: { pem: string; keyId: string } | undefined };
  /** Signs the worker context of outbox deliveries; at least 32 bytes. */
  outboxSigningKey: Buffer;
  corsOrigins: readonly string[];
  maxBodyBytes: number;
  shutdownTimeoutMs: number;
  /** Where the SQL migrations are read from to tell whether the schema is up to date. */
  migrationsDir: string;
  /** The error code registry (error_codes.json of the design pack) the problem responses are built from. */
  errorCodesPath: string;
  /** Where operations alerts are delivered besides the log (a chat or pager webhook); optional. */
  alertWebhookUrl: string | undefined;
  telemetry: { exporter: TelemetryExporterKind; otlpEndpoint: string | undefined; serviceName: string };
}

export interface ConfigProblem {
  name: string;
  /** What is wrong, never the value (a value can be a secret). */
  problem: 'missing' | 'malformed';
  expected: string;
}

/** Every missing or malformed variable at once, so an operator fixes the environment in one pass. Messages carry names only. */
export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(`invalid configuration: ${problems.map((entry) => `${entry.name} is ${entry.problem} (expected ${entry.expected})`).join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** How the loader reads a key file; tests give their own. */
export interface ConfigIo {
  readText(path: string): string;
}

const fileIo: ConfigIo = { readText: (path) => readFileSync(path, 'utf8') };

const MIN_OUTBOX_KEY_BYTES = 32;
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const MAX_BODY_BYTES_LIMIT = 52_428_800;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

function urlWith(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function integerIn(value: string, min: number, max: number): number | undefined {
  if (!/^[0-9]{1,9}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : undefined;
}

function ecP256(pem: string): boolean {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

/**
 * Validates the environment and returns the typed configuration, or throws one ConfigError that lists every problem.
 * Secrets (database URLs, the signing keys) are only checked for shape; their values never appear in a message.
 */
export function loadConfig(env: Env, io: ConfigIo = fileIo): Config {
  const problems: ConfigProblem[] = [];
  const fail = (name: string, problem: ConfigProblem['problem'], expected: string): undefined => {
    problems.push({ name, problem, expected });
    return undefined;
  };
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value.trim() === '' ? undefined : value.trim();
  };
  const required = (name: string, expected: string, valid: (value: string) => boolean): string | undefined => {
    const value = read(name);
    if (value === undefined) return fail(name, 'missing', expected);
    return valid(value) ? value : fail(name, 'malformed', expected);
  };
  const optional = <T>(name: string, fallback: T, expected: string, parse: (value: string) => T | undefined): T => {
    const value = read(name);
    if (value === undefined) return fallback;
    return parse(value) ?? (fail(name, 'malformed', expected) as undefined) ?? fallback;
  };

  const postgres = (value: string): boolean => urlWith(value, ['postgres:', 'postgresql:']);
  const app = required('DATABASE_URL_APP', 'a postgres:// URL for the machvon_app role', postgres);
  const control = required('DATABASE_URL_CONTROL', 'a postgres:// URL for the machvon_control role', postgres);
  const outboxRelay = required('DATABASE_URL_OUTBOX_RELAY', 'a postgres:// URL for the machvon_outbox_relay role', postgres);
  const issuer = required('OIDC_ISSUER', 'an https:// URL (http:// only for localhost)', (value) => urlWith(value, ['https:']) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(value));
  const identityAudience = required('OIDC_IDENTITY_AUDIENCE', 'the client id of the web and mobile applications', () => true);
  const controlAudience = required('OIDC_CONTROL_AUDIENCE', 'the client id of the control plane', () => true);
  const tenantIssuer = required('TENANT_TOKEN_ISSUER', 'an https:// URL naming this API', (value) => urlWith(value, ['https:', 'http:']));
  const keyIdShape = 'a key id of 1 to 64 letters, digits, dots, dashes or underscores';
  const validKeyId = (value: string): boolean => /^[A-Za-z0-9._-]{1,64}$/.test(value);
  const keyFile = (name: string, value: string): string | undefined => {
    try {
      const pem = io.readText(value);
      return ecP256(pem) ? pem : fail(name, 'malformed', 'a path to an EC P-256 private key in PEM form');
    } catch {
      return fail(name, 'malformed', 'a path to a readable EC P-256 private key in PEM form');
    }
  };
  const signingKeyPath = required('TENANT_TOKEN_SIGNING_KEY_PEM_PATH', 'a path to an EC P-256 private key in PEM form', () => true);
  const signingKeyPem = signingKeyPath === undefined ? undefined : keyFile('TENANT_TOKEN_SIGNING_KEY_PEM_PATH', signingKeyPath);
  const keyId = required('TENANT_TOKEN_KEY_ID', keyIdShape, validKeyId);
  const retiredPath = read('TENANT_TOKEN_RETIRED_KEY_PEM_PATH');
  const retiredId = read('TENANT_TOKEN_RETIRED_KEY_ID');
  let retired: Config['tenantToken']['retired'];
  if (retiredPath !== undefined || retiredId !== undefined) {
    const pem = retiredPath === undefined ? fail('TENANT_TOKEN_RETIRED_KEY_PEM_PATH', 'missing', 'a path to the previous key when TENANT_TOKEN_RETIRED_KEY_ID is set') : keyFile('TENANT_TOKEN_RETIRED_KEY_PEM_PATH', retiredPath);
    const id = retiredId === undefined ? fail('TENANT_TOKEN_RETIRED_KEY_ID', 'missing', 'the previous key id when TENANT_TOKEN_RETIRED_KEY_PEM_PATH is set') : validKeyId(retiredId) ? retiredId : fail('TENANT_TOKEN_RETIRED_KEY_ID', 'malformed', keyIdShape);
    if (pem !== undefined && id !== undefined) retired = { pem, keyId: id };
  }
  const jwksUri = read('OIDC_JWKS_URI');
  if (jwksUri !== undefined && !urlWith(jwksUri, ['https:', 'http:'])) fail('OIDC_JWKS_URI', 'malformed', 'an http(s) URL; leave it out to discover it from the issuer');
  const outboxSigningKey = required('OUTBOX_SIGNING_KEY', `base64 of at least ${MIN_OUTBOX_KEY_BYTES} bytes`, (value) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length >= MIN_OUTBOX_KEY_BYTES);

  const port = optional('PORT', DEFAULT_PORT, 'a port from 1 to 65535', (value) => integerIn(value, 1, 65_535));
  const maxBodyBytes = optional('MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES, `a size from 1 to ${MAX_BODY_BYTES_LIMIT}`, (value) => integerIn(value, 1, MAX_BODY_BYTES_LIMIT));
  const shutdownTimeoutMs = optional('SHUTDOWN_TIMEOUT_MS', DEFAULT_SHUTDOWN_TIMEOUT_MS, `milliseconds from 100 to ${MAX_SHUTDOWN_TIMEOUT_MS}`, (value) => integerIn(value, 100, MAX_SHUTDOWN_TIMEOUT_MS));
  const corsOrigins = optional<readonly string[]>('CORS_ORIGINS', [], 'comma-separated origins such as https://app.example.test (no *)', (value) => {
    const origins = value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
    return origins.every((origin) => urlWith(origin, ['https:', 'http:']) && new URL(origin).origin === origin) ? origins : undefined;
  });
  const exporter = optional<TelemetryExporterKind>('TELEMETRY_EXPORTER', 'none', 'none, console or otlp', (value) => (value === 'none' || value === 'console' || value === 'otlp' ? value : undefined));
  const otlpEndpoint = read('OTLP_ENDPOINT');
  if (exporter === 'otlp' && otlpEndpoint === undefined) fail('OTLP_ENDPOINT', 'missing', 'an http(s) URL of the collector when TELEMETRY_EXPORTER is otlp');
  else if (otlpEndpoint !== undefined && !urlWith(otlpEndpoint, ['https:', 'http:'])) fail('OTLP_ENDPOINT', 'malformed', 'an http(s) URL of the collector');

  const alertWebhookUrl = read('ALERT_WEBHOOK_URL');
  if (alertWebhookUrl !== undefined && !urlWith(alertWebhookUrl, ['https:', 'http:'])) fail('ALERT_WEBHOOK_URL', 'malformed', 'an http(s) URL of the alert webhook');

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    port,
    databaseUrls: { app: app as string, control: control as string, outboxRelay: outboxRelay as string },
    oidc: { issuer: issuer as string, identityAudience: identityAudience as string, controlAudience: controlAudience as string, jwksUri },
    tenantToken: { issuer: tenantIssuer as string, signingKeyPem: signingKeyPem as string, keyId: keyId as string, retired },
    outboxSigningKey: Buffer.from(outboxSigningKey as string, 'base64'),
    corsOrigins,
    maxBodyBytes,
    shutdownTimeoutMs,
    migrationsDir: read('MIGRATIONS_DIR') ?? 'db/migrations',
    errorCodesPath: read('ERROR_CODES_PATH') ?? 'Design/MACHVON_Design/03_Engineering/error_codes.json',
    alertWebhookUrl,
    telemetry: { exporter, otlpEndpoint, serviceName: read('OTEL_SERVICE_NAME') ?? 'machvon-api' },
  };
}
