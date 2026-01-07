const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Get strength progression for a specific exercise
const getStrengthProgression = async (req, res) => {
    try {
        const { exerciseName } = req.params;
        const userId = req.userId;
        const db = getDb();

        // Find all completed workout sessions for this user that include the exercise
        const sessions = await db.collection('workout-sessions')
            .find({
                userId: new ObjectId(userId),
                status: 'completed',
                'exercises.exerciseName': exerciseName
            })
            .sort({ date: 1 }) // Sort by date ascending
            .toArray();

        // Extract highest weight for each session
        const progressionData = sessions.map(session => {
            // Find the exercise in this session
            const exercise = session.exercises.find(ex => ex.exerciseName === exerciseName);
            
            if (!exercise) return null;

            // Find max weight from actual sets (if logged) or use target weight
            let maxWeight = exercise.targetWeight || 0;
            
            if (exercise.actualSets && exercise.actualSets.length > 0) {
                const weights = exercise.actualSets.map(set => set.weight);
                maxWeight = Math.max(...weights);
            }

            return {
                date: session.date.toISOString().split('T')[0], // Format as YYYY-MM-DD
                weight: maxWeight,
                sessionId: session._id,
                sessionName: session.name
            };
        }).filter(item => item !== null); // Remove null entries

        res.json(progressionData);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get list of all exercises the user has performed
const getUserExercises = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        // Get all completed sessions
        const sessions = await db.collection('workout-sessions')
            .find({
                userId: new ObjectId(userId),
                status: 'completed'
            })
            .toArray();

        // Extract unique exercise names
        const exerciseSet = new Set();
        sessions.forEach(session => {
            session.exercises.forEach(ex => {
                exerciseSet.add(ex.exerciseName);
            });
        });

        const exercises = Array.from(exerciseSet).sort();

        res.json(exercises);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get overall workout statistics
const getWorkoutStats = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        const sessions = await db.collection('workout-sessions')
            .find({ userId: new ObjectId(userId) })
            .toArray();

        const completed = sessions.filter(s => s.status === 'completed');
        const planned = sessions.filter(s => s.status === 'planned');

        // Calculate total volume (sets × reps × weight)
        let totalVolume = 0;
        completed.forEach(session => {
            session.exercises.forEach(ex => {
                if (ex.actualSets) {
                    ex.actualSets.forEach(set => {
                        totalVolume += (set.reps || 0) * (set.weight || 0);
                    });
                }
            });
        });

        // Get workout frequency by week
        const workoutsByWeek = {};
        completed.forEach(session => {
            const date = new Date(session.date);
            const weekKey = `${date.getFullYear()}-W${Math.ceil((date.getDate()) / 7)}`;
            workoutsByWeek[weekKey] = (workoutsByWeek[weekKey] || 0) + 1;
        });

        res.json({
            totalCompleted: completed.length,
            totalPlanned: planned.length,
            totalVolume: Math.round(totalVolume),
            averageExercisesPerWorkout: completed.length > 0
                ? Math.round(completed.reduce((sum, s) => sum + s.exercises.length, 0) / completed.length)
                : 0,
            workoutFrequency: workoutsByWeek
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get weekly progress tracking
const getWeeklyProgress = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        const schedules = await db.collection('weekly-schedules')
            .find({ userId: new ObjectId(userId) })
            .sort({ startDate: 1 })
            .toArray();

        const progress = schedules.map(schedule => ({
            id: schedule._id,
            weekLabel: `Week ${schedule.weekNumber}`,
            fullLabel: `${schedule.year} W${schedule.weekNumber}`,
            completed: schedule.completedDays,
            total: schedule.totalWorkoutDays,
            rate: schedule.totalWorkoutDays > 0 
                ? Math.round((schedule.completedDays / schedule.totalWorkoutDays) * 100) 
                : 0
        }));

        res.json(progress);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getStrengthProgression,
    getUserExercises,
    getWorkoutStats,
    getWeeklyProgress
};
