const request = require('supertest');
const app = require('../../src/app');
const { REFRESH_COOKIE_NAME } = require('../../src/utils/refreshToken');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

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

describe('E2E Flow 3: Profile, Body Progress Tracking & Bilingual i18n', () => {
  test('user updates profile & logs weight/bodyFat history, validates bad inputs, and switches language across sessions', async () => {
    const { token, userId, email, plainPassword } = await createUserAndToken(db, {
      name: 'Starter Athlete',
      preferredLanguage: 'en',
    });

    // 1. Initial progress fetch
    const initialRes = await request(app)
      .get('/api/users/progress')
      .set(authHeader(token));
    expect(initialRes.status).toBe(200);
    expect(initialRes.body.name).toBe('Starter Athlete');
    expect(initialRes.body.password).toBeUndefined();
    expect(initialRes.body._id).toBeUndefined();

    // 2. Update profile metrics + log first weight/bodyFat entries
    await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ name: 'Pro Athlete', height: 176, age: 26, sex: 'Male', weight: 74.5, bodyFat: 16.2 })
      .expect(200);

    // Log a second weight/bodyFat entry later
    await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ weight: 73.8, bodyFat: 15.6 })
      .expect(200);

    const updatedRes = await request(app)
      .get('/api/users/progress')
      .set(authHeader(token));
    expect(updatedRes.status).toBe(200);
    expect(updatedRes.body).toMatchObject({
      name: 'Pro Athlete',
      height: 176,
      age: 26,
      sex: 'Male',
    });
    expect(updatedRes.body.weightHistory).toHaveLength(2);
    expect(updatedRes.body.weightHistory[0].value).toBe(74.5);
    expect(updatedRes.body.weightHistory[1].value).toBe(73.8);
    expect(updatedRes.body.bodyFatHistory).toHaveLength(2);
    expect(updatedRes.body.bodyFatHistory[1].value).toBe(15.6);

    // 3. Reject invalid profile/body metrics
    const badInputs = [
      { weight: -10 },
      { weight: 0 },
      { weight: 'not-a-number' },
      { bodyFat: 95 },
      { age: 10 },
      { height: 90 },
      { sex: 'Invalid' },
      { name: '   ' },
      {},
    ];
    for (const payload of badInputs) {
      const badRes = await request(app)
        .post('/api/users/progress')
        .set(authHeader(token))
        .send(payload);
      expect(badRes.status).toBe(400);
    }

    // 4. Language preference lifecycle (reject unsupported, switch en -> vi -> en, verify across login/refresh)
    const invalidLang = await request(app)
      .patch('/api/users/language')
      .set(authHeader(token))
      .send({ preferredLanguage: 'fr' });
    expect(invalidLang.status).toBe(400);
    expect(invalidLang.body.code).toBe('USER_INVALID_LANGUAGE');

    const switchVi = await request(app)
      .patch('/api/users/language')
      .set(authHeader(token))
      .send({ preferredLanguage: 'vi' });
    expect(switchVi.status).toBe(200);
    expect(switchVi.body).toEqual({ preferredLanguage: 'vi' });

    // Login reflects persisted VI preference
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: plainPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.preferredLanguage).toBe('vi');

    const cookiePair = (loginRes.headers['set-cookie'] || [])
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))
      .split(';')[0];

    // Switch back to EN then verify /refresh returns updated preference
    await request(app)
      .patch('/api/users/language')
      .set(authHeader(loginRes.body.token))
      .send({ preferredLanguage: 'en' })
      .expect(200);

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [cookiePair]);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.preferredLanguage).toBe('en');

    const storedUser = await db.collection('users').findOne({ _id: userId });
    expect(storedUser.preferredLanguage).toBe('en');
  });

  test('bilingual catalog supports English and Vietnamese search queries and exposes translations.vi', async () => {
    await db.collection('exercises').insertMany([
      {
        name: 'Barbell Bench Press',
        category: 'Chest',
        translations: { vi: { name: 'Đẩy ngực ngang với thanh đòn' } },
        isActive: true,
      },
      {
        name: 'Lat Pulldown',
        category: 'Lats',
        translations: { vi: { name: 'Kéo xô máy' } },
        isActive: true,
      },
    ]);

    const viSearch = await request(app)
      .get('/api/exercises/search')
      .query({ q: 'Đẩy ngực' });
    expect(viSearch.status).toBe(200);
    expect(viSearch.body).toHaveLength(1);
    expect(viSearch.body[0].name).toBe('Barbell Bench Press');

    const enSearch = await request(app)
      .get('/api/exercises/search')
      .query({ q: 'pulldown' });
    expect(enSearch.status).toBe(200);
    expect(enSearch.body).toHaveLength(1);
    expect(enSearch.body[0].translations.vi.name).toBe('Kéo xô máy');

    const mgRes = await request(app).get('/api/muscle-groups');
    expect(mgRes.status).toBe(200);
    const chest = mgRes.body.find((g) => g.name === 'Chest');
    expect(chest.translations.vi.name).toBe('Ngực');
  });
});
