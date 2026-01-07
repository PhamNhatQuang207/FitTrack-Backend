const express = require('express');
const router = express.Router();
const { updateProgress } = require('../controllers/progressController');
const { getProgress } = require('../controllers/userController');
const protect = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/users/progress:
 *   get:
 *     summary: Get user progress history
 *     tags: [User Progress]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User progress data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: John Doe
 *                 height:
 *                   type: number
 *                   example: 175
 *                   description: Height in cm
 *                 age:
 *                   type: number
 *                   example: 25
 *                 sex:
 *                   type: string
 *                   enum: [male, female, other]
 *                   example: male
 *                 weightHistory:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       weight:
 *                         type: number
 *                         example: 75.5
 *                       date:
 *                         type: string
 *                         format: date-time
 *                         example: 2024-01-07T12:00:00Z
 *                 bodyFatHistory:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       bodyFat:
 *                         type: number
 *                         example: 15.5
 *                       date:
 *                         type: string
 *                         format: date-time
 *                         example: 2024-01-07T12:00:00Z
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Not authorized, token failed
 */
router.get('/progress', protect, getProgress);

/**
 * @swagger
 * /api/users/progress:
 *   post:
 *     summary: Update user progress (weight, body fat, profile)
 *     tags: [User Progress]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               weight:
 *                 type: number
 *                 example: 75.5
 *                 description: Weight in kg
 *               bodyFat:
 *                 type: number
 *                 example: 15.5
 *                 description: Body fat percentage
 *               height:
 *                 type: number
 *                 example: 175
 *                 description: Height in cm
 *               age:
 *                 type: number
 *                 example: 25
 *                 description: Age in years
 *               sex:
 *                 type: string
 *                 enum: [male, female, other]
 *                 example: male
 *                 description: Biological sex
 *           examples:
 *             updateWeight:
 *               summary: Update weight only
 *               value:
 *                 weight: 75.5
 *             updateBodyFat:
 *               summary: Update body fat only
 *               value:
 *                 bodyFat: 15.5
 *             updateProfile:
 *               summary: Update profile information
 *               value:
 *                 height: 175
 *                 age: 25
 *                 sex: male
 *             updateAll:
 *               summary: Update all fields
 *               value:
 *                 weight: 75.5
 *                 bodyFat: 15.5
 *                 height: 175
 *                 age: 25
 *                 sex: male
 *     responses:
 *       200:
 *         description: Progress updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Progress updated successfully
 *       400:
 *         description: Bad request - Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Invalid input data
 *       401:
 *         description: Unauthorized - Invalid or missing Bearer token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Not authorized, token failed
 */
router.post('/progress', protect, updateProgress);

module.exports = router;
