const express = require('express');
const { check } = require('express-validator');
const adminMiddleware = require('../middleware/adminMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const { adminLogin } = require('../controllers/adminAuthController');
const {
  listAdminMuscleGroups,
  createMuscleGroup,
  updateMuscleGroup,
  mergeMuscleGroup,
} = require('../controllers/muscleGroupController');
const {
  listExercises,
  createExercise,
  updateExercise,
  toggleExerciseStatus,
} = require('../controllers/adminExerciseController');
const { updateSiteConfig } = require('../controllers/siteConfigController');
const {
  listAdminFeedbacks,
  updateFeedbackStatus,
  deleteFeedback,
} = require('../controllers/feedbackController');

const router = express.Router();

// Public admin login endpoint
router.post(
  '/login',
  authLimiter,
  [
    check('username', 'Username is required').isString().notEmpty(),
    check('password', 'Password is required').isString().notEmpty(),
  ],
  validate,
  adminLogin
);

// Protected admin endpoints below
router.use(adminMiddleware);

router.get('/muscle-groups', listAdminMuscleGroups);
router.post(
  '/muscle-groups',
  [check('name', 'Name is required').isString().trim().notEmpty()],
  validate,
  createMuscleGroup
);
router.put(
  '/muscle-groups/:id',
  [check('name').optional().isString().trim().notEmpty()],
  validate,
  updateMuscleGroup
);
router.post(
  '/muscle-groups/:id/merge',
  [check('targetId', 'targetId is required').isString().notEmpty()],
  validate,
  mergeMuscleGroup
);

router.get('/exercises', listExercises);
router.post(
  '/exercises',
  [
    check('name', 'Name is required').isString().trim().notEmpty(),
    check('category', 'Category is required').isString().trim().notEmpty(),
  ],
  validate,
  createExercise
);
router.put(
  '/exercises/:id',
  [
    check('name').optional().isString().trim().notEmpty(),
    check('category').optional().isString().trim().notEmpty(),
  ],
  validate,
  updateExercise
);
router.patch(
  '/exercises/:id/status',
  [check('isActive', 'isActive boolean is required').isBoolean()],
  validate,
  toggleExerciseStatus
);

router.put(
  '/site-config',
  [
    check('heroBackgroundUrl').optional().isString(),
    check('announcementBanner').optional().isString(),
    check('featuredNote').optional().isString(),
  ],
  validate,
  updateSiteConfig
);

// Feedback management
router.get('/feedbacks', listAdminFeedbacks);
router.patch(
  '/feedbacks/:id/status',
  [check('status', 'status is required').isString().isIn(['pending', 'reviewed', 'resolved'])],
  validate,
  updateFeedbackStatus
);
router.delete('/feedbacks/:id', deleteFeedback);

module.exports = router;
