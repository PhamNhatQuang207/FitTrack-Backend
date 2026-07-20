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

const insertCompletedSession = async (userId, { name, date, exercises }) =>
  db.collection('workout-sessions').insertOne({
    userId,
    name,
    date,
    status: 'completed',
    exercises,
  });

// Seed two completed Bench Press sessions (increasing weight) + one planned session.
const seedSessions = async (userId) => {
  await insertCompletedSession(userId, {
    name: 'Week 1',
    date: new Date('2026-01-01'),
    exercises: [
      { exerciseName: 'Bench Press', actualSets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 65 }] },
      { exerciseName: 'Squat', actualSets: [{ reps: 5, weight: 100 }] },
    ],
  });
  await insertCompletedSession(userId, {
    name: 'Week 2',
    date: new Date('2026-01-08'),
    exercises: [
      { exerciseName: 'Bench Press', actualSets: [{ reps: 8, weight: 70 }] },
    ],
  });
  await db.collection('workout-sessions').insertOne({
    userId,
    name: 'Planned',
    date: new Date('2026-01-15'),
    status: 'planned',
    exercises: [{ exerciseName: 'Deadlift', actualSets: [] }],
  });
};

describe('GET /api/analytics/*', () => {
  test('all analytics routes require authentication', async () => {
    const res = await request(app).get('/api/analytics/workout-stats');
    expect(res.status).toBe(401);
  });

  test('strength-progression returns max weight per completed session in date order', async () => {
    const { token, userId } = await createUserAndToken(db);
    await seedSessions(userId);

    const res = await request(app)
      .get('/api/analytics/strength-progression/Bench Press')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ date: '2026-01-01', weight: 65 });
    expect(res.body[1]).toMatchObject({ date: '2026-01-08', weight: 70 });
  });

  test('user-exercises lists unique exercises from completed sessions only', async () => {
    const { token, userId } = await createUserAndToken(db);
    await seedSessions(userId);

    const res = await request(app).get('/api/analytics/user-exercises').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Bench Press', 'Squat']); // sorted; Deadlift was only planned
  });

  test('workout-stats aggregates completed/planned counts and total volume', async () => {
    const { token, userId } = await createUserAndToken(db);
    await seedSessions(userId);

    const res = await request(app).get('/api/analytics/workout-stats').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.totalCompleted).toBe(2);
    expect(res.body.totalPlanned).toBe(1);
    // (10*60)+(8*65)+(5*100) + (8*70) = 600+520+500+560 = 2180
    expect(res.body.totalVolume).toBe(2180);
  });

  test('weekly-progress summarises completion rate from weekly schedules', async () => {
    const { token, userId } = await createUserAndToken(db);
    await db.collection('weekly-schedules').insertOne({
      userId,
      weekNumber: 2,
      year: 2026,
      completedDays: 2,
      totalWorkoutDays: 4,
      startDate: new Date('2026-01-05'),
    });

    const res = await request(app).get('/api/analytics/weekly-progress').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ completed: 2, total: 4, rate: 50 });
  });
});
