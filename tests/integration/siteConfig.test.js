const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

let db;
const adminAuth = () => ({
  Authorization: `Bearer ${jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET)}`,
});

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('Site Config API', () => {
  test('GET /api/site-config returns defaults when no config is stored', async () => {
    const res = await request(app).get('/api/site-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      heroBackgroundUrl: '',
      announcementBanner: '',
      featuredNote: '',
      updatedAt: null,
    });
  });

  test('PUT /api/admin/site-config rejects normal user token and allows admin token', async () => {
    const { token: userToken } = await createUserAndToken(db);
    const forbidden = await request(app)
      .put('/api/admin/site-config')
      .set(authHeader(userToken))
      .send({ heroBackgroundUrl: 'https://example.com/bg.jpg' });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .put('/api/admin/site-config')
      .set(adminAuth())
      .send({
        heroBackgroundUrl: 'https://example.com/bg.jpg',
        announcementBanner: 'New workout library live!',
        featuredNote: 'Stay consistent',
      });
    expect(ok.status).toBe(200);
    expect(ok.body.heroBackgroundUrl).toBe('https://example.com/bg.jpg');
  });
});
