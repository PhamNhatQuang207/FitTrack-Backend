const localeMiddleware = require('../../src/middleware/localeMiddleware');

describe('localeMiddleware', () => {
  const run = (header) => {
    const req = { headers: header ? { 'accept-language': header } : {} };
    const next = jest.fn();
    localeMiddleware(req, {}, next);
    return { req, next };
  };

  test('defaults to en when Accept-Language header is missing', () => {
    const { req, next } = run(undefined);
    expect(req.lang).toBe('en');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('sets vi for vi and vi-VN headers', () => {
    expect(run('vi').req.lang).toBe('vi');
    expect(run('vi-VN,vi;q=0.9,en;q=0.8').req.lang).toBe('vi');
  });

  test('falls back to en for unsupported languages', () => {
    expect(run('fr-FR,fr;q=0.9').req.lang).toBe('en');
    expect(run('en-US,en;q=0.9').req.lang).toBe('en');
  });
});
