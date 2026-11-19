const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { safeServerError } = require('../utils/security');

// Get strength progression for a specific exercise
const getStrengthProgression = async (req, res) => {
    try {
        const { exerciseName } = req.params;
        if (typeof exerciseName !== 'string' || !exerciseName.trim() || exerciseName.length > 200) {
            return res.status(400).json({ message: 'Invalid exercise name' });
        }
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
            if (!Array.isArray(session.exercises)) return null;
            const parsedDate = session.date ? new Date(session.date) : null;
            if (!parsedDate || isNaN(parsedDate.getTime())) return null;

            // Find the exercise in this session
            const exercise = session.exercises.find(ex => ex.exerciseName === exerciseName);
            
            if (!exercise) return null;

            // Find max weight from actual sets (if logged) or use target weight
            let maxWeight = exercise.targetWeight || 0;
            
            if (exercise.actualSets && exercise.actualSets.length > 0) {
                const weights = exercise.actualSets.map(set => Number(set.weight) || 0);
                maxWeight = Math.max(...weights);
            }

            return {
                date: parsedDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
                weight: maxWeight,
                sessionId: session._id,
                sessionName: session.name
            };
        }).filter(item => item !== null); // Remove null entries

        res.json(progressionData);
    } catch (error) {
        return safeServerError(res, 'analyticsController.getStrengthProgression', error);
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
            if (!Array.isArray(session.exercises)) return;
            session.exercises.forEach(ex => {
                if (ex?.exerciseName) exerciseSet.add(ex.exerciseName);
            });
        });

        const exercises = Array.from(exerciseSet).sort();

        res.json(exercises);
    } catch (error) {
        return safeServerError(res, 'analyticsController.getUserExercises', error);
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
            if (!Array.isArray(session.exercises)) return;
            session.exercises.forEach(ex => {
                if (Array.isArray(ex.actualSets)) {
                    ex.actualSets.forEach(set => {
                        totalVolume += (Number(set.reps) || 0) * (Number(set.weight) || 0);
                    });
                }
            });
        });

        // Get workout frequency by week
        const workoutsByWeek = {};
        completed.forEach(session => {
            const date = new Date(session.date);
            if (isNaN(date.getTime())) return;
            const weekKey = `${date.getFullYear()}-W${Math.ceil((date.getDate()) / 7)}`;
            workoutsByWeek[weekKey] = (workoutsByWeek[weekKey] || 0) + 1;
        });

        res.json({
            totalCompleted: completed.length,
            totalPlanned: planned.length,
            totalVolume: Math.round(totalVolume),
            averageExercisesPerWorkout: completed.length > 0
                ? Math.round(completed.reduce((sum, s) => sum + (Array.isArray(s.exercises) ? s.exercises.length : 0), 0) / completed.length)
                : 0,
            workoutFrequency: workoutsByWeek
        });
    } catch (error) {
        return safeServerError(res, 'analyticsController.getWorkoutStats', error);
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
        return safeServerError(res, 'analyticsController.getWeeklyProgress', error);
    }
};

module.exports = {
    getStrengthProgression,
    getUserExercises,
    getWorkoutStats,
    getWeeklyProgress
};
