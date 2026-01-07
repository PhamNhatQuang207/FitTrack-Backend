const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Create a new weekly plan template
const createWeeklyPlan = async (req, res) => {
    try {
        const { name, description, days } = req.body;
        const userId = req.userId;
        const db = getDb();

        // Validation
        if (!name || !days || days.length !== 7) {
            return res.status(400).json({ message: 'Plan name and 7 days are required' });
        }

        const weeklyPlan = {
            userId: new ObjectId(userId),
            name,
            description: description || '',
            days: days.map((day, index) => ({
                dayOfWeek: index, // 0 = Monday, 6 = Sunday
                dayName: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index],
                isRestDay: day.isRestDay || false,
                workout: day.isRestDay ? null : {
                    name: day.workout?.name || '',
                    exercises: day.workout?.exercises || []
                }
            })),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('weekly-plans').insertOne(weeklyPlan);

        res.status(201).json({
            message: 'Weekly plan created successfully',
            planId: result.insertedId
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get all weekly plans for user
const getWeeklyPlans = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        const plans = await db.collection('weekly-plans')
            .find({ userId: new ObjectId(userId) })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(plans.map(plan => ({
            ...plan,
            id: plan._id,
            _id: undefined,
            userId: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get single weekly plan
const getWeeklyPlanById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const plan = await db.collection('weekly-plans').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!plan) {
            return res.status(404).json({ message: 'Weekly plan not found' });
        }

        res.json({
            ...plan,
            id: plan._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update weekly plan
const updateWeeklyPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const updates = req.body;
        const db = getDb();

        delete updates._id;
        delete updates.userId;
        delete updates.createdAt;
        updates.updatedAt = new Date();

        const result = await db.collection('weekly-plans').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Weekly plan not found' });
        }

        res.json({ message: 'Weekly plan updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete weekly plan
const deleteWeeklyPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('weekly-plans').deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Weekly plan not found' });
        }

        res.json({ message: 'Weekly plan deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    createWeeklyPlan,
    getWeeklyPlans,
    getWeeklyPlanById,
    updateWeeklyPlan,
    deleteWeeklyPlan
};
