const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const safeEqual = (a, b) => {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
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
            { expiresIn: '12h' }
        );

        res.json({
            message: 'Admin login successful',
            token,
            username: expectedUser,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { adminLogin };
