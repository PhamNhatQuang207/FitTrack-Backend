const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    createWorkoutSession,
    getWorkoutSessions,
    getWorkoutSessionById,
    updateWorkoutSession,
    startWorkoutSession,
    completeWorkoutSession,
    logSet,
    deleteWorkoutSession
} = require('../controllers/workoutSessionController');

// All routes are protected
router.use(authMiddleware);

// Workout session CRUD
router.post('/', createWorkoutSession);
router.get('/', getWorkoutSessions);
router.get('/:id', getWorkoutSessionById);
router.put('/:id', updateWorkoutSession);
router.delete('/:id', deleteWorkoutSession);

// Status management
router.patch('/:id/start', startWorkoutSession);
router.patch('/:id/complete', completeWorkoutSession);

// Log sets
router.post('/:id/log-set', logSet);

module.exports = router;
