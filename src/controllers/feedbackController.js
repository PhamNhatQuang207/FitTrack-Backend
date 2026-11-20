const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');
const { safeServerError } = require('../utils/security');

const ALLOWED_SCREENS = [
  'Dashboard',
  'Weekly Planning',
  'Weekly Plan Library',
  'Weekly Calendar',
  'Workout Planning',
  'Active Workout',
  'Workout History',
  'Progress Tracking',
  'Profile',
  'General',
];

const submitFeedback = async (req, res) => {
  try {
    const userId = req.userId;
    if (!ObjectId.isValid(userId)) {
      return res.status(401).json({ code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized' });
    }

    const { screen, content } = req.body || {};

    if (!screen || typeof screen !== 'string' || screen.trim().length === 0 || screen.trim().length > 100) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Screen must be a valid string between 1 and 100 characters',
      });
    }

    if (!content || typeof content !== 'string' || content.trim().length < 3 || content.trim().length > 2000) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Content must be between 3 and 2000 characters',
      });
    }

    const db = getDb();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, email: 1 } }
    );

    const feedbackDoc = {
      userId: new ObjectId(userId),
      userName: user?.name || 'Anonymous Athlete',
      userEmail: user?.email || '',
      screen: screen.trim(),
      content: content.trim(),
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('feedbacks').insertOne(feedbackDoc);

    return res.status(201).json({
      message: 'Feedback submitted successfully',
      feedbackId: result.insertedId.toString(),
    });
  } catch (error) {
    return safeServerError(res, 'feedbackController.submitFeedback', error, { includeCode: true });
  }
};

const listAdminFeedbacks = async (req, res) => {
  try {
    const db = getDb();
    const { status, screen } = req.query || {};

    const filter = {};
    if (status && typeof status === 'string' && ['pending', 'reviewed', 'resolved'].includes(status)) {
      filter.status = status;
    }
    if (screen && typeof screen === 'string' && screen.trim()) {
      filter.screen = screen.trim();
    }

    const feedbacks = await db
      .collection('feedbacks')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    const mapped = feedbacks.map((item) => ({
      ...item,
      id: item._id.toString(),
      userId: item.userId ? item.userId.toString() : undefined,
    }));

    return res.json(mapped);
  } catch (error) {
    return safeServerError(res, 'feedbackController.listAdminFeedbacks', error, { includeCode: true });
  }
};

const updateFeedbackStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ code: 'INVALID_ID', message: 'Invalid feedback ID' });
    }

    const { status } = req.body || {};
    if (!status || !['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Status must be one of: pending, reviewed, resolved',
      });
    }

    const db = getDb();
    const result = await db.collection('feedbacks').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Feedback not found' });
    }

    return res.json({
      message: 'Status updated successfully',
      feedback: {
        ...result,
        id: result._id.toString(),
        userId: result.userId ? result.userId.toString() : undefined,
      },
    });
  } catch (error) {
    return safeServerError(res, 'feedbackController.updateFeedbackStatus', error, { includeCode: true });
  }
};

const deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ code: 'INVALID_ID', message: 'Invalid feedback ID' });
    }

    const db = getDb();
    const result = await db.collection('feedbacks').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Feedback not found' });
    }

    return res.json({ message: 'Feedback deleted successfully' });
  } catch (error) {
    return safeServerError(res, 'feedbackController.deleteFeedback', error, { includeCode: true });
  }
};

module.exports = {
  ALLOWED_SCREENS,
  submitFeedback,
  listAdminFeedbacks,
  updateFeedbackStatus,
  deleteFeedback,
};
