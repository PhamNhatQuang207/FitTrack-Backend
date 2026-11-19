jest.mock('../../src/utils/sendEmailSmart', () => jest.fn().mockResolvedValue({ id: 'e2e-email' }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const sendEmailSmart = require('../../src/utils/sendEmailSmart');
const {
  REFRESH_COOKIE_NAME,
  REFRESH_COLLECTION,
  hashToken,
} = require('../../src/utils/refreshToken');
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
  sendEmailSmart.mockClear();
});

const extractRefreshCookiePair = (res) => {
  const cookies = res.headers['set-cookie'] || [];
  const raw = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  return raw ? raw.split(';')[0] : null;
};

const extractTokenFromLastEmail = () => {
  const lastCall = sendEmailSmart.mock.calls[sendEmailSmart.mock.calls.length - 1];
  const emailPayload = lastCall?.[0];
  const match = emailPayload?.text?.match(/token=([a-f0-9]+)/);
  return { token: match ? match[1] : null, emailPayload };
};

describe('E2E Flow 1: Complete Web Authentication & Account Lifecycle', () => {
  test('register (VI) -> email verification -> login -> refresh rotation -> CSRF check -> password reset -> logout', async () => {
    // 1. Register with Accept-Language: vi and mixed-case email
    const regRes = await request(app)
      .post('/api/auth/register')
      .set('Accept-Language', 'vi')
      .send({
        name: 'Quang <script>xss</script>',
        email: 'Quang.E2E@Example.COM',
        password: 'StrongPassword1!',
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.userId).toBeUndefined();
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);

    const { token: rawVerifyToken, emailPayload: verifyEmailContent } = extractTokenFromLastEmail();
    expect(rawVerifyToken).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyEmailContent.to).toBe('quang.e2e@example.com');
    expect(verifyEmailContent.subject).toMatch(/Xác thực/i);
    expect(verifyEmailContent.html).toContain('&lt;script&gt;xss&lt;/script&gt;');
    expect(verifyEmailContent.html).not.toContain('<script>xss</script>');

    // Verify DB stores SHA-256 hash of verification token, not plaintext
    const unverifiedUser = await db.collection('users').findOne({ email: 'quang.e2e@example.com' });
    expect(unverifiedUser).toBeTruthy();
    expect(unverifiedUser.isVerified).toBe(false);
    expect(unverifiedUser.preferredLanguage).toBe('vi');
    expect(unverifiedUser.verificationToken).toBe(hashToken(rawVerifyToken));
    expect(unverifiedUser.verificationToken).not.toBe(rawVerifyToken);

    // 2. Pre-verification login checks:
    // Wrong password returns generic 400 (no unverified-email oracle)
    const wrongPassPreVerify = await request(app)
      .post('/api/auth/login')
      .send({ email: 'quang.e2e@example.com', password: 'WrongPassword!' });
    expect(wrongPassPreVerify.status).toBe(400);
    expect(wrongPassPreVerify.body.code).toBe('AUTH_INVALID_CREDENTIALS');

    // Right password returns 401 AUTH_EMAIL_NOT_VERIFIED
    const rightPassPreVerify = await request(app)
      .post('/api/auth/login')
      .send({ email: 'quang.e2e@example.com', password: 'StrongPassword1!' });
    expect(rightPassPreVerify.status).toBe(401);
    expect(rightPassPreVerify.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');

    // 3. Verify email via extracted raw token -> 200; re-using token -> 400
    const verifyRes = await request(app).get(`/api/auth/verify-email/${rawVerifyToken}`);
    expect(verifyRes.status).toBe(200);

    const reuseVerifyRes = await request(app).get(`/api/auth/verify-email/${rawVerifyToken}`);
    expect(reuseVerifyRes.status).toBe(400);

    // 4. Duplicate registration over verified account (exact & different case) is indistinguishable and harmless
    sendEmailSmart.mockClear();
    const dupeRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Attacker Name',
        email: 'QUANG.E2E@EXAMPLE.COM',
        password: 'AttackerPassword1!',
      });
    expect(dupeRes.status).toBe(201);
    expect(dupeRes.body).toEqual(regRes.body);
    expect(sendEmailSmart).not.toHaveBeenCalled();

    const verifiedUser = await db.collection('users').findOne({ email: 'quang.e2e@example.com' });
    expect(await bcrypt.compare('StrongPassword1!', verifiedUser.password)).toBe(true);

    // 5. Login with verified credentials -> 15m JWT + HttpOnly cookie + preferredLanguage: 'vi'
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'QUANG.E2E@example.com', password: 'StrongPassword1!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toEqual(expect.any(String));
    expect(loginRes.body.refreshToken).toBeUndefined();
    expect(loginRes.body.preferredLanguage).toBe('vi');

    const decoded = jwt.verify(loginRes.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(decoded.exp - decoded.iat).toBe(15 * 60);

    const firstCookie = extractRefreshCookiePair(loginRes);
    expect(firstCookie).toBeTruthy();

    // 6. Access protected route with access JWT
    const progressRes = await request(app)
      .get('/api/users/progress')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(progressRes.status).toBe(200);
    expect(progressRes.body.name).toBe('Quang <script>xss</script>');

    // 7. CSRF origin protection on cookie endpoints
    const csrfBlockedRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', [firstCookie]);
    expect(csrfBlockedRefresh.status).toBe(403);
    expect(csrfBlockedRefresh.body.code).toBe('AUTH_CSRF_FORBIDDEN');

    const csrfBlockedLogout = await request(app)
      .post('/api/auth/logout')
      .set('Referer', 'https://evil.example/attack.html')
      .set('Cookie', [firstCookie]);
    expect(csrfBlockedLogout.status).toBe(403);
    expect(csrfBlockedLogout.body.code).toBe('AUTH_CSRF_FORBIDDEN');

    // Allowed origin succeeds and rotates refresh cookie
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'https://fittrack.io.vn')
      .set('Cookie', [firstCookie]);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.token).toEqual(expect.any(String));
    expect(refreshRes.body.preferredLanguage).toBe('vi');

    const rotatedCookie = extractRefreshCookiePair(refreshRes);
    expect(rotatedCookie).toBeTruthy();
    expect(rotatedCookie).not.toBe(firstCookie);

    // Replaying the consumed first cookie fails
    const replayRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [firstCookie]);
    expect(replayRes.status).toBe(401);

    // 8. Password reset flow -> revokes active refresh sessions & switches password
    sendEmailSmart.mockClear();
    const forgotRes = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'Quang.E2E@example.com' });
    expect(forgotRes.status).toBe(200);
    expect(sendEmailSmart).toHaveBeenCalledTimes(1);

    const { token: rawResetToken, emailPayload: resetEmailContent } = extractTokenFromLastEmail();
    expect(rawResetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(resetEmailContent.subject).toMatch(/Đặt lại mật khẩu/i);

    const userWithReset = await db.collection('users').findOne({ email: 'quang.e2e@example.com' });
    expect(userWithReset.resetPasswordToken).toBe(hashToken(rawResetToken));
    expect(userWithReset.resetPasswordToken).not.toBe(rawResetToken);

    const resetRes = await request(app)
      .post(`/api/auth/reset-password/${rawResetToken}`)
      .send({ password: 'NewStrongPassword2!' });
    expect(resetRes.status).toBe(200);

    // Active refresh cookie was revoked on password reset
    const postResetRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [rotatedCookie]);
    expect(postResetRefresh.status).toBe(401);

    // Old password rejected, new password succeeds
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'quang.e2e@example.com', password: 'StrongPassword1!' })
      .expect(400);

    const newLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'quang.e2e@example.com', password: 'NewStrongPassword2!' })
      .expect(200);

    const thirdCookie = extractRefreshCookiePair(newLoginRes);
    expect(await db.collection(REFRESH_COLLECTION).countDocuments()).toBe(1);

    // 9. Logout revokes refresh token & clears cookie
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://fittrack.io.vn')
      .set('Cookie', [thirdCookie]);
    expect(logoutRes.status).toBe(200);
    expect(await db.collection(REFRESH_COLLECTION).countDocuments()).toBe(0);

    const postLogoutRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [thirdCookie]);
    expect(postLogoutRefresh.status).toBe(401);
  });
});
