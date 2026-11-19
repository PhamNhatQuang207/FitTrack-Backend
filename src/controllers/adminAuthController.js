const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { safeServerError } = require('../utils/security');

const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
};

const adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const expectedUser = process.env.ADMIN_USERNAME;
        const expectedPass = process.env.ADMIN_PASSWORD;

        if (!expectedUser || !expectedPass) {
            return res.status(503).json({ message: 'Admin credentials are not configured on server' });
        }

        const userOk = safeEqual(username, expectedUser);
        const passOk = safeEqual(password, expectedPass);

        if (!userOk || !passOk) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        const token = jwt.sign(
            { isAdmin: true, username: expectedUser },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '12h' }
        );

        res.json({
            message: 'Admin login successful',
            token,
            username: expectedUser,
        });
    } catch (error) {
        return safeServerError(res, 'adminAuthController.adminLogin', error);
    }
};

module.exports = { adminLogin };
