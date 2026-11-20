const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { feedbackLimiter } = require('../middleware/rateLimiter');
const { submitFeedback } = require('../controllers/feedbackController');

/**
 * @swagger
 * /api/feedbacks:
 *   post:
 *     summary: Submit user feedback for developers
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - screen
 *               - content
 *             properties:
 *               screen:
 *                 type: string
 *                 example: Dashboard
 *               content:
 *                 type: string
 *                 example: Giao diện rất mượt nhưng cần thêm nút lọc theo ngày.
 *               source:
 *                 type: string
 *                 enum: [web, mobile]
 *                 description: Optional client source; defaults automatically from X-Client-Type header ('mobile' when X-Client-Type is mobile, otherwise 'web').
 *                 example: web
 *     responses:
 *       201:
 *         description: Feedback submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many feedback requests
 */
router.post('/', feedbackLimiter, protect, submitFeedback);

module.exports = router;
