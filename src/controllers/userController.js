const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { safeServerError } = require('../utils/security');

const ALLOWED_LANGUAGES = ['en', 'vi'];

const getProgress = async (req, res) => {
    try {
        const userId = req.userId;
        if (!ObjectId.isValid(userId)) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        const db = getDb();

        // Find user and return only specific fields
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(userId) },
            { 
                projection: { 
                    name: 1,
                    height: 1,
                    age: 1,
                    sex: 1,
                    weightHistory: 1, 
                    bodyFatHistory: 1,
                    _id: 0  // Exclude _id from response
                } 
            }
        );

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        return safeServerError(res, 'userController.getProgress', error);
    }
};

const updateLanguage = async (req, res) => {
    try {
        if (!ObjectId.isValid(req.userId)) {
            return res.status(401).json({ code: 'AUTH_UNAUTHORIZED', message: 'Invalid or expired token' });
        }
        const { preferredLanguage } = req.body || {};
        if (!ALLOWED_LANGUAGES.includes(preferredLanguage)) {
            return res.status(400).json({
                code: 'USER_INVALID_LANGUAGE',
                message: 'preferredLanguage must be "en" or "vi"',
            });
        }
        const db = getDb();
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.userId) },
            { $set: { preferredLanguage, updatedAt: new Date() } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
        }
        res.json({ preferredLanguage });
    } catch (error) {
        return safeServerError(res, 'userController.updateLanguage', error, {
            includeCode: true,
            code: 'INTERNAL_ERROR',
        });
    }
};

module.exports = { getProgress, updateLanguage };
