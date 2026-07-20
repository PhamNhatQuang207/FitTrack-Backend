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

const validWorkout = () => ({
  date: '2026-01-15',
  exercises: [
    {
      exerciseName: 'Bench Press',
      category: 'Chest',
      sets: [
        { setNumber: 1, reps: 10, weight: 60 },
        { setNumber: 2, reps: 8, weight: 65 },
      ],
    },
  ],
});

describe('POST /api/workouts', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/workouts').send(validWorkout());
    expect(res.status).toBe(401);
  });

  test('logs a workout and coerces set numbers to Number', async () => {
    const { token, userId } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workouts')
      .set(authHeader(token))
      .send(validWorkout());

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('workoutId');

    const stored = await db.collection('workouts').findOne({ userId });
    expect(stored.exercises[0].sets[0].weight).toBe(60);
  });

  test('rejects an empty exercises array', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workouts')
      .set(authHeader(token))
      .send({ exercises: [] });
    expect(res.status).toBe(400);
  });

  test('rejects an exercise missing required fields', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workouts')
      .set(authHeader(token))
      .send({ exercises: [{ exerciseName: 'X' }] });
    expect(res.status).toBe(400);
  });

  test('rejects a set missing reps/weight', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workouts')
      .set(authHeader(token))
      .send({
        exercises: [
          { exerciseName: 'X', category: 'Chest', sets: [{ setNumber: 1 }] },
        ],
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/workouts', () => {
  test('returns only the authenticated user\'s workouts (no cross-user leakage)', async () => {
    const userA = await createUserAndToken(db);
    const userB = await createUserAndToken(db);

    await request(app).post('/api/workouts').set(authHeader(userA.token)).send(validWorkout());
    await request(app).post('/api/workouts').set(authHeader(userB.token)).send(validWorkout());
    await request(app).post('/api/workouts').set(authHeader(userB.token)).send(validWorkout());

    const resA = await request(app).get('/api/workouts').set(authHeader(userA.token));
    const resB = await request(app).get('/api/workouts').set(authHeader(userB.token));

    expect(resA.body).toHaveLength(1);
    expect(resB.body).toHaveLength(2);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/workouts');
    expect(res.status).toBe(401);
  });
});
