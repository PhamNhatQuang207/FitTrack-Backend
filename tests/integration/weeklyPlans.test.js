const request = require('supertest');
const { ObjectId } = require('mongodb');
const app = require('../../src/app');
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

// Build 7 days; index 0 is a workout day, the rest are rest days.
const sevenDays = () =>
  Array.from({ length: 7 }, (_, i) => ({
    isRestDay: i !== 0,
    workout: i === 0 ? { name: 'Full Body', exercises: [] } : null,
  }));

const planPayload = (overrides = {}) => ({
  name: 'My Split',
  description: 'A test plan',
  days: sevenDays(),
  ...overrides,
});

const createPlan = async (token, overrides = {}) => {
  const res = await request(app)
    .post('/api/weekly-plans')
    .set(authHeader(token))
    .send(planPayload(overrides));
  return res.body.planId;
};

describe('POST /api/weekly-plans', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/weekly-plans').send(planPayload());
    expect(res.status).toBe(401);
  });

  test('creates a plan with 7 normalised days', async () => {
    const { token, userId } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/weekly-plans')
      .set(authHeader(token))
      .send(planPayload());

    expect(res.status).toBe(201);
    const stored = await db.collection('weekly-plans').findOne({ userId });
    expect(stored.days).toHaveLength(7);
    expect(stored.days[0].dayName).toBe('Monday');
    expect(stored.days[0].isRestDay).toBe(false);
    expect(stored.days[1].workout).toBeNull();
  });

  test('rejects a plan that does not have exactly 7 days', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/weekly-plans')
      .set(authHeader(token))
      .send(planPayload({ days: sevenDays().slice(0, 5) }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/weekly-plans', () => {
  test('lists only the user\'s plans', async () => {
    const userA = await createUserAndToken(db);
    const userB = await createUserAndToken(db);
    await createPlan(userA.token);
    await createPlan(userB.token);

    const res = await request(app).get('/api/weekly-plans').set(authHeader(userA.token));
    expect(res.body).toHaveLength(1);
  });
});

describe('GET/PUT/DELETE /api/weekly-plans/:id', () => {
  test('fetches a plan by id for its owner', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createPlan(token);
    const res = await request(app).get(`/api/weekly-plans/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('My Split');
  });

  test('AUTHORIZATION: another user cannot fetch the plan (404)', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const id = await createPlan(owner.token);
    const res = await request(app).get(`/api/weekly-plans/${id}`).set(authHeader(attacker.token));
    expect(res.status).toBe(404);
  });

  test('updates a plan', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createPlan(token);
    const res = await request(app)
      .put(`/api/weekly-plans/${id}`)
      .set(authHeader(token))
      .send({ name: 'Renamed Split' });
    expect(res.status).toBe(200);
    const stored = await db.collection('weekly-plans').findOne({ _id: new ObjectId(id) });
    expect(stored.name).toBe('Renamed Split');
  });

  test('deletes a plan (and blocks other users)', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const id = await createPlan(owner.token);

    const forbidden = await request(app)
      .delete(`/api/weekly-plans/${id}`)
      .set(authHeader(attacker.token));
    expect(forbidden.status).toBe(404);

    const ok = await request(app)
      .delete(`/api/weekly-plans/${id}`)
      .set(authHeader(owner.token));
    expect(ok.status).toBe(200);
    expect(await db.collection('weekly-plans').countDocuments()).toBe(0);
  });
});
