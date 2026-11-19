const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8081',
  'https://gym-tracking-123.vercel.app',
  'https://fittrack.io.vn',
  'https://www.fittrack.io.vn',
];

/**
 * Check that an optional URL string uses only http: or https: protocols.
 * Empty/nullish values are treated as valid (clearing/omitting the field).
 */
function isSafeHttpUrl(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Defense-in-depth CSRF check for cookie-authenticated auth endpoints (/refresh, /logout).
 * Skips mobile clients (no cookies used) and non-browser clients lacking Origin/Referer/Sec-Fetch-Site.
 */
function verifyCookieCsrfOrigin(req, res, next) {
  if (String(req.headers['x-client-type'] || '').toLowerCase() === 'mobile') {
    return next();
  }

  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ code: 'AUTH_CSRF_FORBIDDEN', message: 'Forbidden origin' });
    }
    return next();
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!ALLOWED_ORIGINS.includes(refOrigin)) {
        return res.status(403).json({ code: 'AUTH_CSRF_FORBIDDEN', message: 'Forbidden origin' });
      }
      return next();
    } catch {
      return res.status(403).json({ code: 'AUTH_CSRF_FORBIDDEN', message: 'Forbidden origin' });
    }
  }

  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return res.status(403).json({ code: 'AUTH_CSRF_FORBIDDEN', message: 'Forbidden cross-site request' });
  }

  return next();
}

/**
 * Log internal errors server-side and send a generic 500 response without leaking internals.
 */
function safeServerError(res, context, error, { includeCode = false, code = 'SERVER_ERROR' } = {}) {
  console.error(`[${context}]`, error);
  return res.status(500).json(
    includeCode ? { code, message: 'Internal server error' } : { message: 'Internal server error' }
  );
}

module.exports = {
  ALLOWED_ORIGINS,
  isSafeHttpUrl,
  verifyCookieCsrfOrigin,
  safeServerError,
};
