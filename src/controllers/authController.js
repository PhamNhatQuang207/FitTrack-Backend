const { getDb } = require('../config/db');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmailSmart');
const {
    buildVerificationEmail,
    buildResetPasswordEmail,
    buildAccountExistsEmail,
    buildGoogleResetNoticeEmail,
} = require('../utils/emailTemplates');
const verifyGoogleToken = require('../utils/verifyGoogleToken');
const {
    REFRESH_COOKIE_NAME,
    hashToken,
    parseCookies,
    clearRefreshCookie,
    issueSessionTokenPair,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllUserRefreshTokens,
} = require('../utils/refreshToken');
const { safeServerError } = require('../utils/security');

const isMobileClient = (req) =>
    String(req.headers['x-client-type'] || '').toLowerCase() === 'mobile';

const extractRefreshToken = (req) => {
    if (isMobileClient(req)) {
        return typeof req.body?.refreshToken === 'string' && req.body.refreshToken.trim()
            ? req.body.refreshToken.trim()
            : null;
    }
    const cookies = parseCookies(req.headers.cookie);
    return cookies[REFRESH_COOKIE_NAME] || null;
};

const escapeEmailRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findUserByEmailInsensitive = (db, rawEmail) => {
    const normalized = String(rawEmail || '').trim().toLowerCase();
    return db.collection('users').findOne({
        email: { $regex: `^${escapeEmailRegex(normalized)}$`, $options: 'i' }
    });
};

// Must stay in step with the "expires in 24 hours" copy in the verification email.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const getFrontendBaseUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

const register = async (req, res) => {
    try {
        const email = req.body.email.trim().toLowerCase();
        const password = req.body.password;
        const name = req.body.name.trim();
        if (!name || name.length > 100) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Name must be 1 to 100 characters' });
        }
        const db = getDb();

        // Every branch below answers with exactly this. Telling the caller that an
        // address is already taken would let anyone enumerate the user base.
        const genericResponse = {
            message: 'Registration successful! Please check your email to verify your account.'
        };

        const existingUser = await findUserByEmailInsensitive(db, email);

        // Already registered and verified: leave DB untouched and keep HTTP response identical
        // to prevent enumeration, while notifying the real account owner by email.
        if (existingUser && existingUser.isVerified) {
            const isGoogleOnly = Boolean(existingUser.googleId && !existingUser.password);
            const hasGoogle = Boolean(existingUser.googleId);
            const frontendBase = getFrontendBaseUrl();
            const ownerLang = existingUser.preferredLanguage || req.lang || 'en';
            try {
                const emailContent = buildAccountExistsEmail({
                    name: existingUser.name,
                    loginUrl: `${frontendBase}/login`,
                    resetUrl: isGoogleOnly ? null : `${frontendBase}/reset-password`,
                    isGoogleOnly,
                    hasGoogle,
                    lang: ownerLang,
                });
                await sendEmail({
                    to: existingUser.email,
                    ...emailContent,
                });
            } catch (emailError) {
                console.error('Failed to send existing-account notice email:', emailError);
            }
            return res.status(201).json(genericResponse);
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate verification token (store SHA-256 hash in DB; send raw token in email)
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenHash = hashToken(verificationToken);
        const verificationTokenExpiry = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

        const preferredLanguage = req.lang || existingUser?.preferredLanguage || 'en';

        if (existingUser) {
            // Registered but never verified, so nobody has proven they own this
            // address. Let the latest attempt claim it with a fresh token — this
            // is also how a user whose link expired gets a new one.
            await db.collection('users').updateOne(
                { _id: existingUser._id },
                { $set: { name, password: hashedPassword, verificationToken: verificationTokenHash, verificationTokenExpiry, preferredLanguage } }
            );
        } else {
            await db.collection('users').insertOne({
                email,
                password: hashedPassword,
                name,
                preferredLanguage,
                isVerified: false,
                verificationToken: verificationTokenHash,
                verificationTokenExpiry,
                createdAt: new Date()
            });
        }

        // Send verification email
        const verificationUrl = `${getFrontendBaseUrl()}/verify-email?token=${verificationToken}`;
        
        try {
            const emailContent = buildVerificationEmail({ name, verifyUrl: verificationUrl, lang: preferredLanguage });
            await sendEmail({
                to: email,
                ...emailContent
            });
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
            // Continue registration even if email fails
        }
        
        // No userId in the body: returning one only on the insert path would leak
        // which branch ran, and hand out a real user id besides.
        res.status(201).json(genericResponse);
    } catch (error) {
        return safeServerError(res, 'authController.register', error, { includeCode: true });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = getDb();

        // Find user by email (case-insensitive)
        const user = await findUserByEmailInsensitive(db, email);
        if (!user || !user.password) {
            return res.status(400).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' });
        }

        // Verify password BEFORE revealing email verification status to prevent enumeration
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' });
        }

        // Check if email is verified
        if (user.isVerified === false) {
            return res.status(401).json({ code: 'AUTH_EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in' });
        }

        // Issue short-lived access token (body) + long-lived refresh token (HttpOnly cookie for web, body for mobile)
        const mobileClient = isMobileClient(req);
        const { accessToken: token, refreshToken } = await issueSessionTokenPair({
            db,
            userId: user._id,
            res,
            setCookie: !mobileClient,
        });

        res.json({
            message: 'Login successful',
            token,
            ...(mobileClient ? { refreshToken } : {}),
            userId: user._id,
            name: user.name,
            email: user.email,
            preferredLanguage: user.preferredLanguage || 'en'
        });
    } catch (error) {
        return safeServerError(res, 'authController.login', error, { includeCode: true });
    }
};

const verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;
        const db = getDb();

        // Find user by SHA-256 hash of verification token
        const user = await db.collection('users').findOne({
            verificationToken: hashToken(String(token || ''))
        });
        
        if (!user) {
            return res.status(400).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired verification token' });
        }

        // Check if already verified
        if (user.isVerified) {
            return res.status(200).json({ message: 'Email already verified. You can now log in.' });
        }

        // Enforce the 24-hour lifetime the email promises. A token issued before
        // expiry was tracked has no expiry field, and counts as expired; signing
        // up again re-sends a fresh link.
        if (!user.verificationTokenExpiry || user.verificationTokenExpiry < new Date()) {
            return res.status(400).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired verification token' });
        }

        // Update user: set verified and remove token
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { isVerified: true },
                $unset: { verificationToken: '', verificationTokenExpiry: '' }
            }
        );

        res.status(200).json({ message: 'Email verified successfully! You can now log in.' });
    } catch (error) {
        return safeServerError(res, 'authController.verifyEmail', error, { includeCode: true });
    }
};

const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        const db = getDb();

        // Find user by email (case-insensitive)
        const user = await findUserByEmailInsensitive(db, email);
        if (!user) {
            // Don't reveal if user exists or not for security
            return res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
        }

        if (!user.password) {
            const frontendBase = getFrontendBaseUrl();
            try {
                const emailContent = buildGoogleResetNoticeEmail({
                    name: user.name,
                    loginUrl: `${frontendBase}/login`,
                    lang: user.preferredLanguage || req.lang || 'en',
                });
                await sendEmail({
                    to: user.email,
                    ...emailContent,
                });
            } catch (emailError) {
                console.error('Failed to send Google sign-in notice email:', emailError);
            }
            return res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
        }

        // Generate reset token (store SHA-256 hash in DB; send raw token in email)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = hashToken(resetToken);
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

        // Save reset token hash to user
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: {
                    resetPasswordToken: resetTokenHash,
                    resetPasswordExpiry: resetTokenExpiry
                }
            }
        );

        // Send reset email
        const resetUrl = `${getFrontendBaseUrl()}/reset-password?token=${resetToken}`;

        try {
            const emailContent = buildResetPasswordEmail({
                name: user.name,
                resetUrl,
                lang: user.preferredLanguage || req.lang || 'en'
            });
            await sendEmail({
                to: user.email,
                ...emailContent
            });
        } catch (emailError) {
            console.error('Failed to send password reset email:', emailError);
        }

        res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
    } catch (error) {
        return safeServerError(res, 'authController.requestPasswordReset', error, { includeCode: true });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;
        const db = getDb();

        // Find user by SHA-256 hash of reset token and check expiry
        const user = await db.collection('users').findOne({
            resetPasswordToken: hashToken(String(token || '')),
            resetPasswordExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired reset token' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update password and remove reset token
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword },
                $unset: { resetPasswordToken: '', resetPasswordExpiry: '' }
            }
        );

        await revokeAllUserRefreshTokens({ db, userId: user._id });

        res.status(200).json({ message: 'Password reset successful! You can now log in with your new password.' });
    } catch (error) {
        return safeServerError(res, 'authController.resetPassword', error, { includeCode: true });
    }
};

const googleLogin = async (req, res) => {
    try {
        const { idToken } = req.body;
        let payload;
        try {
            payload = await verifyGoogleToken(idToken);
        } catch {
            return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid Google token' });
        }

        if (!payload || !payload.email || !payload.email_verified) {
            return res.status(401).json({ code: 'AUTH_EMAIL_NOT_VERIFIED', message: 'Google account email is not verified' });
        }

        const email = payload.email.trim().toLowerCase();
        const name = payload.name || email.split('@')[0];
        const googleId = payload.sub;
        const db = getDb();

        let user = await findUserByEmailInsensitive(db, email);

        if (!user) {
            const newUser = {
                email,
                name,
                googleId,
                authProvider: 'google',
                preferredLanguage: req.lang || 'en',
                isVerified: true,
                createdAt: new Date()
            };
            const { insertedId } = await db.collection('users').insertOne(newUser);
            user = { ...newUser, _id: insertedId };
        } else if (!user.isVerified) {
            await db.collection('users').updateOne(
                { _id: user._id },
                {
                    $set: { isVerified: true, googleId, name },
                    $unset: { password: '', verificationToken: '', verificationTokenExpiry: '' }
                }
            );
        } else if (user.googleId && user.googleId !== googleId) {
            return res.status(403).json({
                code: 'AUTH_PROVIDER_MISMATCH',
                message: 'This email is already linked to another Google account'
            });
        } else if (!user.googleId) {
            await db.collection('users').updateOne(
                { _id: user._id },
                { $set: { googleId } }
            );
        }

        const mobileClient = isMobileClient(req);
        const { accessToken: token, refreshToken } = await issueSessionTokenPair({
            db,
            userId: user._id,
            res,
            setCookie: !mobileClient,
        });

        res.json({
            message: 'Login successful',
            token,
            ...(mobileClient ? { refreshToken } : {}),
            userId: user._id,
            name: user.isVerified ? (user.name || name) : name,
            email: user.email,
            preferredLanguage: user.preferredLanguage || 'en'
        });
    } catch (error) {
        return safeServerError(res, 'authController.googleLogin', error, { includeCode: true });
    }
};

const refresh = async (req, res) => {
    try {
        const mobileClient = isMobileClient(req);
        const rawToken = extractRefreshToken(req);
        if (!rawToken) {
            if (!mobileClient) {
                clearRefreshCookie(res);
            }
            return res.status(401).json({ code: 'AUTH_UNAUTHORIZED', message: 'Refresh token missing' });
        }

        const db = getDb();
        const rotated = await rotateRefreshToken({ db, rawToken, res, setCookie: !mobileClient });
        if (!rotated) {
            return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired refresh token' });
        }

        const user = await db.collection('users').findOne(
            { _id: rotated.userId },
            { projection: { name: 1, email: 1, preferredLanguage: 1 } }
        );
        if (!user) {
            await revokeAllUserRefreshTokens({ db, userId: rotated.userId });
            if (!mobileClient) {
                clearRefreshCookie(res);
            }
            return res.status(401).json({ code: 'AUTH_UNAUTHORIZED', message: 'User not found' });
        }

        return res.json({
            token: rotated.accessToken,
            ...(mobileClient ? { refreshToken: rotated.refreshToken } : {}),
            userId: user._id,
            name: user.name,
            email: user.email,
            preferredLanguage: user.preferredLanguage || 'en'
        });
    } catch (error) {
        return safeServerError(res, 'authController.refresh', error, { includeCode: true });
    }
};

const logout = async (req, res) => {
    const mobileClient = isMobileClient(req);
    try {
        const rawToken = extractRefreshToken(req);
        if (rawToken) {
            const db = getDb();
            await revokeRefreshToken({ db, rawToken });
        }
        if (!mobileClient) {
            clearRefreshCookie(res);
        }
        return res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        if (!mobileClient) {
            clearRefreshCookie(res);
        }
        return safeServerError(res, 'authController.logout', error, { includeCode: true });
    }
};

module.exports = { register, login, googleLogin, refresh, logout, verifyEmail, requestPasswordReset, resetPassword };