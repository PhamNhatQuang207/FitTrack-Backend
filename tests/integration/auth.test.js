// Mock the email sender so registration / reset flows never attempt real delivery.
jest.mock('../../src/utils/sendEmailSmart', () => jest.fn().mockResolvedValue({ id: 'test-email' }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const sendEmailSmart = require('../../src/utils/sendEmailSmart');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { getDb } = require('../../src/config/db');

let db;

beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => {
  await stopTestDb();
});
beforeEach(async () => {
  await clearDb();
});

const seedUser = async (overrides = {}) => {
  const doc = {
    email: 'jane@test.com',
    name: 'Jane',
    password: await bcrypt.hash('password123', 10),
    isVerified: true,
    ...overrides,
  };
  const { insertedId } = await db.collection('users').insertOne(doc);
  return insertedId;
};

describe('POST /api/auth/register', () => {
  test('registers a new user (unverified, hashed password) and sends a verification email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Jane', email: 'jane@test.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('userId'); // would leak a real user id

    const user = await db.collection('users').findOne({ email: 'jane@test.com' });
    expect(user).toBeTruthy();
    expect(user.isVerified).toBe(false);
    expect(user.password).not.toBe('password123'); // stored hashed
    expect(user.verificationToken).toEqual(expect.any(String));
    expect(user.verificationTokenExpiry).toBeInstanceOf(Date);
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);
  });

  test('SECURITY: a taken email is indistinguishable from a fresh signup', async () => {
    const fresh = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New', email: 'new@test.com', password: 'password123' });

    await seedUser({ email: 'dupe@test.com' });
    const dupe = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dupe', email: 'dupe@test.com', password: 'password123' });

    expect(dupe.status).toBe(fresh.status);
    expect(dupe.body).toEqual(fresh.body);
  });

  test('SECURITY: registering over a verified account does not touch it', async () => {
    await seedUser({ email: 'owner@test.com', name: 'Owner' });
    sendEmailSmart.mockClear();

    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Attacker', email: 'owner@test.com', password: 'hunter22222' });

    const user = await db.collection('users').findOne({ email: 'owner@test.com' });
    expect(user.name).toBe('Owner');
    expect(await bcrypt.compare('password123', user.password)).toBe(true);
    expect(sendEmailSmart).not.toHaveBeenCalled();
  });

  test('re-registering an unverified account issues a fresh token and email', async () => {
    await seedUser({
      email: 'pending@test.com',
      isVerified: false,
      verificationToken: 'stale-token',
    });
    sendEmailSmart.mockClear();

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Pending', email: 'pending@test.com', password: 'newpassword' });

    expect(res.status).toBe(201);
    const user = await db.collection('users').findOne({ email: 'pending@test.com' });
    expect(user.verificationToken).not.toBe('stale-token');
    expect(user.verificationTokenExpiry).toBeInstanceOf(Date);
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);
  });

  test('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'x@test.com', password: 'password123' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  test('rejects a password shorter than 6 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: '123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('logs in a verified user and returns a token', async () => {
    await seedUser({ email: 'ok@test.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ok@test.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.name).toBe('Jane');
  });

  test('blocks login for an unverified account', async () => {
    await seedUser({ email: 'unverified@test.com', isVerified: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified@test.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/verify your email/i);
  });

  test('rejects a wrong password with generic message', async () => {
    await seedUser({ email: 'ok@test.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ok@test.com', password: 'wrongpass' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('rejects a non-existent user with generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('SECURITY: blocks NoSQL operator injection in the email field', async () => {
    await seedUser({ email: 'victim@test.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $gt: '' }, password: 'password123' });

    expect(res.status).toBe(400); // validation rejects the object before it reaches the DB
    expect(res.body.token).toBeUndefined();
  });

  test('SECURITY: blocks a non-string password (operator injection)', async () => {
    await seedUser({ email: 'victim@test.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'victim@test.com', password: { $gt: '' } });

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });
});

describe('GET /api/auth/verify-email/:token', () => {
  const hoursFromNow = (h) => new Date(Date.now() + h * 60 * 60 * 1000);

  test('verifies a user with a valid, unexpired token', async () => {
    await seedUser({
      email: 'v@test.com',
      isVerified: false,
      verificationToken: 'tok-verify',
      verificationTokenExpiry: hoursFromNow(1),
    });
    const res = await request(app).get('/api/auth/verify-email/tok-verify');

    expect(res.status).toBe(200);
    const user = await db.collection('users').findOne({ email: 'v@test.com' });
    expect(user.isVerified).toBe(true);
    expect(user.verificationToken).toBeUndefined();
    expect(user.verificationTokenExpiry).toBeUndefined();
  });

  test('SECURITY: rejects a token past its 24-hour expiry', async () => {
    await seedUser({
      email: 'old@test.com',
      isVerified: false,
      verificationToken: 'tok-expired',
      verificationTokenExpiry: hoursFromNow(-1),
    });
    const res = await request(app).get('/api/auth/verify-email/tok-expired');

    expect(res.status).toBe(400);
    const user = await db.collection('users').findOne({ email: 'old@test.com' });
    expect(user.isVerified).toBe(false);
  });

  test('SECURITY: rejects a legacy token that carries no expiry at all', async () => {
    await seedUser({ email: 'legacy@test.com', isVerified: false, verificationToken: 'tok-legacy' });
    const res = await request(app).get('/api/auth/verify-email/tok-legacy');

    expect(res.status).toBe(400);
    const user = await db.collection('users').findOne({ email: 'legacy@test.com' });
    expect(user.isVerified).toBe(false);
  });

  test('rejects an invalid token', async () => {
    const res = await request(app).get('/api/auth/verify-email/nope');
    expect(res.status).toBe(400);
  });

  test('is idempotent for an already-verified user', async () => {
    await seedUser({ email: 'a@test.com', isVerified: true, verificationToken: 'still-here' });
    const res = await request(app).get('/api/auth/verify-email/still-here');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already verified/i);
  });
});

describe('POST /api/auth/request-password-reset (SECURITY FIX #3)', () => {
  test('stores a reset token for an existing user and returns a generic message', async () => {
    await seedUser({ email: 'reset@test.com' });
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'reset@test.com' });

    expect(res.status).toBe(200);
    const user = await db.collection('users').findOne({ email: 'reset@test.com' });
    expect(user.resetPasswordToken).toEqual(expect.any(String));
    expect(user.resetPasswordExpiry).toBeInstanceOf(Date);
  });

  test('does not reveal whether an account exists (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'ghost@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
  });

  test('SECURITY: blocks NoSQL operator injection in the email field', async () => {
    await seedUser({ email: 'victim@test.com' });
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: { $gt: '' } });

    expect(res.status).toBe(400); // now validated — previously flowed straight into findOne()
  });

  test('rejects a missing email', async () => {
    const res = await request(app).post('/api/auth/request-password-reset').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password/:token (SECURITY FIX #3)', () => {
  const futureExpiry = () => new Date(Date.now() + 3600 * 1000);

  test('resets the password with a valid, unexpired token', async () => {
    await seedUser({
      email: 'r@test.com',
      resetPasswordToken: 'valid-reset',
      resetPasswordExpiry: futureExpiry(),
    });

    const res = await request(app)
      .post('/api/auth/reset-password/valid-reset')
      .send({ password: 'brandNewPass1' });

    expect(res.status).toBe(200);
    const user = await db.collection('users').findOne({ email: 'r@test.com' });
    expect(await bcrypt.compare('brandNewPass1', user.password)).toBe(true);
    expect(user.resetPasswordToken).toBeUndefined();
    expect(user.resetPasswordExpiry).toBeUndefined();
  });

  test('rejects an expired token', async () => {
    await seedUser({
      email: 'r@test.com',
      resetPasswordToken: 'expired-reset',
      resetPasswordExpiry: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/auth/reset-password/expired-reset')
      .send({ password: 'brandNewPass1' });

    expect(res.status).toBe(400);
  });

  test('rejects an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/does-not-exist')
      .send({ password: 'brandNewPass1' });
    expect(res.status).toBe(400);
  });

  test('SECURITY: enforces the 6-character minimum on the new password', async () => {
    await seedUser({
      email: 'r@test.com',
      resetPasswordToken: 'valid-reset',
      resetPasswordExpiry: futureExpiry(),
    });

    const res = await request(app)
      .post('/api/auth/reset-password/valid-reset')
      .send({ password: '123' });

    expect(res.status).toBe(400); // previously unvalidated — a 1-char reset was possible
  });
});
