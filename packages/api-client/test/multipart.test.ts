import { ApiError, createApiClient, newCommandAttempt, uploadFile } from '../src/index';
import { json, problem, scriptedFetch } from './support';
import type { Scripted } from './support';

const TENANT = '00000000-0000-4000-8000-0000000000b1';
const ASSET = { assetId: '00000000-0000-4000-8000-0000000000a1', scanStatus: 'clean', contentHash: 'a'.repeat(64), contentType: 'image/png' };
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], { type: 'image/png' });

function setup(script: Scripted[]) {
  const { fetch, calls } = scriptedFetch(script);
  const waits: number[] = [];
  let counter = 0;
  const client = createApiClient({
    baseUrl: 'https://api.example.test/',
    session: () => Promise.resolve({ token: 'token-1' }),
    fetch,
    locale: () => 'vi',
    newKey: () => `key-${(counter += 1)}-0123456789`,
    newCorrelationId: () => '00000000-0000-4000-8000-0000000000d0',
    delay: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return { client, calls, waits };
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('uploadFile', () => {
  it('sends one multipart form with the file under the field, the idempotency and auth headers and no JSON content type', async () => {
    const { client, calls } = setup([json(200, ASSET)]);
    const result = await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG });
    expect(result).toEqual(ASSET);
    const call = calls[0];
    expect(call?.url).toBe(`https://api.example.test/system/tenants/${TENANT}/theme/assets`);
    expect(call?.method).toBe('POST');
    expect(call?.headers.get('idempotency-key')).toBe('key-1-0123456789');
    expect(call?.headers.get('authorization')).toBe('Bearer token-1');
    expect(call?.headers.get('accept-language')).toBe('vi');
    // The runtime adds `multipart/form-data; boundary=...` itself; a JSON header would break the boundary.
    expect(call?.headers.get('content-type')).toBeNull();
    const form = call?.rawBody;
    expect(form).toBeInstanceOf(FormData);
    const file = (form as FormData).get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(PNG.size);
    expect([...(form as FormData).keys()]).toEqual(['file']);
  });

  it('names the field and the file as asked, and takes the name of a File when none is given', async () => {
    const { client, calls } = setup([json(200, ASSET), json(200, ASSET)]);
    await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG, field: 'attachment', filename: 'logo.png' });
    const named = (calls[0]?.rawBody as FormData).get('attachment') as File;
    expect(named.name).toBe('logo.png');
    await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: new File([PNG], 'brand.webp', { type: 'image/webp' }) });
    expect(((calls[1]?.rawBody as FormData).get('file') as File).name).toBe('brand.webp');
  });

  it('reuses the key of one attempt for a retry of the same upload', async () => {
    const { client, calls } = setup([json(200, ASSET), json(200, ASSET)]);
    const attempt = newCommandAttempt(() => 'attempt-0123456789abcdef');
    await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG, attempt });
    await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG, attempt });
    expect(calls.map((call) => call.headers.get('idempotency-key'))).toEqual(['attempt-0123456789abcdef', 'attempt-0123456789abcdef']);
  });

  it('waits and retries with the same key and the same file while the server says IDEMPOTENCY_IN_PROGRESS', async () => {
    const { client, calls, waits } = setup([problem(409, 'IDEMPOTENCY_IN_PROGRESS', {}, { 'retry-after': '3' }), json(200, ASSET)]);
    expect(await uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG })).toEqual(ASSET);
    expect(waits).toEqual([3000]);
    expect(calls.map((call) => call.headers.get('idempotency-key'))).toEqual(['key-1-0123456789', 'key-1-0123456789']);
    expect(calls[1]?.rawBody).toBe(calls[0]?.rawBody);
  });

  it('surfaces a Problem+JSON answer as an ApiError with its code, status and extensions', async () => {
    const { client } = setup([problem(422, 'FILE_TYPE_NOT_ALLOWED'), problem(413, 'PAYLOAD_TOO_LARGE')]);
    const refused = await failureOf(uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG }));
    expect([refused.status, refused.code]).toEqual([422, 'FILE_TYPE_NOT_ALLOWED']);
    const large = await failureOf(uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG }));
    expect([large.status, large.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  });

  it('reports a network failure and an unusable answer as ApiErrors', async () => {
    const { client } = setup([new Error('offline'), new Response('<html>', { status: 200 })]);
    expect((await failureOf(uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG }))).code).toBe('NETWORK_ERROR');
    expect((await failureOf(uploadFile(client, 'uploadSystemTenantThemeAsset', { path: { tenantId: TENANT }, file: PNG }))).status).toBe(200);
  });

  it('refuses a missing path parameter', async () => {
    const { client } = setup([]);
    await expect(uploadFile(client, 'uploadSystemTenantThemeAsset', { path: {} as { tenantId: string }, file: PNG })).rejects.toThrow(/tenantId/);
  });
});
