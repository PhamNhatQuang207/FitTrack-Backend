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

describe('E2E Flow 7: Admin Control Center, RBAC Isolation, 5-Collection Cascade & Cache Invalidation', () => {
  test('serves Admin UI, enforces strict admin/user RBAC isolation, cascades muscle group edits, manages exercises & site config', async () => {
    // 1. Admin static UI & security headers
    const uiHtml = await request(app).get('/admin/');
    expect(uiHtml.status).toBe(200);
    expect(uiHtml.headers['content-security-policy']).toBeDefined();
    expect(uiHtml.headers['x-powered-by']).toBeUndefined();

    await request(app).get('/admin/app.js').expect(200);
    await request(app).get('/admin/styles.css').expect(200);

    // 2. Admin login flow (reject invalid, accept valid)
    await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);

    const adminLogin = await request(app)
      .post('/api/admin/login')
      .send({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
      });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;
    expect(adminToken).toEqual(expect.any(String));

    // 3. Strict RBAC token isolation
    const { token: userToken, userId } = await createUserAndToken(db);

    await request(app).get('/api/admin/exercises').set(authHeader(userToken)).expect(403);
    await request(app).post('/api/admin/muscle-groups').set(authHeader(userToken)).send({ name: 'Hack' }).expect(403);
    await request(app).put('/api/admin/site-config').set(authHeader(userToken)).send({ announcementBanner: 'x' }).expect(403);

    await request(app).get('/api/users/progress').set(authHeader(adminToken)).expect(401);
    await request(app).get('/api/weekly-plans').set(authHeader(adminToken)).expect(401);
    await request(app).get('/api/ai/conversations').set(authHeader(adminToken)).expect(401);
    await request(app)
      .post('/mcp')
      .set(authHeader(adminToken))
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    // 4. Muscle group lifecycle: warm public cache -> create invalidates -> rename cascades across 5 collections -> merge cascades
    const publicGroups1 = await request(app).get('/api/muscle-groups');
    expect(publicGroups1.status).toBe(200);
    expect(publicGroups1.body).toHaveLength(14);

    const createGroup = await request(app)
      .post('/api/admin/muscle-groups')
      .set(authHeader(adminToken))
      .send({ name: 'Neck', order: 15, translations: { vi: { name: 'Cổ' } } });
    expect(createGroup.status).toBe(201);
    const neckId = createGroup.body.id;

    const publicGroups2 = await request(app).get('/api/muscle-groups');
    expect(publicGroups2.body).toHaveLength(15);
    expect(publicGroups2.body.find((g) => g.id === neckId)).toBeDefined();

    // Create exercise & user documents referencing 'Neck' across all 5 collections
    const createEx = await request(app)
      .post('/api/admin/exercises')
      .set(authHeader(adminToken))
      .send({
        name: 'Neck Curl',
        category: 'Neck',
        equipment: 'Plate',
        difficulty: 'Intermediate',
        imageUrl: 'https://fittrack.io.vn/images/neck-curl.png',
        instructions: ['Lie supine', 'Flex neck'],
        translations: { vi: { name: 'Gập cổ với đĩa tạ', instructions: ['Nằm ngửa', 'Gập cổ'] } },
      });
    expect(createEx.status).toBe(201);
    const exId = createEx.body.id;

    await db.collection('workouts').insertOne({
      userId,
      date: new Date(),
      exercises: [{ exerciseName: 'Neck Curl', category: 'Neck', sets: [{ setNumber: 1, reps: 15, weight: 10 }] }],
    });
    await db.collection('workout-sessions').insertOne({
      userId,
      name: 'Neck Session',
      status: 'completed',
      date: new Date(),
      exercises: [{ exerciseId: new ObjectId(exId), exerciseName: 'Neck Curl', category: 'Neck', actualSets: [] }],
    });
    await db.collection('weekly-plans').insertOne({
      userId,
      name: 'Neck Plan',
      days: [{ dayOfWeek: 0, isRestDay: false, workout: { name: 'Day 1', exercises: [{ exerciseId: exId, category: 'Neck' }] } }],
    });
    await db.collection('weekly-schedules').insertOne({
      userId,
      weeklyPlanName: 'Neck Plan',
      status: 'active',
      days: [{ dayOfWeek: 0, isRestDay: false, workout: { name: 'Day 1', exercises: [{ exerciseId: exId, category: 'Neck' }] } }],
    });

    // Warm public exercise caches
    await request(app).get('/api/exercises').expect(200);
    await request(app).get('/api/exercises/category/neck').expect(200);

    // Rename 'Neck' -> 'Cervical Flexors'
    const renameGroup = await request(app)
      .put(`/api/admin/muscle-groups/${neckId}`)
      .set(authHeader(adminToken))
      .send({ name: 'Cervical Flexors' });
    expect(renameGroup.status).toBe(200);
    expect(renameGroup.body.slug).toBe('cervical_flexors');

    expect(await db.collection('exercises').countDocuments({ category: 'Cervical Flexors' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Cervical Flexors' })).toBe(1);
    expect(await db.collection('workout-sessions').countDocuments({ 'exercises.category': 'Cervical Flexors' })).toBe(1);
    expect(await db.collection('weekly-plans').countDocuments({ 'days.workout.exercises.category': 'Cervical Flexors' })).toBe(1);
    expect(await db.collection('weekly-schedules').countDocuments({ 'days.workout.exercises.category': 'Cervical Flexors' })).toBe(1);

    // Public exercise cache reflects renamed category immediately
    const renamedPublicEx = await request(app).get('/api/exercises');
    expect(renamedPublicEx.body[0].category).toBe('Cervical Flexors');

    // Merge 'Cervical Flexors' into 'Traps'
    const trapsGroup = await db.collection('muscle_groups').findOne({ name: 'Traps' });
    await request(app)
      .post(`/api/admin/muscle-groups/${neckId}/merge`)
      .set(authHeader(adminToken))
      .send({ targetId: trapsGroup._id.toString() })
      .expect(200);

    expect(await db.collection('muscle_groups').findOne({ _id: new ObjectId(neckId) })).toBeNull();
    expect(await db.collection('exercises').countDocuments({ category: 'Traps' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Traps' })).toBe(1);
    expect(await db.collection('workout-sessions').countDocuments({ 'exercises.category': 'Traps' })).toBe(1);
    expect(await db.collection('weekly-plans').countDocuments({ 'days.workout.exercises.category': 'Traps' })).toBe(1);
    expect(await db.collection('weekly-schedules').countDocuments({ 'days.workout.exercises.category': 'Traps' })).toBe(1);

    // 5. Exercise update, soft-delete, history-by-id preservation, and restore
    const updEx = await request(app)
      .put(`/api/admin/exercises/${exId}`)
      .set(authHeader(adminToken))
      .send({ name: 'Neck Curl Pro' });
    expect(updEx.status).toBe(200);
    expect(updEx.body.name).toBe('Neck Curl Pro');

    await request(app)
      .patch(`/api/admin/exercises/${exId}/status`)
      .set(authHeader(adminToken))
      .send({ isActive: false })
      .expect(200);

    const activeOnly = await request(app).get('/api/exercises');
    expect(activeOnly.body).toHaveLength(0);

    const searchHidden = await request(app).get('/api/exercises/search').query({ q: 'Neck' });
    expect(searchHidden.body).toHaveLength(0);

    // Historical workout lookup by ID remains accessible
    const historyById = await request(app).get(`/api/exercises/${exId}`);
    expect(historyById.status).toBe(200);
    expect(historyById.body.name).toBe('Neck Curl Pro');

    await request(app)
      .patch(`/api/admin/exercises/${exId}/status`)
      .set(authHeader(adminToken))
      .send({ isActive: true })
      .expect(200);

    const restoredList = await request(app).get('/api/exercises');
    expect(restoredList.body).toHaveLength(1);

    // 6. Site config update & cache invalidation
    await request(app).get('/api/site-config').expect(200);

    await request(app)
      .put('/api/admin/site-config')
      .set(authHeader(adminToken))
      .send({
        heroBackgroundUrl: 'https://fittrack.io.vn/hero.jpg',
        announcementBanner: 'E2E Banner Live',
        featuredNote: 'Train consistently',
      })
      .expect(200);

    const freshCfg = await request(app).get('/api/site-config');
    expect(freshCfg.status).toBe(200);
    expect(freshCfg.body.announcementBanner).toBe('E2E Banner Live');
    expect(freshCfg.body.heroBackgroundUrl).toBe('https://fittrack.io.vn/hero.jpg');
  });
});
