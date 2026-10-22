import { API_DEPENDENCIES, API_PACKAGE } from './main';

test('the API depends on the three workspace packages', () => {
  expect(API_PACKAGE).toBe('@machvon/api');
  expect([...API_DEPENDENCIES].sort()).toEqual(['@machvon/contracts', '@machvon/db', '@machvon/kernel']);
});
