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
  'AI Coach',
  'Profile',
  'General',
];

const ALLOWED_SOURCES = ['web', 'mobile'];
const ALLOWED_STATUSES = ['pending', 'reviewed', 'resolved'];
const MIN_CONTENT_LENGTH = 3;
const MAX_CONTENT_LENGTH = 1000;

const mapFeedback = (item) => ({
  ...item,
  id: item._id.toString(),
  _id: undefined,
  userId: item.userId ? item.userId.toString() : undefined,
  source: item.source || item.platform || 'web',
});

const submitFeedback = async (req, res) => {
  try {
    const userId = req.userId;
    if (!ObjectId.isValid(userId)) {
      return res.status(401).json({ code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized' });
    }

    const { screen, content, source } = req.body || {};

    const trimmedScreen = typeof screen === 'string' ? screen.trim() : '';
    if (!trimmedScreen || !ALLOWED_SCREENS.includes(trimmedScreen)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Invalid screen selection',
      });
    }

    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (trimmedContent.length < MIN_CONTENT_LENGTH || trimmedContent.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `Content must be between ${MIN_CONTENT_LENGTH} and ${MAX_CONTENT_LENGTH} characters`,
      });
    }

    let resolvedSource;
    if (source !== undefined && source !== null && source !== '') {
      const normalizedSource = typeof source === 'string' ? source.trim().toLowerCase() : '';
      if (!ALLOWED_SOURCES.includes(normalizedSource)) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Source must be one of: web, mobile',
        });
      }
      resolvedSource = normalizedSource;
    } else {
      resolvedSource =
        String(req.headers['x-client-type'] || '').trim().toLowerCase() === 'mobile'
          ? 'mobile'
          : 'web';
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
      screen: trimmedScreen,
      content: trimmedContent,
      source: resolvedSource,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('feedbacks').insertOne(feedbackDoc);

    return res.status(201).json({
      message: 'Feedback submitted successfully',
      feedbackId: result.insertedId.toString(),
      source: resolvedSource,
    });
  } catch (error) {
    return safeServerError(res, 'feedbackController.submitFeedback', error, { includeCode: true });
  }
};

const listAdminFeedbacks = async (req, res) => {
  try {
    const db = getDb();
    const { status, screen, source } = req.query || {};

    const filter = {};
    if (status && typeof status === 'string' && ALLOWED_STATUSES.includes(status)) {
      filter.status = status;
    }
    if (screen && typeof screen === 'string' && screen.trim()) {
      filter.screen = screen.trim();
    }
    if (source && typeof source === 'string' && ALLOWED_SOURCES.includes(source.trim().toLowerCase())) {
      const normalizedSource = source.trim().toLowerCase();
      if (normalizedSource === 'web') {
        filter.$or = [{ source: 'web' }, { source: { $exists: false } }];
      } else {
        filter.source = 'mobile';
      }
    }

    const parsedLimit = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 200;
    const parsedSkip = Number.parseInt(req.query?.skip, 10);
    const skip = Number.isFinite(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;

    const feedbacks = await db
      .collection('feedbacks')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return res.json(feedbacks.map(mapFeedback));
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
    if (!status || !ALLOWED_STATUSES.includes(status)) {
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
      feedback: mapFeedback(result),
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
  ALLOWED_SOURCES,
  submitFeedback,
  listAdminFeedbacks,
  updateFeedbackStatus,
  deleteFeedback,
};
