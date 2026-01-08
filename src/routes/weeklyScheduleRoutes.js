const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    startWeeklySchedule,
    getWeeklySchedules,
    getCurrentWeek,
    getWeeklyScheduleById,
    completeDayWorkout,
    completeWeek,
    updateScheduleDay
} = require('../controllers/weeklyScheduleController');

// All routes are protected
router.use(authMiddleware);

router.post('/start', startWeeklySchedule);
router.get('/', getWeeklySchedules);
router.get('/current', getCurrentWeek);
router.get('/:id', getWeeklyScheduleById);
router.patch('/:id/complete-day', completeDayWorkout);
router.patch('/:id/complete', completeWeek);
router.patch('/:id/update-day', updateScheduleDay);

module.exports = router;
