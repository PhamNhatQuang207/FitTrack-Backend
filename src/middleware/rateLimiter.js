const rateLimit = require('express-rate-limit');

// Skip rate limiting in development
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDevelopment ? 10000 : 100, // Much higher limit in dev
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many requests from this IP, please try again after 15 minutes'
    },
    skip: (req) => isDevelopment // Skip entirely in development
});

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isDevelopment ? 10000 : 5, // Much higher limit in dev
    message: {
        message: 'Too many login attempts from this IP, please try again after an hour'
    },
    skip: (req) => isDevelopment // Skip entirely in development
});

module.exports = { limiter, authLimiter };
