import { permissionMatches } from '../src/permission';

describe('permissionMatches', () => {
  it.each([
    ['iam.*', 'iam.role.grant', true],
    ['iam.*', 'iam.x', true],
    ['iam.*', 'iamx.y', false],
    ['iam.*', 'iam', false],
    ['iam.*', 'iam.', false],
    ['iam.role.grant', 'iam.role.grant', true],
    ['iam.role.grant', 'iam.role.manage', false],
    ['iam.role.grant', 'iam.*', false],
    ['iam.*', 'iam.*', true],
    ['iam.*', 'iam.role.*', true],
    ['iam.role.*', 'iam.*', false],
    ['*', 'iam.role.grant', false],
    ['*', '*', false],
    ['', 'iam.x', false],
  ])('held %p against required %p gives %p', (held, required, expected) => {
    expect(permissionMatches(held, required)).toBe(expected);
  });
});
