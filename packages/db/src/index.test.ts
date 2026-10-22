import { DB_PACKAGE } from './index';

test('exposes the package name', () => {
  expect(DB_PACKAGE).toBe('@machvon/db');
});
