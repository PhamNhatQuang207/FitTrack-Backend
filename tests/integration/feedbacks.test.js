const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

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

describe('User Feedback & Admin Management API', () => {
  test('unauthorized user cannot submit feedback', async () => {
    const res = await request(app)
      .post('/api/feedbacks')
      .send({ screen: 'Dashboard', content: 'Great app!' });
    expect(res.status).toBe(401);
  });

  test('validates screen and content length', async () => {
    const { token } = await createUserAndToken(db);

    const emptyScreenRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: '', content: 'Some feedback' });
    expect(emptyScreenRes.status).toBe(400);

    const shortContentRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Dashboard', content: 'hi' });
    expect(shortContentRes.status).toBe(400);
  });

  test('authenticated user can submit feedback and admin can list, update status, and delete it', async () => {
    const { token, userId, email } = await createUserAndToken(db, { name: 'Gym Athlete' });

    // 1. Submit feedback
    const submitRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({
        screen: 'Weekly Planning',
        content: 'Would love to have drag and drop reordering of sets.',
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.feedbackId).toBeDefined();
    const feedbackId = submitRes.body.feedbackId;

    // 2. Admin cannot access without admin token
    const nonAdminRes = await request(app)
      .get('/api/admin/feedbacks')
      .set(authHeader(token));
    expect(nonAdminRes.status).toBe(403);

    // 3. Admin lists feedbacks
    const adminListRes = await request(app)
      .get('/api/admin/feedbacks')
      .set(adminAuth());
    expect(adminListRes.status).toBe(200);
    expect(Array.isArray(adminListRes.body)).toBe(true);
    expect(adminListRes.body.length).toBe(1);
    expect(adminListRes.body[0].screen).toBe('Weekly Planning');
    expect(adminListRes.body[0].userName).toBe('Gym Athlete');
    expect(adminListRes.body[0].userEmail).toBe(email);
    expect(adminListRes.body[0].status).toBe('pending');

    // 4. Admin updates status to reviewed
    const updateRes = await request(app)
      .patch(`/api/admin/feedbacks/${feedbackId}/status`)
      .set(adminAuth())
      .send({ status: 'reviewed' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.feedback.status).toBe('reviewed');

    // 5. Test invalid status returns 400
    const invalidStatusRes = await request(app)
      .patch(`/api/admin/feedbacks/${feedbackId}/status`)
      .set(adminAuth())
      .send({ status: 'invalid-status' });
    expect(invalidStatusRes.status).toBe(400);

    // 6. Test invalid ID returns 400
    const invalidIdRes = await request(app)
      .patch('/api/admin/feedbacks/not-valid-id/status')
      .set(adminAuth())
      .send({ status: 'resolved' });
    expect(invalidIdRes.status).toBe(400);

    // 7. Admin deletes feedback
    const deleteRes = await request(app)
      .delete(`/api/admin/feedbacks/${feedbackId}`)
      .set(adminAuth());
    expect(deleteRes.status).toBe(200);

    // 8. Verify list is empty
    const listAfterDelete = await request(app)
      .get('/api/admin/feedbacks')
      .set(adminAuth());
    expect(listAfterDelete.body.length).toBe(0);
  });
});
