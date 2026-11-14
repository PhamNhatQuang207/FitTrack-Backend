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

describe('Admin Exercises API', () => {
  test('admin can create, update, soft-delete, and still fetch by ID for history', async () => {
    const createRes = await request(app)
      .post('/api/admin/exercises')
      .set(adminAuth())
      .send({
        name: 'Incline Cable Fly',
        category: 'Chest',
        muscleGroup: 'Chest',
        equipment: 'Cable',
        difficulty: 'Intermediate',
        imageUrl: 'https://example.com/fly.png',
        instructions: ['Set bench to 30 degrees', 'Bring handles together'],
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id;

    const updateRes = await request(app)
      .put(`/api/admin/exercises/${id}`)
      .set(adminAuth())
      .send({ name: 'Incline Cable Fly V2', category: 'Chest' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Incline Cable Fly V2');

    const hideRes = await request(app)
      .patch(`/api/admin/exercises/${id}/status`)
      .set(adminAuth())
      .send({ isActive: false });
    expect(hideRes.status).toBe(200);
    expect(hideRes.body.isActive).toBe(false);

    // Public list excludes soft-deleted
    const publicList = await request(app).get('/api/exercises');
    expect(publicList.body.find((e) => e.id === id)).toBeUndefined();

    // Public getExerciseById still works for historical workouts
    const byId = await request(app).get(`/api/exercises/${id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.name).toBe('Incline Cable Fly V2');
  });
});
