// Shared Jest preset: SWC transpiles TypeScript (type checking is the separate `typecheck` script).
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022', parser: { syntax: 'typescript' } } }],
  },
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.test.ts'],
  coverageThreshold: { global: { lines: 90 } },
};
