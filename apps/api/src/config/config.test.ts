import { generateKeyPairSync } from 'node:crypto';
import { ConfigError, loadConfig } from './config';

const ec = (): string => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const rsa = (): string => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const FILES: Record<string, string> = { '/keys/current.pem': ec(), '/keys/old.pem': ec(), '/keys/rsa.pem': rsa(), '/keys/garbage.pem': 'not a key' };
const io = {
  readText: (path: string): string => {
    const text = FILES[path];
    if (text === undefined) throw new Error(`ENOENT secret-path-detail ${path}`);
    return text;
  },
};
const KEY_BYTES = Buffer.alloc(32, 7).toString('base64');
const GOOD: Record<string, string> = {
  DATABASE_URL_APP: 'postgres://machvon_app:pw-app-SECRET@db:5432/machvon',
  DATABASE_URL_CONTROL: 'postgres://machvon_control:pw-control-SECRET@db:5432/machvon',
  DATABASE_URL_OUTBOX_RELAY: 'postgres://machvon_outbox_relay:pw-relay-SECRET@db:5432/machvon',
  OIDC_ISSUER: 'https://idp.example.test/realms/machvon',
  OIDC_IDENTITY_AUDIENCE: 'machvon-web',
  OIDC_CONTROL_AUDIENCE: 'machvon-control',
  TENANT_TOKEN_ISSUER: 'https://api.example.test',
  TENANT_TOKEN_SIGNING_KEY_PEM_PATH: '/keys/current.pem',
  TENANT_TOKEN_KEY_ID: 'k1',
  OUTBOX_SIGNING_KEY: KEY_BYTES,
};

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env, io);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('reads a complete environment with the defaults for the optional variables', () => {
    const config = loadConfig(GOOD, io);
    expect(config).toMatchObject({
      port: 3000,
      maxBodyBytes: 1_048_576,
      shutdownTimeoutMs: 15_000,
      corsOrigins: [],
      migrationsDir: 'db/migrations',
      oidc: { issuer: GOOD.OIDC_ISSUER, jwksUri: undefined },
      tenantToken: { issuer: 'https://api.example.test', keyId: 'k1', retired: undefined },
      telemetry: { exporter: 'none', otlpEndpoint: undefined, serviceName: 'machvon-api' },
    });
    expect(config.outboxSigningKey).toHaveLength(32);
    expect(config.tenantToken.signingKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('lists every missing variable at once, by name', () => {
    const error = failure({});
    expect(error.problems.map((problem) => problem.name)).toEqual([
      'DATABASE_URL_APP',
      'DATABASE_URL_CONTROL',
      'DATABASE_URL_OUTBOX_RELAY',
      'OIDC_ISSUER',
      'OIDC_IDENTITY_AUDIENCE',
      'OIDC_CONTROL_AUDIENCE',
      'TENANT_TOKEN_ISSUER',
      'TENANT_TOKEN_SIGNING_KEY_PEM_PATH',
      'TENANT_TOKEN_KEY_ID',
      'OUTBOX_SIGNING_KEY',
    ]);
    expect(error.problems.every((problem) => problem.problem === 'missing')).toBe(true);
    expect(failure({ ...GOOD, DATABASE_URL_APP: '   ' }).problems).toEqual([expect.objectContaining({ name: 'DATABASE_URL_APP', problem: 'missing' })]);
  });

  it('reports malformed values together with missing ones and never prints a value, a password or a path detail', () => {
    const error = failure({
      ...GOOD,
      DATABASE_URL_APP: 'mysql://user:pw-leak-SECRET@db/x',
      OIDC_ISSUER: 'http://idp.example.test',
      TENANT_TOKEN_SIGNING_KEY_PEM_PATH: '/keys/rsa.pem',
      TENANT_TOKEN_KEY_ID: 'bad key id!',
      OUTBOX_SIGNING_KEY: Buffer.alloc(16, 1).toString('base64'),
      DATABASE_URL_CONTROL: undefined,
      PORT: '99999',
    });
    expect(error.problems.map((problem) => `${problem.name}:${problem.problem}`)).toEqual([
      'DATABASE_URL_APP:malformed',
      'DATABASE_URL_CONTROL:missing',
      'OIDC_ISSUER:malformed',
      'TENANT_TOKEN_SIGNING_KEY_PEM_PATH:malformed',
      'TENANT_TOKEN_KEY_ID:malformed',
      'OUTBOX_SIGNING_KEY:malformed',
      'PORT:malformed',
    ]);
    for (const secret of ['pw-leak-SECRET', 'pw-app-SECRET', 'pw-control-SECRET', 'bad key id!', '99999', Buffer.alloc(16, 1).toString('base64'), FILES['/keys/rsa.pem'] as string]) {
      expect(error.message).not.toContain(secret);
    }
  });

  it('refuses a key file that is unreadable, not a key or not an EC P-256 key, without echoing the reason', () => {
    for (const path of ['/keys/missing.pem', '/keys/garbage.pem', '/keys/rsa.pem']) {
      const error = failure({ ...GOOD, TENANT_TOKEN_SIGNING_KEY_PEM_PATH: path });
      expect(error.problems).toEqual([expect.objectContaining({ name: 'TENANT_TOKEN_SIGNING_KEY_PEM_PATH', problem: 'malformed' })]);
      expect(error.message).not.toContain('secret-path-detail');
    }
  });

  it('takes the previous signing key only as a pair', () => {
    expect(loadConfig({ ...GOOD, TENANT_TOKEN_RETIRED_KEY_PEM_PATH: '/keys/old.pem', TENANT_TOKEN_RETIRED_KEY_ID: 'k0' }, io).tenantToken.retired).toMatchObject({ keyId: 'k0' });
    expect(failure({ ...GOOD, TENANT_TOKEN_RETIRED_KEY_ID: 'k0' }).problems.map((problem) => problem.name)).toEqual(['TENANT_TOKEN_RETIRED_KEY_PEM_PATH']);
    expect(failure({ ...GOOD, TENANT_TOKEN_RETIRED_KEY_PEM_PATH: '/keys/old.pem' }).problems.map((problem) => problem.name)).toEqual(['TENANT_TOKEN_RETIRED_KEY_ID']);
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'abc'],
    ['MAX_BODY_BYTES', '0'],
    ['MAX_BODY_BYTES', '52428801'],
    ['SHUTDOWN_TIMEOUT_MS', '99'],
    ['SHUTDOWN_TIMEOUT_MS', '120001'],
    ['CORS_ORIGINS', '*'],
    ['CORS_ORIGINS', 'https://a.example.test/path'],
    ['CORS_ORIGINS', 'https://a.example.test,not a url'],
    ['TELEMETRY_EXPORTER', 'zipkin'],
    ['OIDC_JWKS_URI', 'ftp://x'],
  ])('refuses %s=%s', (name, value) => {
    expect(failure({ ...GOOD, [name]: value }).problems).toEqual([expect.objectContaining({ name, problem: 'malformed' })]);
  });

  it('accepts the edges and the optional settings', () => {
    const config = loadConfig(
      { ...GOOD, PORT: '65535', MAX_BODY_BYTES: '52428800', SHUTDOWN_TIMEOUT_MS: '100', CORS_ORIGINS: 'https://app.example.test, http://localhost:5173', TELEMETRY_EXPORTER: 'otlp', OTLP_ENDPOINT: 'http://collector:4318', OIDC_JWKS_URI: 'https://idp.example.test/jwks', OIDC_ISSUER: 'http://localhost:8080/realms/dev' },
      io,
    );
    expect(config).toMatchObject({ port: 65_535, maxBodyBytes: 52_428_800, shutdownTimeoutMs: 100, corsOrigins: ['https://app.example.test', 'http://localhost:5173'], telemetry: { exporter: 'otlp', otlpEndpoint: 'http://collector:4318' } });
  });

  it('wants an endpoint when the OTLP exporter is chosen and a URL when one is given', () => {
    expect(failure({ ...GOOD, TELEMETRY_EXPORTER: 'otlp' }).problems).toEqual([expect.objectContaining({ name: 'OTLP_ENDPOINT', problem: 'missing' })]);
    expect(failure({ ...GOOD, OTLP_ENDPOINT: 'collector' }).problems).toEqual([expect.objectContaining({ name: 'OTLP_ENDPOINT', problem: 'malformed' })]);
  });
});
