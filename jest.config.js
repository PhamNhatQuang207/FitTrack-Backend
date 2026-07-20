module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Integration tests each spin up an in-memory MongoDB; run serially so we
  // don't launch many mongod processes at once and to keep DB state isolated.
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};
