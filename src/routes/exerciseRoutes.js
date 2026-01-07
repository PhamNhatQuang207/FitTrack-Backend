const express = require('express');
const router = express.Router();
const {
    getAllExercises,
    getExercisesByCategory,
    searchExercises,
    getExerciseById
} = require('../controllers/exerciseController');

// Public routes - no authentication required for viewing exercises
router.get('/', getAllExercises);
router.get('/search', searchExercises);
router.get('/category/:category', getExercisesByCategory);
router.get('/:id', getExerciseById);

module.exports = router;
