const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    createWeeklyPlan,
    getWeeklyPlans,
    getWeeklyPlanById,
    updateWeeklyPlan,
    deleteWeeklyPlan
} = require('../controllers/weeklyPlanController');

// All routes are protected
router.use(authMiddleware);

router.post('/', createWeeklyPlan);
router.get('/', getWeeklyPlans);
router.get('/:id', getWeeklyPlanById);
router.put('/:id', updateWeeklyPlan);
router.delete('/:id', deleteWeeklyPlan);

module.exports = router;
