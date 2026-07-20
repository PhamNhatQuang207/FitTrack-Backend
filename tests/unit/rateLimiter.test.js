// Verifies the SECURITY FIX #2: rate limiting must fail CLOSED.
// `isDevelopment` (which drives whether limits are skipped) is computed at module
// load time, so we re-require the module under different NODE_ENV values.
const loadWithEnv = (nodeEnv) => {
  jest.resetModules();
  const original = process.env.NODE_ENV;
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
  // eslint-disable-next-line global-require
  const mod = require('../../src/middleware/rateLimiter');
  process.env.NODE_ENV = original;
  return mod;
};

describe('rateLimiter (unit) — fail-closed behaviour', () => {
  test('limits are ACTIVE when NODE_ENV is unset (the fail-open bug is fixed)', () => {
    const { isDevelopment } = loadWithEnv(undefined);
    expect(isDevelopment).toBe(false);
  });

  test('limits are ACTIVE in production', () => {
    const { isDevelopment } = loadWithEnv('production');
    expect(isDevelopment).toBe(false);
  });

  test('limits are ACTIVE in the test environment', () => {
    const { isDevelopment } = loadWithEnv('test');
    expect(isDevelopment).toBe(false);
  });

  test('limits are only skipped when development is EXPLICITLY declared', () => {
    const { isDevelopment } = loadWithEnv('development');
    expect(isDevelopment).toBe(true);
  });

  test('exports limiter and authLimiter as middleware functions', () => {
    const { limiter, authLimiter } = loadWithEnv('production');
    expect(typeof limiter).toBe('function');
    expect(typeof authLimiter).toBe('function');
  });
});
