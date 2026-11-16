/**
 * Resolve request locale ('en' | 'vi') from Accept-Language header.
 * Defaults to 'en' when header is missing or unsupported.
 */
function localeMiddleware(req, _res, next) {
  const header = String(req.headers['accept-language'] || '').trim().toLowerCase();
  req.lang = header.startsWith('vi') ? 'vi' : 'en';
  next();
}

module.exports = localeMiddleware;
