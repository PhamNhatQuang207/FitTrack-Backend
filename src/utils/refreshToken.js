const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const REFRESH_COOKIE_NAME = 'fittrack_refresh';
const REFRESH_COLLECTION = 'refresh-tokens';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const parseCookies = (cookieHeader = '') => {
    if (!cookieHeader || typeof cookieHeader !== 'string') {
        return {};
    }

    return cookieHeader.split(';').reduce((acc, part) => {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) return acc;
        const key = part.slice(0, eqIdx).trim();
        const rawVal = part.slice(eqIdx + 1).trim();
        if (!key) return acc;
        try {
            acc[key] = decodeURIComponent(rawVal);
        } catch {
            acc[key] = rawVal;
        }
        return acc;
    }, {});
};

const getBaseCookieOptions = () => {
    // Render injects RENDER=true even when NODE_ENV isn't explicitly set in dashboard env vars.
    const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    // Cross-origin Vercel previews need SameSite=None over HTTPS, which also works
    // for fittrack.io.vn -> api.fittrack.io.vn; localhost dev uses HTTP so it needs Lax.
    const sameSite = process.env.COOKIE_SAME_SITE || (isProd ? 'none' : 'lax');
    const options = {
        httpOnly: true,
        secure: isProd,
        sameSite,
        path: '/api/auth',
    };
    if (process.env.COOKIE_DOMAIN) {
        options.domain = process.env.COOKIE_DOMAIN;
    }
    return options;
};

const setRefreshCookie = (res, rawToken) => {
    res.cookie(REFRESH_COOKIE_NAME, rawToken, {
        ...getBaseCookieOptions(),
        maxAge: REFRESH_TOKEN_TTL_MS,
    });
};

const clearRefreshCookie = (res) => {
    res.clearCookie(REFRESH_COOKIE_NAME, getBaseCookieOptions());
};

const signAccessToken = (userId) =>
    jwt.sign({ userId }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

const createRefreshTokenRecord = async ({ db, userId }) => {
    const rawToken = crypto.randomBytes(40).toString('hex');
    const now = new Date();
    await db.collection(REFRESH_COLLECTION).insertOne({
        tokenHash: hashToken(rawToken),
        userId: new ObjectId(userId),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        createdAt: now,
    });
    return rawToken;
};

/**
 * Issues a short-lived access JWT + refresh token pair and optionally sets the HttpOnly refresh cookie.
 */
const issueSessionTokenPair = async ({ db, userId, res, setCookie = true }) => {
    const rawRefreshToken = await createRefreshTokenRecord({ db, userId });
    if (setCookie) {
        setRefreshCookie(res, rawRefreshToken);
    }
    return {
        accessToken: signAccessToken(userId),
        refreshToken: rawRefreshToken,
    };
};

/**
 * Issues a short-lived access JWT and optionally sets a new HttpOnly refresh cookie.
 */
const issueSessionTokens = async ({ db, userId, res, setCookie = true }) => {
    const { accessToken } = await issueSessionTokenPair({ db, userId, res, setCookie });
    return accessToken;
};

/**
 * Atomically consumes a single-use refresh token, validates expiry, rotates
 * a new refresh cookie (unless disabled) + token record, and returns { accessToken, refreshToken, userId } or null.
 */
const rotateRefreshToken = async ({ db, rawToken, res, setCookie = true }) => {
    if (!rawToken) return null;

    const existing = await db.collection(REFRESH_COLLECTION).findOneAndDelete({
        tokenHash: hashToken(rawToken),
    });

    if (!existing || !existing.expiresAt || existing.expiresAt <= new Date()) {
        if (setCookie) {
            clearRefreshCookie(res);
        }
        return null;
    }

    const { accessToken, refreshToken } = await issueSessionTokenPair({
        db,
        userId: existing.userId,
        res,
        setCookie,
    });

    return { accessToken, refreshToken, userId: existing.userId };
};

const revokeRefreshToken = async ({ db, rawToken }) => {
    if (!rawToken) return;
    await db.collection(REFRESH_COLLECTION).deleteOne({
        tokenHash: hashToken(rawToken),
    });
};

const revokeAllUserRefreshTokens = async ({ db, userId }) => {
    await db.collection(REFRESH_COLLECTION).deleteMany({
        userId: new ObjectId(userId),
    });
};

module.exports = {
    REFRESH_COOKIE_NAME,
    REFRESH_COLLECTION,
    ACCESS_TOKEN_EXPIRES_IN,
    REFRESH_TOKEN_TTL_MS,
    hashToken,
    parseCookies,
    getBaseCookieOptions,
    setRefreshCookie,
    clearRefreshCookie,
    signAccessToken,
    issueSessionTokenPair,
    issueSessionTokens,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllUserRefreshTokens,
};
