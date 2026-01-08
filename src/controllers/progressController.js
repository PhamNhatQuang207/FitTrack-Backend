const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

const updateProgress = async (req, res) => {
    try {
        const { name, weight, bodyFat, height, age, sex } = req.body;
        const userId = req.userId;
        const db = getDb();

        // Validation
        if (age !== undefined) {
            const ageNum = Number(age);
            if (isNaN(ageNum) || ageNum < 13 || ageNum > 100) {
                return res.status(400).json({ message: 'Age must be between 13 and 100' });
            }
        }

        if (height !== undefined) {
            const heightNum = Number(height);
            if (isNaN(heightNum) || heightNum < 100 || heightNum > 250) {
                return res.status(400).json({ message: 'Height must be between 100 and 250 cm' });
            }
        }

        if (sex !== undefined) {
            const validSexOptions = ['Male', 'Female', 'Other'];
            if (!validSexOptions.includes(sex)) {
                return res.status(400).json({ message: 'Sex must be Male, Female, or Other' });
            }
        }

        // Build the $set update object for profile fields
        const setUpdate = {};
        if (name !== undefined) setUpdate.name = name;
        if (height !== undefined) setUpdate.height = Number(height);
        if (age !== undefined) setUpdate.age = Number(age);
        if (sex !== undefined) setUpdate.sex = sex;

        // Build the $push update object for history fields
        const pushUpdate = {};
        if (weight !== undefined) {
            pushUpdate.weightHistory = { value: Number(weight), date: new Date() };
        }
        if (bodyFat !== undefined) {
            pushUpdate.bodyFatHistory = { value: Number(bodyFat), date: new Date() };
        }

        // Check if any data was provided
        if (Object.keys(setUpdate).length === 0 && Object.keys(pushUpdate).length === 0) {
            return res.status(400).json({ message: 'No progress data provided' });
        }

        // Build the complete update object
        const updateObject = {};
        if (Object.keys(setUpdate).length > 0) {
            updateObject.$set = setUpdate;
        }
        if (Object.keys(pushUpdate).length > 0) {
            updateObject.$push = pushUpdate;
        }

        // Update user document
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            updateObject
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'Progress updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { updateProgress };
