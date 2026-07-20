const request = require('supertest');
const { ObjectId } = require('mongodb');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

let db;
const benchId = new ObjectId();

beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => {
  await stopTestDb();
});
beforeEach(async () => {
  await clearDb();
  await db.collection('exercises').insertMany([
    { _id: benchId, name: 'Bench Press', category: 'Chest' },
    { name: 'Incline Press', category: 'Chest' },
    { name: 'Barbell Row', category: 'Middle Back' },
    { name: 'Deadlift', category: 'Lower Back' },
  ]);
});

describe('GET /api/exercises', () => {
  test('returns all exercises with id mapped from _id', async () => {
    const res = await request(app).get('/api/exercises');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]._id).toBeUndefined();
  });
});

describe('GET /api/exercises/category/:category', () => {
  test('filters by a single-word category', async () => {
    const res = await request(app).get('/api/exercises/category/chest');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((e) => e.category === 'Chest')).toBe(true);
  });

  test('converts an underscored category to Title Case ("middle_back" -> "Middle Back")', async () => {
    const res = await request(app).get('/api/exercises/category/middle_back');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Barbell Row');
  });
});

describe('GET /api/exercises/search', () => {
  test('finds exercises by case-insensitive substring', async () => {
    const res = await request(app).get('/api/exercises/search').query({ q: 'press' });
    expect(res.status).toBe(200);
    const names = res.body.map((e) => e.name).sort();
    expect(names).toEqual(['Bench Press', 'Incline Press']);
  });

  test('requires a query string', async () => {
    const res = await request(app).get('/api/exercises/search');
    expect(res.status).toBe(400);
  });

  test('SECURITY (ReDoS): treats regex metacharacters as literal text, not a pattern', async () => {
    // Before the fix this string was compiled as a regex and could cause
    // catastrophic backtracking. Now it is matched literally -> no match, no hang.
    const res = await request(app).get('/api/exercises/search').query({ q: '(a+)+$' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('SECURITY: a "match-all" regex ".*" no longer returns every row', async () => {
    const res = await request(app).get('/api/exercises/search').query({ q: '.*' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]); // literal ".*" matches no exercise name
  });

  test('SECURITY: rejects an over-long query', async () => {
    const res = await request(app)
      .get('/api/exercises/search')
      .query({ q: 'a'.repeat(101) });
    expect(res.status).toBe(400);
  });

  test('SECURITY: rejects a non-string query (array param)', async () => {
    // ?q=a&q=b is parsed as an array -> typeof !== 'string'
    const res = await request(app).get('/api/exercises/search?q=a&q=b');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/exercises/:id', () => {
  test('returns a single exercise by id', async () => {
    const res = await request(app).get(`/api/exercises/${benchId.toString()}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bench Press');
  });

  test('returns 404 for a valid but unknown id', async () => {
    const res = await request(app).get(`/api/exercises/${new ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });
});
