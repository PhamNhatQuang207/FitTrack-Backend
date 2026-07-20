const request = require('supertest');
const { ObjectId } = require('mongodb');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

let db;
const exerciseId = new ObjectId().toString();

beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => {
  await stopTestDb();
});
beforeEach(async () => {
  await clearDb();
});

const sessionPayload = (overrides = {}) => ({
  name: 'Push Day',
  exercises: [
    {
      exerciseId,
      exerciseName: 'Bench Press',
      category: 'Chest',
      sets: [{ setNumber: 1, targetReps: 10, targetWeight: 60 }],
    },
  ],
  ...overrides,
});

const createSession = async (token, overrides = {}) => {
  const res = await request(app)
    .post('/api/workout-sessions')
    .set(authHeader(token))
    .send(sessionPayload(overrides));
  return res.body.sessionId;
};

describe('POST /api/workout-sessions', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/workout-sessions').send(sessionPayload());
    expect(res.status).toBe(401);
  });

  test('creates a planned session', async () => {
    const { token, userId } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send(sessionPayload());

    expect(res.status).toBe(201);
    const stored = await db.collection('workout-sessions').findOne({ userId });
    expect(stored.status).toBe('planned');
    expect(stored.name).toBe('Push Day');
  });

  test('rejects a missing name or exercises', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({ name: 'No exercises' });
    expect(res.status).toBe(400);
  });

  test('resumes an existing active session for the same schedule/day instead of duplicating', async () => {
    const { token } = await createUserAndToken(db);
    const scheduleId = new ObjectId().toString();

    const first = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send(sessionPayload({ weeklyScheduleId: scheduleId, dayOfWeek: 1 }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send(sessionPayload({ weeklyScheduleId: scheduleId, dayOfWeek: 1 }));

    expect(second.status).toBe(200);
    expect(second.body.message).toMatch(/resuming/i);
    expect(second.body.sessionId).toBe(first.body.sessionId);

    const count = await db.collection('workout-sessions').countDocuments();
    expect(count).toBe(1);
  });
});

describe('GET /api/workout-sessions', () => {
  test('lists the user\'s sessions and can filter by status', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createSession(token);
    await createSession(token);
    await request(app).patch(`/api/workout-sessions/${id}/complete`).set(authHeader(token));

    const all = await request(app).get('/api/workout-sessions').set(authHeader(token));
    expect(all.body).toHaveLength(2);

    const completed = await request(app)
      .get('/api/workout-sessions')
      .query({ status: 'completed' })
      .set(authHeader(token));
    expect(completed.body).toHaveLength(1);
  });
});

describe('GET /api/workout-sessions/:id', () => {
  test('returns the session for its owner', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createSession(token);
    const res = await request(app).get(`/api/workout-sessions/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Push Day');
    expect(res.body.userId).toBeUndefined();
  });

  test('AUTHORIZATION: another user cannot read the session (404)', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const id = await createSession(owner.token);

    const res = await request(app)
      .get(`/api/workout-sessions/${id}`)
      .set(authHeader(attacker.token));
    expect(res.status).toBe(404);
  });
});

describe('workout-session lifecycle', () => {
  test('start -> in-progress, complete -> completed with completedAt', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createSession(token);

    const started = await request(app)
      .patch(`/api/workout-sessions/${id}/start`)
      .set(authHeader(token));
    expect(started.status).toBe(200);

    const completed = await request(app)
      .patch(`/api/workout-sessions/${id}/complete`)
      .set(authHeader(token));
    expect(completed.status).toBe(200);

    const stored = await db.collection('workout-sessions').findOne({ _id: new ObjectId(id) });
    expect(stored.status).toBe('completed');
    expect(stored.completedAt).toBeInstanceOf(Date);
  });

  test('PUT updates a session but ignores protected fields', async () => {
    const { token, userId } = await createUserAndToken(db);
    const id = await createSession(token);

    const res = await request(app)
      .put(`/api/workout-sessions/${id}`)
      .set(authHeader(token))
      .send({ name: 'Renamed', userId: new ObjectId().toString() });
    expect(res.status).toBe(200);

    const stored = await db.collection('workout-sessions').findOne({ _id: new ObjectId(id) });
    expect(stored.name).toBe('Renamed');
    expect(stored.userId).toEqual(userId); // userId was stripped from the update
  });

  test('log-set appends an actual set to the exercise', async () => {
    const { token } = await createUserAndToken(db);
    const id = await createSession(token);

    const res = await request(app)
      .post(`/api/workout-sessions/${id}/log-set`)
      .set(authHeader(token))
      .send({ exerciseId, setNumber: 1, reps: 10, weight: 62.5, completed: true });
    expect(res.status).toBe(200);

    const stored = await db.collection('workout-sessions').findOne({ _id: new ObjectId(id) });
    expect(stored.exercises[0].actualSets).toHaveLength(1);
    expect(stored.exercises[0].actualSets[0].weight).toBe(62.5);
  });

  test('DELETE removes a session (and blocks other users)', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const id = await createSession(owner.token);

    const forbidden = await request(app)
      .delete(`/api/workout-sessions/${id}`)
      .set(authHeader(attacker.token));
    expect(forbidden.status).toBe(404);

    const ok = await request(app)
      .delete(`/api/workout-sessions/${id}`)
      .set(authHeader(owner.token));
    expect(ok.status).toBe(200);
    expect(await db.collection('workout-sessions').countDocuments()).toBe(0);
  });
});
