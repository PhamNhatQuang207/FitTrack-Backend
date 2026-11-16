const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { publicDataCache } = require('../../src/utils/memoryCache');

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

describe('Public catalog caching & admin invalidation', () => {
  test('GET /api/muscle-groups caches payload and invalidates on admin create/update', async () => {
    const first = await request(app).get('/api/muscle-groups');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('public, max-age=60');
    expect(publicDataCache.get('muscle-groups:public')).toHaveLength(14);

    // Direct DB insert behind cache should still serve cached 14 items until invalidated
    await db.collection('muscle_groups').insertOne({
      name: 'Neck',
      slug: 'neck',
      order: 15,
      isActive: true,
    });
    const cached = await request(app).get('/api/muscle-groups');
    expect(cached.body).toHaveLength(14);

    // Admin create triggers invalidation
    const created = await request(app)
      .post('/api/admin/muscle-groups')
      .set(adminAuth())
      .send({ name: 'Grip', order: 16 });
    expect(created.status).toBe(201);
    expect(publicDataCache.get('muscle-groups:public')).toBeUndefined();

    const fresh = await request(app).get('/api/muscle-groups');
    expect(fresh.body).toHaveLength(16);
  });

  test('GET /api/site-config caches payload and invalidates on PUT /api/admin/site-config', async () => {
    const first = await request(app).get('/api/site-config');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('public, max-age=60');
    expect(first.body.announcementBanner).toBe('');

    const updated = await request(app)
      .put('/api/admin/site-config')
      .set(adminAuth())
      .send({ announcementBanner: 'Maintenance at 02:00' });
    expect(updated.status).toBe(200);
    expect(publicDataCache.get('site-config:public')).toBeUndefined();

    const fresh = await request(app).get('/api/site-config');
    expect(fresh.body.announcementBanner).toBe('Maintenance at 02:00');
  });

  test('GET /api/exercises caches all/category/id and invalidates on admin exercise mutations & muscle group rename', async () => {
    await db.collection('exercises').insertOne({ name: 'Bench Press', category: 'Chest', isActive: true });

    const list1 = await request(app).get('/api/exercises');
    expect(list1.status).toBe(200);
    expect(list1.headers['cache-control']).toContain('public, max-age=60');
    expect(list1.body).toHaveLength(1);
    expect(publicDataCache.get('exercises:all')).toHaveLength(1);

    const cat1 = await request(app).get('/api/exercises/category/chest');
    expect(cat1.status).toBe(200);
    expect(publicDataCache.get('exercises:category:Chest')).toHaveLength(1);

    // Admin adds a new exercise -> invalidates exercises:*
    const createRes = await request(app)
      .post('/api/admin/exercises')
      .set(adminAuth())
      .send({ name: 'Push Up', category: 'Chest' });
    expect(createRes.status).toBe(201);
    expect(publicDataCache.get('exercises:all')).toBeUndefined();
    expect(publicDataCache.get('exercises:category:Chest')).toBeUndefined();

    const list2 = await request(app).get('/api/exercises');
    expect(list2.body).toHaveLength(2);

    // Deactivating an exercise also invalidates exercises:*
    const toggleRes = await request(app)
      .patch(`/api/admin/exercises/${createRes.body.id}/status`)
      .set(adminAuth())
      .send({ isActive: false });
    expect(toggleRes.status).toBe(200);

    const list3 = await request(app).get('/api/exercises');
    expect(list3.body).toHaveLength(1);
  });
});
