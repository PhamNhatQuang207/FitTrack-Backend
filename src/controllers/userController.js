const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

const ALLOWED_LANGUAGES = ['en', 'vi'];

const getProgress = async (req, res) => {
    try {
        const userId = req.userId;
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
        res.status(500).json({ message: error.message });
    }
};

const updateLanguage = async (req, res) => {
    try {
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
        res.status(500).json({ code: 'INTERNAL_ERROR', message: error.message });
    }
};

module.exports = { getProgress, updateLanguage };
