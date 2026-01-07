const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Create a new workout session
const createWorkoutSession = async (req, res) => {
    try {
        const { name, exercises, scheduledDate, notes, weeklyScheduleId, dayOfWeek } = req.body;
        const userId = req.userId;
        const db = getDb();

        // Validation
        if (!name || !exercises || exercises.length === 0) {
            return res.status(400).json({ message: 'Workout name and at least one exercise are required' });
        }

        // Create workout session
        const session = {
            userId: new ObjectId(userId),
            name,
            date: scheduledDate ? new Date(scheduledDate) : new Date(),
            exercises: exercises.map(ex => ({
                exerciseId: new ObjectId(ex.exerciseId),
                exerciseName: ex.exerciseName,
                category: ex.category,
                targetSets: ex.targetSets || 3,
                targetReps: ex.targetReps || 10,
                targetWeight: ex.targetWeight || 0,
                completed: false,
                actualSets: []
            })),
            status: 'planned',
            completedAt: null,
            notes: notes || '',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add weekly schedule metadata if provided
        if (weeklyScheduleId) {
            session.weeklyScheduleId = new ObjectId(weeklyScheduleId);
        }
        if (dayOfWeek !== undefined && dayOfWeek !== null) {
            session.dayOfWeek = dayOfWeek;
        }

        const result = await db.collection('workout-sessions').insertOne(session);

        res.status(201).json({
            message: 'Workout session created successfully',
            sessionId: result.insertedId
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get all workout sessions for user
const getWorkoutSessions = async (req, res) => {
    try {
        const userId = req.userId;
        const { status } = req.query; // Optional filter by status
        const db = getDb();

        const query = { userId: new ObjectId(userId) };
        if (status) {
            query.status = status;
        }

        const sessions = await db.collection('workout-sessions')
            .find(query)
            .sort({ date: -1 })
            .toArray();

        res.json(sessions.map(session => ({
            ...session,
            id: session._id,
            _id: undefined,
            userId: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get single workout session
const getWorkoutSessionById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const session = await db.collection('workout-sessions').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!session) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        res.json({
            ...session,
            id: session._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update workout session
const updateWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const updates = req.body;
        const db = getDb();

        // Remove system fields from updates
        delete updates._id;
        delete updates.userId;
        delete updates.createdAt;

        updates.updatedAt = new Date();

        const result = await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Start workout session (mark as in-progress)
const startWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            {
                $set: {
                    status: 'in-progress',
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session started' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Complete workout session
const completeWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            {
                $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session completed' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Log a set for an exercise
const logSet = async (req, res) => {
    try {
        const { id } = req.params; // session id
        const { exerciseId, setNumber, reps, weight, completed } = req.body;
        const userId = req.userId;
        const db = getDb();

        const session = await db.collection('workout-sessions').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!session) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        // Find the exercise in the session
        const exerciseIndex = session.exercises.findIndex(
            ex => ex.exerciseId.toString() === exerciseId
        );

        if (exerciseIndex === -1) {
            return res.status(404).json({ message: 'Exercise not found in session' });
        }

        // Add the set
        const setData = {
            setNumber: parseInt(setNumber),
            reps: parseInt(reps),
            weight: parseFloat(weight),
            completed: completed !== false
        };

        const updatePath = `exercises.${exerciseIndex}.actualSets`;
        
        await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id) },
            {
                $push: { [updatePath]: setData },
                $set: { updatedAt: new Date() }
            }
        );

        res.json({ message: 'Set logged successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete workout session
const deleteWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('workout-sessions').deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    createWorkoutSession,
    getWorkoutSessions,
    getWorkoutSessionById,
    updateWorkoutSession,
    startWorkoutSession,
    completeWorkoutSession,
    logSet,
    deleteWorkoutSession
};
