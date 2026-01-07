const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

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

module.exports = { getProgress };
