const request = require('supertest');
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

describe('GET /api/users/progress', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/users/progress');
    expect(res.status).toBe(401);
  });

  test('returns the profile fields for the authenticated user', async () => {
    const { token } = await createUserAndToken(db, {
      name: 'Progress User',
      height: 180,
      age: 30,
      sex: 'Male',
      weightHistory: [{ value: 80, date: new Date() }],
    });

    const res = await request(app).get('/api/users/progress').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Progress User');
    expect(res.body.height).toBe(180);
    expect(res.body.weightHistory).toHaveLength(1);
    expect(res.body).not.toHaveProperty('password'); // projection excludes it
  });
});

describe('POST /api/users/progress', () => {
  test('appends a weight entry to weightHistory', async () => {
    const { token, userId } = await createUserAndToken(db);

    const res = await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ weight: 75.5 });

    expect(res.status).toBe(200);
    const user = await db.collection('users').findOne({ _id: userId });
    expect(user.weightHistory).toHaveLength(1);
    expect(user.weightHistory[0].value).toBe(75.5);
    expect(user.weightHistory[0].date).toBeInstanceOf(Date);
  });

  test('updates profile fields (name, height, age, sex)', async () => {
    const { token, userId } = await createUserAndToken(db);

    const res = await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ name: 'New Name', height: 175, age: 28, sex: 'Female' });

    expect(res.status).toBe(200);
    const user = await db.collection('users').findOne({ _id: userId });
    expect(user.name).toBe('New Name');
    expect(user.height).toBe(175);
    expect(user.age).toBe(28);
    expect(user.sex).toBe('Female');
  });

  test('rejects an age outside 13-100', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ age: 5 });
    expect(res.status).toBe(400);
  });

  test('rejects a height outside 100-250', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ height: 300 });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid sex value', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/users/progress')
      .set(authHeader(token))
      .send({ sex: 'Unknown' });
    expect(res.status).toBe(400);
  });

  test('rejects an empty payload (no progress data)', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app).post('/api/users/progress').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });
});
