const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Helper function to normalize exercises to new format (backward compatibility)
const normalizeExercises = (exercises) => {
    return exercises.map(ex => {
        // If already in new format with sets array, return as-is
        if (ex.sets && Array.isArray(ex.sets)) {
            return ex;
        }
        
        // Convert old format to new format
        if (ex.targetSets && ex.targetReps !== undefined && ex.targetWeight !== undefined) {
            const sets = [];
            for (let i = 1; i <= ex.targetSets; i++) {
                sets.push({
                    setNumber: i,
                    targetReps: ex.targetReps,
                    targetWeight: ex.targetWeight
                });
            }
            
            return {
                ...ex,
                sets,
                // Keep old fields for compatibility
                _convertedFromOldFormat: true
            };
        }
        
        // If neither format, return as-is
        return ex;
    });
};

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
            exercises: exercises.map(ex => {
                // Support both old format (targetSets/Reps/Weight) and new format (sets array)
                let exerciseData = {
                    exerciseId: new ObjectId(ex.exerciseId),
                    exerciseName: ex.exerciseName,
                    category: ex.category,
                    completed: false,
                    actualSets: []
                };

                // New format: sets array with individual reps/weight per set
                if (ex.sets && Array.isArray(ex.sets)) {
                    exerciseData.sets = ex.sets.map(set => ({
                        setNumber: set.setNumber,
                        targetReps: set.targetReps || 10,
                        targetWeight: set.targetWeight || 0
                    }));
                } 
                // Old format: single target for all sets (backward compatibility)
                else {
                    exerciseData.targetSets = ex.targetSets || 3;
                    exerciseData.targetReps = ex.targetReps || 10;
                    exerciseData.targetWeight = ex.targetWeight || 0;
                }

                return exerciseData;
            }),
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
            exercises: normalizeExercises(session.exercises || []),
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
            exercises: normalizeExercises(session.exercises || []),
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
