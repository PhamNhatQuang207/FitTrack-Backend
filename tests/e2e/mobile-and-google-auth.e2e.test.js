jest.mock('../../src/utils/sendEmailSmart', () => jest.fn().mockResolvedValue({ id: 'e2e-email' }));
jest.mock('../../src/utils/verifyGoogleToken', () => jest.fn());

const request = require('supertest');
const app = require('../../src/app');
const sendEmailSmart = require('../../src/utils/sendEmailSmart');
const verifyGoogleToken = require('../../src/utils/verifyGoogleToken');
const { REFRESH_COOKIE_NAME, REFRESH_COLLECTION } = require('../../src/utils/refreshToken');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

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

describe('E2E Flow 2: Mobile Token Flow & Google OAuth Account Linking', () => {
  test('mobile register -> verify -> login -> refresh rotation -> cross-client isolation -> logout', async () => {
    // Register and verify email
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mobile Athlete', email: 'mobile.e2e@test.com', password: 'password123' })
      .expect(201);

    const verifyUrlText = sendEmailSmart.mock.calls[0][0].text;
    const rawVerifyToken = verifyUrlText.match(/token=([a-f0-9]+)/)[1];

    await request(app).get(`/api/auth/verify-email/${rawVerifyToken}`).expect(200);

    // Mobile login returns refreshToken in body and sets NO cookies
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Client-Type', 'mobile')
      .send({ email: 'mobile.e2e@test.com', password: 'password123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toEqual(expect.any(String));
    expect(loginRes.body.refreshToken).toEqual(expect.any(String));
    expect(loginRes.headers['set-cookie']).toBeUndefined();

    // Access protected route using mobile access token
    await request(app)
      .get('/api/users/progress')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .expect(200);

    // Web client cannot use mobile body refresh token without X-Client-Type: mobile
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    // Mobile refresh rotation issues new pair without cookies
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.token).toEqual(expect.any(String));
    expect(refreshRes.body.refreshToken).toEqual(expect.any(String));
    expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);
    expect(refreshRes.headers['set-cookie']).toBeUndefined();

    // Replay old mobile refresh token fails
    await request(app)
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    // Mobile logout revokes rotated token
    await request(app)
      .post('/api/auth/logout')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(200);

    expect(await db.collection(REFRESH_COLLECTION).countDocuments()).toBe(0);

    await request(app)
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });

  test('Google OAuth: web signup, mobile signup, unverified squatter reclaim, sub mismatch block, and password-login rejection', async () => {
    // 1. Web Google first-time signup
    verifyGoogleToken.mockResolvedValueOnce({
      sub: 'g-web-1',
      email: 'webgoogle@example.com',
      name: 'Web Google User',
      email_verified: true,
    });

    const webRes = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'web-id-token' });

    expect(webRes.status).toBe(200);
    expect(webRes.body.token).toEqual(expect.any(String));
    expect(webRes.body.refreshToken).toBeUndefined();
    const cookie = (webRes.headers['set-cookie'] || []).find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cookie).toBeDefined();

    // Google-only user can immediately call protected API
    const profileRes = await request(app)
      .get('/api/users/progress')
      .set('Authorization', `Bearer ${webRes.body.token}`);
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.name).toBe('Web Google User');

    // Google-only user cannot log in via password; reset request and duplicate signup send Google guidance without tokens
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'webgoogle@example.com', password: 'anypassword' })
      .expect(400);

    sendEmailSmart.mockClear();
    await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'webgoogle@example.com' })
      .expect(200);
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);
    const googleResetNotice = sendEmailSmart.mock.calls[0][0];
    expect(googleResetNotice.to).toBe('webgoogle@example.com');
    expect(googleResetNotice.html).toMatch(/Google/i);
    expect(googleResetNotice.html).toContain('/login');
    expect(googleResetNotice.html).not.toContain('token=');
    expect(googleResetNotice.text).not.toContain('token=');

    const storedWebGoogle = await db.collection('users').findOne({ email: 'webgoogle@example.com' });
    expect(storedWebGoogle.resetPasswordToken).toBeUndefined();

    sendEmailSmart.mockClear();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Another Name', email: 'webgoogle@example.com', password: 'password123' })
      .expect(201);
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);
    const googleSignupNotice = sendEmailSmart.mock.calls[0][0];
    expect(googleSignupNotice.to).toBe('webgoogle@example.com');
    expect(googleSignupNotice.html).toMatch(/Google/i);
    expect(googleSignupNotice.html).toContain('/login');
    expect(googleSignupNotice.html).not.toContain('token=');
    expect(googleSignupNotice.text).not.toContain('token=');

    const storedWebGoogleAfterReg = await db.collection('users').findOne({ email: 'webgoogle@example.com' });
    expect(storedWebGoogleAfterReg.password).toBeUndefined();
    expect(storedWebGoogleAfterReg.googleId).toBe('g-web-1');

    // 2. Different Google sub cannot hijack an already-linked Google account
    verifyGoogleToken.mockResolvedValueOnce({
      sub: 'g-attacker-sub',
      email: 'webgoogle@example.com',
      name: 'Attacker',
      email_verified: true,
    });
    const mismatchRes = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'attacker-token' });
    expect(mismatchRes.status).toBe(403);
    expect(mismatchRes.body.code).toBe('AUTH_PROVIDER_MISMATCH');

    // 3. Reclaiming an unverified squatted email overwrites squatter name and clears password/token
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Squatter Name', email: 'claimed@example.com', password: 'squatterpass' })
      .expect(201);

    verifyGoogleToken.mockResolvedValueOnce({
      sub: 'g-real-owner',
      email: 'Claimed@Example.com',
      name: 'Real Google Owner',
      email_verified: true,
    });

    const reclaimRes = await request(app)
      .post('/api/auth/google')
      .set('X-Client-Type', 'mobile')
      .send({ idToken: 'owner-token' });

    expect(reclaimRes.status).toBe(200);
    expect(reclaimRes.body.name).toBe('Real Google Owner');
    expect(reclaimRes.body.refreshToken).toEqual(expect.any(String));
    expect(reclaimRes.headers['set-cookie']).toBeUndefined();

    const storedClaimed = await db.collection('users').findOne({ email: 'claimed@example.com' });
    expect(storedClaimed.isVerified).toBe(true);
    expect(storedClaimed.name).toBe('Real Google Owner');
    expect(storedClaimed.password).toBeUndefined();
    expect(storedClaimed.verificationToken).toBeUndefined();
  });
});
