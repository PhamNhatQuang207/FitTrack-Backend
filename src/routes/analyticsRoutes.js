const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    getStrengthProgression,
    getUserExercises,
    getWorkoutStats,
    getWeeklyProgress
} = require('../controllers/analyticsController');

// All routes are protected
router.use(authMiddleware);

// Analytics endpoints
router.get('/strength-progression/:exerciseName', getStrengthProgression);
router.get('/user-exercises', getUserExercises);
router.get('/workout-stats', getWorkoutStats);
router.get('/weekly-progress', getWeeklyProgress);

module.exports = router;
