const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

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

describe('Muscle Groups API & Cascade Rename/Merge', () => {
  test('GET /api/muscle-groups auto-seeds the 14 default muscle groups when empty', async () => {
    const res = await request(app).get('/api/muscle-groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(14);
    expect(res.body.map((g) => g.name)).toEqual(
      expect.arrayContaining(['Chest', 'Shoulders', 'Lats', 'Lower Back', 'Traps', 'Quadriceps'])
    );
  });

  test('renaming a muscle group cascades across all 5 collections', async () => {
    await request(app).get('/api/muscle-groups');
    const traps = await db.collection('muscle_groups').findOne({ name: 'Traps' });

    await db.collection('exercises').insertOne({ name: 'Barbell Shrug', category: 'Traps' });
    await db.collection('workouts').insertOne({ exercises: [{ exerciseName: 'Barbell Shrug', category: 'Traps' }] });
    await db.collection('workout-sessions').insertOne({ exercises: [{ exerciseName: 'Barbell Shrug', category: 'Traps' }] });
    await db.collection('weekly-plans').insertOne({ days: [{ workout: { exercises: [{ category: 'Traps' }] } }] });
    await db.collection('weekly-schedules').insertOne({ days: [{ workout: { exercises: [{ category: 'Traps' }] } }] });

    const res = await request(app)
      .put(`/api/admin/muscle-groups/${traps._id}`)
      .set(adminAuth())
      .send({ name: 'Upper Traps' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Upper Traps');
    expect(res.body.slug).toBe('upper_traps');

    expect(await db.collection('exercises').countDocuments({ category: 'Upper Traps' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('workout-sessions').countDocuments({ 'exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('weekly-plans').countDocuments({ 'days.workout.exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('weekly-schedules').countDocuments({ 'days.workout.exercises.category': 'Upper Traps' })).toBe(1);
  });

  test('merging source muscle group into target updates all 5 collections and removes source', async () => {
    await request(app).get('/api/muscle-groups');
    const source = await db.collection('muscle_groups').findOne({ name: 'Lower Back' });
    const target = await db.collection('muscle_groups').findOne({ name: 'Lats' });

    await db.collection('exercises').insertOne({ name: 'Back Extension', category: 'Lower Back' });
    await db.collection('workouts').insertOne({ exercises: [{ exerciseName: 'Back Extension', category: 'Lower Back' }] });

    const res = await request(app)
      .post(`/api/admin/muscle-groups/${source._id}/merge`)
      .set(adminAuth())
      .send({ targetId: target._id.toString() });

    expect(res.status).toBe(200);
    expect(await db.collection('muscle_groups').findOne({ _id: source._id })).toBeNull();
    expect(await db.collection('exercises').countDocuments({ category: 'Lats' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Lats' })).toBe(1);
  });
});
