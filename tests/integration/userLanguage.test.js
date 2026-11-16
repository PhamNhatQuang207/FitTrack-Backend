const request = require('supertest');
const express = require('express');

jest.mock('../../src/config/db', () => ({ getDb: jest.fn() }));
jest.mock('../../src/middleware/authMiddleware', () => (req, _res, next) => {
  req.userId = '507f1f77bcf86cd799439011';
  next();
});

const { getDb } = require('../../src/config/db');
const userRoutes = require('../../src/routes/userRoutes');

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

describe('PATCH /api/users/language', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects unsupported language with 400 and error code', async () => {
    const res = await request(app).patch('/api/users/language').send({ preferredLanguage: 'jp' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_INVALID_LANGUAGE');
  });

  test('updates preferredLanguage to vi', async () => {
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    getDb.mockReturnValue({ collection: () => ({ updateOne }) });

    const res = await request(app).patch('/api/users/language').send({ preferredLanguage: 'vi' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferredLanguage: 'vi' });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
