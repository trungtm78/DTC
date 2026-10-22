import { KERNEL_PACKAGE } from './index';

test('exposes the package name', () => {
  expect(KERNEL_PACKAGE).toBe('@machvon/kernel');
});
