const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { safeServerError } = require('../utils/security');

const MAX_EXERCISES = 50;
const MAX_SETS = 50;

const isNonNegativeFiniteNumber = (val) =>
    (typeof val === 'number' || (typeof val === 'string' && val.trim() !== '')) &&
    Number.isFinite(Number(val)) &&
    Number(val) >= 0;

const logWorkout = async (req, res) => {
    try {
        const userId = req.userId;
        const { date, exercises } = req.body || {};
        const db = getDb();

        let parsedDate = new Date();
        if (date !== undefined) {
            parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid workout date' });
            }
        }

        // Validate required fields
        if (!exercises || !Array.isArray(exercises) || exercises.length === 0 || exercises.length > MAX_EXERCISES) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Exercises array is required (1..50 items)' });
        }

        // Validate exercise structure
        for (const exercise of exercises) {
            if (
                !exercise ||
                typeof exercise.exerciseName !== 'string' ||
                !exercise.exerciseName.trim() ||
                typeof exercise.category !== 'string' ||
                !exercise.category.trim() ||
                !Array.isArray(exercise.sets) ||
                exercise.sets.length === 0 ||
                exercise.sets.length > MAX_SETS
            ) {
                return res.status(400).json({ 
                    code: 'VALIDATION_ERROR',
                    message: 'Each exercise must have exerciseName, category, and sets array (1..50 items)' 
                });
            }

            // Validate sets structure
            for (const set of exercise.sets) {
                if (
                    !set ||
                    !isNonNegativeFiniteNumber(set.setNumber) ||
                    !isNonNegativeFiniteNumber(set.reps) ||
                    !isNonNegativeFiniteNumber(set.weight)
                ) {
                    return res.status(400).json({ 
                        code: 'VALIDATION_ERROR',
                        message: 'Each set must have valid non-negative numeric setNumber, reps, and weight' 
                    });
                }
            }
        }

        // Create workout document
        const workout = {
            userId: new ObjectId(userId),
            date: parsedDate,
            exercises: exercises.map(exercise => ({
                exerciseName: exercise.exerciseName.trim(),
                category: exercise.category.trim(),
                sets: exercise.sets.map(set => ({
                    setNumber: Number(set.setNumber),
                    reps: Number(set.reps),
                    weight: Number(set.weight)
                }))
            })),
            createdAt: new Date()
        };

        // Insert workout into workouts collection
        const result = await db.collection('workouts').insertOne(workout);

        res.status(201).json({ 
            message: 'Workout logged successfully', 
            workoutId: result.insertedId 
        });
    } catch (error) {
        return safeServerError(res, 'workoutController.logWorkout', error, { includeCode: true });
    }
};

const getWorkouts = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        // Find all workouts for the user and sort by date descending (newest first)
        const workouts = await db.collection('workouts')
            .find({ userId: new ObjectId(userId) })
            .sort({ date: -1 })
            .toArray();

        res.json(workouts);
    } catch (error) {
        return safeServerError(res, 'workoutController.getWorkouts', error, { includeCode: true });
    }
};

module.exports = { logWorkout, getWorkouts };
