const express = require('express');
const router = express.Router();
const { logWorkout, getWorkouts } = require('../controllers/workoutController');
const protect = require('../middleware/authMiddleware');

// GET /api/workouts - Protected route to get all user workouts
router.get('/', protect, getWorkouts);

// POST /api/workouts - Protected route to log a new workout
router.post('/', protect, logWorkout);

module.exports = router;

