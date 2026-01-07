const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

const logWorkout = async (req, res) => {
    try {
        const userId = req.userId;
        const { date, exercises } = req.body;
        const db = getDb();

        // Validate required fields
        if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
            return res.status(400).json({ message: 'Exercises array is required' });
        }

        // Validate exercise structure
        for (const exercise of exercises) {
            if (!exercise.exerciseName || !exercise.category || !exercise.sets || !Array.isArray(exercise.sets)) {
                return res.status(400).json({ 
                    message: 'Each exercise must have exerciseName, category, and sets array' 
                });
            }

            // Validate sets structure
            for (const set of exercise.sets) {
                if (set.setNumber === undefined || set.reps === undefined || set.weight === undefined) {
                    return res.status(400).json({ 
                        message: 'Each set must have setNumber, reps, and weight' 
                    });
                }
            }
        }

        // Create workout document
        const workout = {
            userId: new ObjectId(userId),
            date: date ? new Date(date) : new Date(),
            exercises: exercises.map(exercise => ({
                exerciseName: exercise.exerciseName,
                category: exercise.category,
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
        res.status(500).json({ message: error.message });
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
        res.status(500).json({ message: error.message });
    }
};

module.exports = { logWorkout, getWorkouts };
