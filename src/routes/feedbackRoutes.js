const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
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
 *     responses:
 *       201:
 *         description: Feedback submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', protect, submitFeedback);

module.exports = router;
