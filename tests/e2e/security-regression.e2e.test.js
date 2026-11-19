const request = require('supertest');
const jwt = require('jsonwebtoken');
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

const adminAuth = () => ({
  Authorization: `Bearer ${jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  })}`,
});

describe('E2E Flow 8: Cross-User Isolation (IDOR) & Security Regression Matrix', () => {
  test('IDOR matrix: User B cannot read, mutate, or delete any of User A resources', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const exId = new ObjectId().toString();

    const planInsert = await db.collection('weekly-plans').insertOne({
      userId: owner.userId,
      name: 'Owner Private Plan',
      days: Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: i,
        dayName: 'Monday',
        isRestDay: i !== 0,
        workout: i === 0 ? { name: 'Upper', exercises: [] } : null,
      })),
    });
    const planId = planInsert.insertedId.toString();

    const scheduleInsert = await db.collection('weekly-schedules').insertOne({
      userId: owner.userId,
      weeklyPlanId: planInsert.insertedId,
      weeklyPlanName: 'Owner Private Plan',
      status: 'active',
      completedDays: 0,
      totalWorkoutDays: 1,
      days: Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: i,
        dayName: 'Monday',
        isRestDay: i !== 0,
        workout: i === 0 ? { name: 'Upper', exercises: [], isCompleted: false } : null,
      })),
    });
    const scheduleId = scheduleInsert.insertedId.toString();

    const sessionInsert = await db.collection('workout-sessions').insertOne({
      userId: owner.userId,
      name: 'Owner Private Session',
      status: 'planned',
      date: new Date(),
      exercises: [{ exerciseId: new ObjectId(exId), exerciseName: 'Bench', category: 'Chest', actualSets: [] }],
    });
    const sessionId = sessionInsert.insertedId.toString();

    const convInsert = await db.collection('ai-conversations').insertOne({
      userId: owner.userId,
      title: 'Owner Private AI Chat',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          text: 'Draft',
          draftPlan: {
            mode: 'create_schedule',
            plan: {
              name: 'Secret Plan',
              days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, isRestDay: true, workout: null })),
            },
            appliedAt: null,
          },
        },
      ],
    });
    const convId = convInsert.insertedId.toString();

    const memInsert = await db.collection('ai-memories').insertOne({
      userId: owner.userId,
      category: 'injury',
      key: 'knee',
      value: 'ACL recovery',
    });
    const memId = memInsert.insertedId.toString();

    // Workout Sessions IDOR
    await request(app).get(`/api/workout-sessions/${sessionId}`).set(authHeader(attacker.token)).expect(404);
    await request(app).put(`/api/workout-sessions/${sessionId}`).set(authHeader(attacker.token)).send({ name: 'Hacked' }).expect(404);
    await request(app).patch(`/api/workout-sessions/${sessionId}/start`).set(authHeader(attacker.token)).expect(404);
    await request(app).patch(`/api/workout-sessions/${sessionId}/complete`).set(authHeader(attacker.token)).expect(404);
    await request(app)
      .post(`/api/workout-sessions/${sessionId}/log-set`)
      .set(authHeader(attacker.token))
      .send({ exerciseId: exId, setNumber: 1, reps: 10, weight: 50 })
      .expect(404);
    await request(app).delete(`/api/workout-sessions/${sessionId}`).set(authHeader(attacker.token)).expect(404);

    // Weekly Plans IDOR
    await request(app).get(`/api/weekly-plans/${planId}`).set(authHeader(attacker.token)).expect(404);
    await request(app).put(`/api/weekly-plans/${planId}`).set(authHeader(attacker.token)).send({ name: 'Hacked' }).expect(404);
    await request(app).delete(`/api/weekly-plans/${planId}`).set(authHeader(attacker.token)).expect(404);

    // Weekly Schedules IDOR
    await request(app).get(`/api/weekly-schedules/${scheduleId}`).set(authHeader(attacker.token)).expect(404);
    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(attacker.token))
      .send({ dayOfWeek: 0 })
      .expect(404);
    await request(app).patch(`/api/weekly-schedules/${scheduleId}/complete`).set(authHeader(attacker.token)).expect(404);
    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(attacker.token))
      .send({ action: 'toggleRest', dayOfWeek: 0 })
      .expect(404);

    // AI Conversations & Memories IDOR
    await request(app).get(`/api/ai/conversations/${convId}`).set(authHeader(attacker.token)).expect(404);
    await request(app).delete(`/api/ai/conversations/${convId}`).set(authHeader(attacker.token)).expect(404);
    await request(app)
      .post(`/api/ai/conversations/${convId}/messages/msg-1/apply-plan`)
      .set(authHeader(attacker.token))
      .expect(404);
    await request(app).delete(`/api/ai/memories/${memId}`).set(authHeader(attacker.token)).expect(404);
  });

  test('blocks mass assignment, NoSQL operator injection, targetSets DoS, invalid ObjectIds, malformed JSON, and unsafe URLs', async () => {
    const { token, userId } = await createUserAndToken(db);
    const exId = new ObjectId().toString();

    // 1. Mass assignment blocked on PUT /api/workout-sessions/:id and PUT /api/weekly-plans/:id
    const sessCreate = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({
        name: 'Session',
        exercises: [{ exerciseId: exId, exerciseName: 'Press', category: 'Chest', sets: [{ setNumber: 1, targetReps: 10, targetWeight: 40 }] }],
      })
      .expect(201);

    await request(app)
      .put(`/api/workout-sessions/${sessCreate.body.sessionId}`)
      .set(authHeader(token))
      .send({ name: 'Clean Name', isAdmin: true, arbitraryRootField: 'injected', userId: new ObjectId().toString() })
      .expect(200);

    const storedSess = await db.collection('workout-sessions').findOne({ _id: new ObjectId(sessCreate.body.sessionId) });
    expect(storedSess.name).toBe('Clean Name');
    expect(storedSess.userId).toEqual(userId);
    expect(storedSess.isAdmin).toBeUndefined();
    expect(storedSess.arbitraryRootField).toBeUndefined();

    // Invalid field types rejected with 400
    await request(app)
      .put(`/api/workout-sessions/${sessCreate.body.sessionId}`)
      .set(authHeader(token))
      .send({ status: 'hacked-status' })
      .expect(400);

    const planCreate = await request(app)
      .post('/api/weekly-plans')
      .set(authHeader(token))
      .send({
        name: 'Plan',
        days: Array.from({ length: 7 }, () => ({ isRestDay: true, workout: null })),
      })
      .expect(201);

    await request(app)
      .put(`/api/weekly-plans/${planCreate.body.planId}`)
      .set(authHeader(token))
      .send({ name: 'Safe Plan', isAdmin: true, userId: new ObjectId().toString() })
      .expect(200);

    const storedPlan = await db.collection('weekly-plans').findOne({ _id: new ObjectId(planCreate.body.planId) });
    expect(storedPlan.userId).toEqual(userId);
    expect(storedPlan.isAdmin).toBeUndefined();

    // 2. NoSQL operator injection blocked everywhere
    await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 'x' }).expect(400);
    await request(app).post('/api/auth/request-password-reset').send({ email: { $gt: '' } }).expect(400);
    await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({
        name: 'Inject',
        weeklyScheduleId: { $ne: null },
        dayOfWeek: 0,
        exercises: [{ exerciseId: exId, exerciseName: 'Press', category: 'Chest', targetSets: 3, targetReps: 10, targetWeight: 40 }],
      })
      .expect(400);
    await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({
        name: 'Inject',
        weeklyScheduleId: new ObjectId().toString(),
        dayOfWeek: { $gte: 0 },
        exercises: [{ exerciseId: exId, exerciseName: 'Press', category: 'Chest', targetSets: 3, targetReps: 10, targetWeight: 40 }],
      })
      .expect(400);
    await request(app).get('/api/workout-sessions?status=planned&status=completed').set(authHeader(token)).expect(400);
    await request(app).get('/api/weekly-schedules?status=active&status=completed').set(authHeader(token)).expect(400);

    // 3. DoS guard on targetSets
    await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({
        name: 'DoS Session',
        exercises: [{ exerciseId: exId, exerciseName: 'Press', category: 'Chest', targetSets: 10000000, targetReps: 10, targetWeight: 40 }],
      })
      .expect(400);

    // Legacy oversized doc in DB is safely clamped to 50 sets
    const legacyDoc = await db.collection('workout-sessions').insertOne({
      userId,
      name: 'Legacy Huge Doc',
      status: 'planned',
      date: new Date(),
      exercises: [{ exerciseId: new ObjectId(exId), exerciseName: 'Press', category: 'Chest', targetSets: 10000000, targetReps: 10, targetWeight: 40 }],
    });
    const clampedRes = await request(app)
      .get(`/api/workout-sessions/${legacyDoc.insertedId}`)
      .set(authHeader(token))
      .expect(200);
    expect(clampedRes.body.exercises[0].sets).toHaveLength(50);

    // 4. Invalid ObjectId params return 400 (never 500)
    await request(app).get('/api/exercises/not-an-object-id').expect(400);
    await request(app).get('/api/workout-sessions/not-an-object-id').set(authHeader(token)).expect(400);
    await request(app).get('/api/weekly-plans/not-an-object-id').set(authHeader(token)).expect(400);
    await request(app).get('/api/weekly-schedules/not-an-object-id').set(authHeader(token)).expect(400);

    // 5. Malformed JSON returns 400 JSON without stack trace
    const malformedRes = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "broken');
    expect(malformedRes.status).toBe(400);
    expect(malformedRes.body.code).toBe('INVALID_JSON');

    // 6. Unsafe URL schemes rejected on admin endpoints
    await request(app)
      .post('/api/admin/exercises')
      .set(adminAuth())
      .send({ name: 'XSS Ex', category: 'Chest', imageUrl: 'javascript:alert(1)' })
      .expect(400);

    await request(app)
      .post('/api/admin/muscle-groups')
      .set(adminAuth())
      .send({ name: 'XSS Group', iconUrl: 'data:text/html,<script>alert(1)</script>' })
      .expect(400);

    await request(app)
      .put('/api/admin/site-config')
      .set(adminAuth())
      .send({ heroBackgroundUrl: 'javascript:alert(document.cookie)' })
      .expect(400);
  });

  // Kept last so the burst does not exhaust mcpLimiter for earlier tests in this file
  test('/mcp applies rate limiting before authentication and DB lookup', async () => {
    const burstIp = '198.51.100.77';
    for (let i = 0; i < 120; i += 1) {
      const res = await request(app)
        .post('/mcp')
        .set('X-Forwarded-For', burstIp)
        .send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
      expect(res.status).toBe(401);
    }

    const limited = await request(app)
      .post('/mcp')
      .set('X-Forwarded-For', burstIp)
      .send({ jsonrpc: '2.0', id: 121, method: 'tools/list' });
    expect(limited.status).toBe(429);
  });
});
