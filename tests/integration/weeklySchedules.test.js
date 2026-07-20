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

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Insert a plan document (shape matches weeklyPlanController output): day 0 is a
// workout day, days 1-6 are rest days.
const insertPlan = async (userId) => {
  const days = dayNames.map((dayName, i) => ({
    dayOfWeek: i,
    dayName,
    isRestDay: i !== 0,
    workout: i === 0 ? { name: 'Leg Day', exercises: [] } : null,
  }));
  const { insertedId } = await db.collection('weekly-plans').insertOne({
    userId,
    name: 'Test Plan',
    days,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return insertedId;
};

const startSchedule = async (token, planId, body = {}) =>
  request(app)
    .post('/api/weekly-schedules/start')
    .set(authHeader(token))
    .send({ weeklyPlanId: planId.toString(), ...body });

describe('POST /api/weekly-schedules/start', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/weekly-schedules/start').send({});
    expect(res.status).toBe(401);
  });

  test('starts a schedule from a plan', async () => {
    const { token, userId } = await createUserAndToken(db);
    const planId = await insertPlan(userId);

    const res = await startSchedule(token, planId);
    expect(res.status).toBe(201);

    const stored = await db.collection('weekly-schedules').findOne({ userId });
    expect(stored.status).toBe('active');
    expect(stored.days).toHaveLength(7);
    expect(stored.totalWorkoutDays).toBe(1);
  });

  test('returns 404 when the plan does not exist', async () => {
    const { token } = await createUserAndToken(db);
    const res = await startSchedule(token, new ObjectId());
    expect(res.status).toBe(404);
  });

  test('rejects a second active schedule for the same week', async () => {
    const { token, userId } = await createUserAndToken(db);
    const planId = await insertPlan(userId);

    const first = await startSchedule(token, planId);
    expect(first.status).toBe(201);

    const second = await startSchedule(token, planId);
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already have an active schedule/i);
  });
});

describe('GET /api/weekly-schedules', () => {
  test('lists the user\'s schedules and gets the current week', async () => {
    const { token, userId } = await createUserAndToken(db);
    const planId = await insertPlan(userId);
    await startSchedule(token, planId); // defaults to the current week

    const list = await request(app).get('/api/weekly-schedules').set(authHeader(token));
    expect(list.body).toHaveLength(1);

    const current = await request(app)
      .get('/api/weekly-schedules/current')
      .set(authHeader(token));
    expect(current.status).toBe(200);
    expect(current.body.status).toBe('active');
  });

  test('AUTHORIZATION: another user cannot fetch the schedule by id (404)', async () => {
    const owner = await createUserAndToken(db);
    const attacker = await createUserAndToken(db);
    const planId = await insertPlan(owner.userId);
    const started = await startSchedule(owner.token, planId);
    const scheduleId = started.body.scheduleId;

    const res = await request(app)
      .get(`/api/weekly-schedules/${scheduleId}`)
      .set(authHeader(attacker.token));
    expect(res.status).toBe(404);
  });
});

describe('schedule progress + editing', () => {
  const setup = async () => {
    const { token, userId } = await createUserAndToken(db);
    const planId = await insertPlan(userId);
    const started = await startSchedule(token, planId);
    return { token, scheduleId: started.body.scheduleId };
  };

  test('complete-day marks a day complete and increments completedDays once', async () => {
    const { token, scheduleId } = await setup();

    const first = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(token))
      .send({ dayOfWeek: 0, workoutData: { exercises: [] } });
    expect(first.status).toBe(200);
    expect(first.body.completedDays).toBe(1);

    // Completing the same day again should not double-count.
    const again = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(token))
      .send({ dayOfWeek: 0, workoutData: { exercises: [] } });
    expect(again.body.completedDays).toBe(1);
  });

  test('complete marks the whole week completed', async () => {
    const { token, scheduleId } = await setup();
    const res = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const stored = await db.collection('weekly-schedules').findOne({ _id: new ObjectId(scheduleId) });
    expect(stored.status).toBe('completed');
  });

  test('update-day: toggleRest turns a workout day into a rest day', async () => {
    const { token, scheduleId } = await setup();
    const res = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'toggleRest', dayOfWeek: 0 });
    expect(res.status).toBe(200);

    const stored = await db.collection('weekly-schedules').findOne({ _id: new ObjectId(scheduleId) });
    expect(stored.days[0].isRestDay).toBe(true);
    expect(stored.days[0].workout).toBeNull();
    expect(stored.totalWorkoutDays).toBe(0);
  });

  test('update-day: assignWorkout requires workout data', async () => {
    const { token, scheduleId } = await setup();
    const res = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'assignWorkout', dayOfWeek: 1 });
    expect(res.status).toBe(400);
  });

  test('update-day: rejects an unknown action', async () => {
    const { token, scheduleId } = await setup();
    const res = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'nonsense', dayOfWeek: 0 });
    expect(res.status).toBe(400);
  });

  test('update-day: rejects an invalid schedule id format', async () => {
    const { token } = await setup();
    const res = await request(app)
      .patch('/api/weekly-schedules/not-a-valid-id/update-day')
      .set(authHeader(token))
      .send({ action: 'toggleRest', dayOfWeek: 0 });
    expect(res.status).toBe(400);
  });
});
