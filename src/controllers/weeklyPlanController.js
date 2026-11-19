const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { safeServerError } = require('../utils/security');

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normalizePlanDays(days) {
    if (!Array.isArray(days) || days.length !== 7) {
        return { ok: false, error: 'Plan must contain exactly 7 days' };
    }
    const normalized = [];
    for (let index = 0; index < 7; index++) {
        const day = days[index];
        if (!day || typeof day !== 'object' || Array.isArray(day)) {
            return { ok: false, error: `Day at index ${index} must be an object` };
        }
        const isRestDay = Boolean(day.isRestDay);
        if (!isRestDay && day.workout !== undefined && day.workout !== null && typeof day.workout !== 'object') {
            return { ok: false, error: `Invalid workout object at day ${index}` };
        }
        normalized.push({
            dayOfWeek: index,
            dayName: DAY_NAMES[index],
            isRestDay,
            workout: isRestDay
                ? null
                : {
                      name: String(day.workout?.name || '').trim().slice(0, 200),
                      exercises: Array.isArray(day.workout?.exercises)
                          ? day.workout.exercises.slice(0, 50)
                          : [],
                  },
        });
    }
    return { ok: true, days: normalized };
}

// Create a new weekly plan template
const createWeeklyPlan = async (req, res) => {
    try {
        const { name, description, days } = req.body || {};
        const userId = req.userId;
        const db = getDb();

        // Validation
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Plan name and 7 days are required' });
        }
        if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Description must be a string up to 1000 characters' });
        }

        const dayCheck = normalizePlanDays(days);
        if (!dayCheck.ok) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Plan name and 7 days are required' });
        }

        const weeklyPlan = {
            userId: new ObjectId(userId),
            name: name.trim(),
            description: description ? description.trim() : '',
            days: dayCheck.days,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('weekly-plans').insertOne(weeklyPlan);

        res.status(201).json({
            message: 'Weekly plan created successfully',
            planId: result.insertedId
        });
    } catch (error) {
        return safeServerError(res, 'weeklyPlanController.createWeeklyPlan', error, { includeCode: true });
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
        return safeServerError(res, 'weeklyPlanController.getWeeklyPlans', error, { includeCode: true });
    }
};

// Get single weekly plan
const getWeeklyPlanById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid weekly plan ID' });
        }
        const userId = req.userId;
        const db = getDb();

        const plan = await db.collection('weekly-plans').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!plan) {
            return res.status(404).json({ code: 'PLAN_NOT_FOUND', message: 'Weekly plan not found' });
        }

        res.json({
            ...plan,
            id: plan._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        return safeServerError(res, 'weeklyPlanController.getWeeklyPlanById', error, { includeCode: true });
    }
};

// Update weekly plan
const updateWeeklyPlan = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid weekly plan ID' });
        }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid request body' });
        }

        const userId = req.userId;
        const db = getDb();
        const updates = { updatedAt: new Date() };

        if (req.body.name !== undefined) {
            if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 200) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid plan name' });
            }
            updates.name = req.body.name.trim();
        }
        if (req.body.description !== undefined) {
            if (typeof req.body.description !== 'string' || req.body.description.length > 1000) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Description must be a string up to 1000 characters' });
            }
            updates.description = req.body.description.trim();
        }
        if (req.body.days !== undefined) {
            const dayCheck = normalizePlanDays(req.body.days);
            if (!dayCheck.ok) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: dayCheck.error });
            }
            updates.days = dayCheck.days;
        }

        const result = await db.collection('weekly-plans').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ code: 'PLAN_NOT_FOUND', message: 'Weekly plan not found' });
        }

        res.json({ message: 'Weekly plan updated successfully' });
    } catch (error) {
        return safeServerError(res, 'weeklyPlanController.updateWeeklyPlan', error, { includeCode: true });
    }
};

// Delete weekly plan
const deleteWeeklyPlan = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid weekly plan ID' });
        }
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('weekly-plans').deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ code: 'PLAN_NOT_FOUND', message: 'Weekly plan not found' });
        }

        res.json({ message: 'Weekly plan deleted successfully' });
    } catch (error) {
        return safeServerError(res, 'weeklyPlanController.deleteWeeklyPlan', error, { includeCode: true });
    }
};

module.exports = {
    createWeeklyPlan,
    getWeeklyPlans,
    getWeeklyPlanById,
    updateWeeklyPlan,
    deleteWeeklyPlan
};
