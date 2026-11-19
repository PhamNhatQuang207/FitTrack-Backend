const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { safeServerError } = require('../utils/security');

const MAX_EXERCISES = 50;
const MAX_SETS = 50;
const ALLOWED_STATUSES = ['planned', 'in-progress', 'in_progress', 'paused', 'completed'];

const isFiniteNumberInput = (val) =>
    (typeof val === 'number' || (typeof val === 'string' && val.trim() !== '')) &&
    Number.isFinite(Number(val));

// Helper function to normalize exercises to new format (backward compatibility)
const normalizeExercises = (exercises) => {
    if (!Array.isArray(exercises)) return [];
    return exercises.map(ex => {
        // If already in new format with sets array, return as-is
        if (ex.sets && Array.isArray(ex.sets)) {
            return ex;
        }
        
        // Convert old format to new format (capped to prevent OOM DoS)
        if (ex.targetSets && ex.targetReps !== undefined && ex.targetWeight !== undefined) {
            const count = Math.min(Math.max(0, Math.floor(Number(ex.targetSets) || 0)), MAX_SETS);
            const sets = [];
            for (let i = 1; i <= count; i++) {
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
        const { name, exercises, scheduledDate, notes, weeklyScheduleId, dayOfWeek } = req.body || {};
        const userId = req.userId;
        const db = getDb();

        // Validation
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 200 || !Array.isArray(exercises) || exercises.length === 0 || exercises.length > MAX_EXERCISES) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Workout name (max 200 chars) and exercises array (1..50 items) are required' });
        }

        let parsedDate = new Date();
        if (scheduledDate !== undefined && scheduledDate !== null) {
            parsedDate = new Date(scheduledDate);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid scheduledDate' });
            }
        }

        if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Notes must be a string up to 2000 characters' });
        }

        let safeWeeklyScheduleId = null;
        if (weeklyScheduleId !== undefined && weeklyScheduleId !== null) {
            if (typeof weeklyScheduleId !== 'string' || !weeklyScheduleId.trim() || weeklyScheduleId.length > 100) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid weeklyScheduleId' });
            }
            safeWeeklyScheduleId = weeklyScheduleId.trim();
        }

        let safeDayOfWeek = null;
        if (dayOfWeek !== undefined && dayOfWeek !== null) {
            if (!isFiniteNumberInput(dayOfWeek)) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'dayOfWeek must be an integer between 0 and 6' });
            }
            const parsedDay = Number(dayOfWeek);
            if (!Number.isInteger(parsedDay) || parsedDay < 0 || parsedDay > 6) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'dayOfWeek must be an integer between 0 and 6' });
            }
            safeDayOfWeek = parsedDay;
        }

        const sanitizedExercises = [];
        for (const ex of exercises) {
            if (
                !ex ||
                typeof ex !== 'object' ||
                !ObjectId.isValid(String(ex.exerciseId || '')) ||
                typeof ex.exerciseName !== 'string' ||
                !ex.exerciseName.trim() ||
                typeof ex.category !== 'string' ||
                !ex.category.trim()
            ) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Each exercise requires valid exerciseId, exerciseName, and category' });
            }

            const exerciseData = {
                exerciseId: new ObjectId(String(ex.exerciseId)),
                exerciseName: ex.exerciseName.trim(),
                category: ex.category.trim(),
                completed: false,
                actualSets: []
            };

            if (ex.sets !== undefined) {
                if (!Array.isArray(ex.sets) || ex.sets.length === 0 || ex.sets.length > MAX_SETS) {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `Each exercise sets array must have 1..${MAX_SETS} items` });
                }
                const sanitizedSets = [];
                for (let idx = 0; idx < ex.sets.length; idx++) {
                    const set = ex.sets[idx];
                    if (!set || typeof set !== 'object') {
                        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid set entry' });
                    }
                    const setNum = set.setNumber !== undefined ? Number(set.setNumber) : idx + 1;
                    const tReps = set.targetReps !== undefined ? Number(set.targetReps) : 10;
                    const tWeight = set.targetWeight !== undefined ? Number(set.targetWeight) : 0;
                    if (!Number.isFinite(setNum) || setNum < 1 || !Number.isFinite(tReps) || tReps < 0 || !Number.isFinite(tWeight) || tWeight < 0) {
                        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Set targets must be valid non-negative numbers' });
                    }
                    sanitizedSets.push({
                        setNumber: setNum,
                        targetReps: tReps || 10,
                        targetWeight: tWeight || 0
                    });
                }
                exerciseData.sets = sanitizedSets;
            } else {
                const targetSets = ex.targetSets !== undefined ? Number(ex.targetSets) : 3;
                const targetReps = ex.targetReps !== undefined ? Number(ex.targetReps) : 10;
                const targetWeight = ex.targetWeight !== undefined ? Number(ex.targetWeight) : 0;
                if (
                    !Number.isInteger(targetSets) || targetSets < 1 || targetSets > MAX_SETS ||
                    !Number.isFinite(targetReps) || targetReps < 0 ||
                    !Number.isFinite(targetWeight) || targetWeight < 0
                ) {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `targetSets must be 1..${MAX_SETS} with valid targetReps and targetWeight` });
                }
                exerciseData.targetSets = targetSets;
                exerciseData.targetReps = targetReps;
                exerciseData.targetWeight = targetWeight;
            }

            sanitizedExercises.push(exerciseData);
        }

        // Check if an active session already exists for this schedule and day
        if (safeWeeklyScheduleId && safeDayOfWeek !== null) {
            const scheduleIdQueries = [{ weeklyScheduleId: safeWeeklyScheduleId }];
            if (ObjectId.isValid(safeWeeklyScheduleId)) {
                scheduleIdQueries.push({ weeklyScheduleId: new ObjectId(safeWeeklyScheduleId) });
            }

            const dayOfWeekQueries = [
                { dayOfWeek: safeDayOfWeek },
                { dayOfWeek: String(safeDayOfWeek) }
            ];

            const existingSession = await db.collection('workout-sessions').findOne({
                userId: new ObjectId(userId),
                $and: [
                    { $or: scheduleIdQueries },
                    { $or: dayOfWeekQueries },
                    { status: { $in: ['planned', 'in-progress', 'in_progress', 'paused'] } } // Only resume active sessions
                ]
            });

            if (existingSession) {
                // Return existing session formatted correctly
                return res.status(200).json({
                    message: 'Resuming existing workout session',
                    sessionId: existingSession._id,
                    session: {
                        ...existingSession,
                        exercises: normalizeExercises(existingSession.exercises || []),
                        id: existingSession._id,
                        _id: undefined,
                        userId: undefined
                    }
                });
            }
        }

        // Create workout session
        const session = {
            userId: new ObjectId(userId),
            name: name.trim(),
            date: parsedDate,
            exercises: sanitizedExercises,
            status: 'planned',
            completedAt: null,
            notes: notes || '',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add weekly schedule metadata if provided
        if (safeWeeklyScheduleId) {
            session.weeklyScheduleId = ObjectId.isValid(safeWeeklyScheduleId)
                ? new ObjectId(safeWeeklyScheduleId)
                : safeWeeklyScheduleId;
        }
        
        if (safeDayOfWeek !== null) {
            session.dayOfWeek = safeDayOfWeek;
        }

        const result = await db.collection('workout-sessions').insertOne(session);

        res.status(201).json({
            message: 'Workout session created successfully',
            sessionId: result.insertedId
        });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.createWorkoutSession', error, { includeCode: true });
    }
};

// Get all workout sessions for user
const getWorkoutSessions = async (req, res) => {
    try {
        const userId = req.userId;
        const { status } = req.query; // Optional filter by status
        if (status !== undefined && typeof status !== 'string') {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid status filter' });
        }
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
        return safeServerError(res, 'workoutSessionController.getWorkoutSessions', error, { includeCode: true });
    }
};

// Get single workout session
const getWorkoutSessionById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
        const userId = req.userId;
        const db = getDb();

        const session = await db.collection('workout-sessions').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!session) {
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        res.json({
            ...session,
            exercises: normalizeExercises(session.exercises || []),
            id: session._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.getWorkoutSessionById', error, { includeCode: true });
    }
};

// Update workout session
const updateWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid request body' });
        }

        const userId = req.userId;
        const db = getDb();
        const updates = { updatedAt: new Date() };

        if (req.body.name !== undefined) {
            if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 200) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid session name' });
            }
            updates.name = req.body.name.trim();
        }
        if (req.body.notes !== undefined) {
            if (typeof req.body.notes !== 'string' || req.body.notes.length > 2000) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Notes must be a string up to 2000 characters' });
            }
            updates.notes = req.body.notes;
        }
        if (req.body.date !== undefined) {
            const parsedDate = new Date(req.body.date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid date' });
            }
            updates.date = parsedDate;
        }
        if (req.body.status !== undefined) {
            if (typeof req.body.status !== 'string' || !ALLOWED_STATUSES.includes(req.body.status)) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid status' });
            }
            updates.status = req.body.status;
        }
        if (req.body.exercises !== undefined) {
            if (!Array.isArray(req.body.exercises) || req.body.exercises.length > MAX_EXERCISES) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: `Exercises must be an array of at most ${MAX_EXERCISES} items` });
            }
            for (const ex of req.body.exercises) {
                if (!ex || typeof ex !== 'object') {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid exercise entry' });
                }
                if (ex.sets !== undefined && (!Array.isArray(ex.sets) || ex.sets.length > MAX_SETS)) {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `Exercise sets must have at most ${MAX_SETS} items` });
                }
                if (ex.targetSets !== undefined && (!Number.isInteger(Number(ex.targetSets)) || Number(ex.targetSets) < 0 || Number(ex.targetSets) > MAX_SETS)) {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `targetSets must be 0..${MAX_SETS}` });
                }
                if (ex.actualSets !== undefined && (!Array.isArray(ex.actualSets) || ex.actualSets.length > MAX_SETS)) {
                    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `actualSets must have at most ${MAX_SETS} items` });
                }
            }
            updates.exercises = req.body.exercises;
        }

        const result = await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session updated successfully' });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.updateWorkoutSession', error, { includeCode: true });
    }
};

// Start workout session (mark as in-progress)
const startWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
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
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session started' });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.startWorkoutSession', error, { includeCode: true });
    }
};

// Complete workout session
const completeWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
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
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session completed' });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.completeWorkoutSession', error, { includeCode: true });
    }
};

// Log a set for an exercise
const logSet = async (req, res) => {
    try {
        const { id } = req.params; // session id
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
        const { exerciseId, setNumber, reps, weight, completed } = req.body || {};
        if (typeof exerciseId !== 'string' || !exerciseId.trim()) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'exerciseId is required' });
        }
        if (
            !isFiniteNumberInput(setNumber) ||
            !isFiniteNumberInput(reps) ||
            !isFiniteNumberInput(weight)
        ) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'setNumber, reps, and weight must be valid numbers' });
        }

        const parsedSetNum = Number(setNumber);
        const parsedReps = Number(reps);
        const parsedWeight = Number(weight);
        if (
            !Number.isInteger(parsedSetNum) || parsedSetNum < 1 || parsedSetNum > MAX_SETS ||
            !Number.isInteger(parsedReps) || parsedReps < 0 || parsedReps > 1000 ||
            parsedWeight < 0 || parsedWeight > 2000
        ) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Set values out of allowed range' });
        }

        const userId = req.userId;
        const db = getDb();

        const session = await db.collection('workout-sessions').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!session) {
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        // Find the exercise in the session
        const exerciseIndex = (session.exercises || []).findIndex(
            ex => ex.exerciseId && ex.exerciseId.toString() === exerciseId
        );

        if (exerciseIndex === -1) {
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Exercise not found in session' });
        }

        // Add the set
        const setData = {
            setNumber: parsedSetNum,
            reps: parsedReps,
            weight: parsedWeight,
            completed: completed !== false
        };

        const updatePath = `exercises.${exerciseIndex}.actualSets`;
        
        await db.collection('workout-sessions').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            {
                $push: { [updatePath]: setData },
                $set: { updatedAt: new Date() }
            }
        );

        res.json({ message: 'Set logged successfully' });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.logSet', error, { includeCode: true });
    }
};

// Delete workout session
const deleteWorkoutSession = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout session ID' });
        }
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('workout-sessions').deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout session not found' });
        }

        res.json({ message: 'Workout session deleted successfully' });
    } catch (error) {
        return safeServerError(res, 'workoutSessionController.deleteWorkoutSession', error, { includeCode: true });
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
