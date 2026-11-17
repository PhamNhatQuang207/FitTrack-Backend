const request = require('supertest');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

jest.mock('../../src/utils/verifyGoogleToken', () => jest.fn());
const verifyGoogleToken = require('../../src/utils/verifyGoogleToken');

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
  jest.clearAllMocks();
});

describe('POST /api/auth/google', () => {
  test('returns 400 when idToken is missing', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });

  test('returns 401 when Google token verification fails', async () => {
    verifyGoogleToken.mockRejectedValue(new Error('Invalid token'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 'bad-token' });
    expect(res.status).toBe(401);
  });

  test('creates a new verified user and returns JWT', async () => {
    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-123',
      email: 'newgoogle@example.com',
      name: 'Google User',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.name).toBe('Google User');
    expect(res.body.email).toBe('newgoogle@example.com');
    const refreshCookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('fittrack_refresh='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');

    const saved = await db.collection('users').findOne({ email: 'newgoogle@example.com' });
    expect(saved.isVerified).toBe(true);
    expect(saved.googleId).toBe('google-sub-123');
    expect(saved.password).toBeUndefined();
  });

  test('matches existing verified user case-insensitively without creating duplicate', async () => {
    await db.collection('users').insertOne({
      email: 'Quang@Example.com',
      name: 'Quang',
      password: 'hashed-password',
      isVerified: true,
    });

    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-777',
      email: 'quang@example.com',
      name: 'Quang Google',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
    expect(res.status).toBe(200);

    const count = await db.collection('users').countDocuments();
    expect(count).toBe(1);
    const user = await db.collection('users').findOne({ email: 'Quang@Example.com' });
    expect(user.googleId).toBe('google-sub-777');
  });

  test('clears unverified password and verificationToken when claiming unverified account via Google', async () => {
    await db.collection('users').insertOne({
      email: 'squatter@example.com',
      name: 'Squatter',
      password: 'hashed-squatter-password',
      isVerified: false,
      verificationToken: 'abc',
      verificationTokenExpiry: new Date(Date.now() + 10000),
    });

    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-999',
      email: 'squatter@example.com',
      name: 'Real Owner',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
    expect(res.status).toBe(200);

    const updated = await db.collection('users').findOne({ email: 'squatter@example.com' });
    expect(updated.isVerified).toBe(true);
    expect(updated.googleId).toBe('google-sub-999');
    expect(updated.password).toBeUndefined();
    expect(updated.verificationToken).toBeUndefined();
  });

  test('password login returns 400 without crashing for Google-only user', async () => {
    await db.collection('users').insertOne({
      email: 'onlygoogle@example.com',
      name: 'Google Only',
      googleId: 'g-1',
      authProvider: 'google',
      isVerified: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'onlygoogle@example.com', password: 'any-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('returns refreshToken in body without Set-Cookie when X-Client-Type: mobile is set', async () => {
    verifyGoogleToken.mockResolvedValue({
      sub: 'google-mobile-1',
      email: 'mobilegoogle@example.com',
      name: 'Mobile Google',
      email_verified: true,
    });

    const res = await request(app)
      .post('/api/auth/google')
      .set('X-Client-Type', 'mobile')
      .send({ idToken: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
