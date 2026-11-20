const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
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

  test('validates allowed screen, source, and content length', async () => {
    const { token } = await createUserAndToken(db);

    const emptyScreenRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: '', content: 'Some feedback' });
    expect(emptyScreenRes.status).toBe(400);

    const disallowedScreenRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Nonexistent Screen', content: 'Some valid feedback' });
    expect(disallowedScreenRes.status).toBe(400);

    const invalidSourceRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Dashboard', content: 'Some valid feedback', source: 'desktop' });
    expect(invalidSourceRes.status).toBe(400);

    const whitespaceContentRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Dashboard', content: '   ' });
    expect(whitespaceContentRes.status).toBe(400);

    const shortContentRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Dashboard', content: 'hi' });
    expect(shortContentRes.status).toBe(400);

    const longContentRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({ screen: 'Dashboard', content: 'a'.repeat(1001) });
    expect(longContentRes.status).toBe(400);
  });

  test('authenticated user can submit feedback and admin can list, filter, update status, and delete it', async () => {
    const { token, email } = await createUserAndToken(db, { name: 'Gym Athlete' });

    // 1. Submit web feedback and mobile AI Coach feedback
    const submitRes = await request(app)
      .post('/api/feedbacks')
      .set(authHeader(token))
      .send({
        screen: 'Weekly Planning',
        content: 'Would love to have drag and drop reordering of sets.',
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.feedbackId).toBeDefined();
    expect(submitRes.body.source).toBe('web');
    const feedbackId = submitRes.body.feedbackId;

    const mobileSubmitRes = await request(app)
      .post('/api/feedbacks')
      .set({ ...authHeader(token), 'X-Client-Type': 'mobile' })
      .send({
        screen: 'AI Coach',
        content: 'AI Coach replies feel super helpful during workouts!',
      });
    expect(mobileSubmitRes.status).toBe(201);
    expect(mobileSubmitRes.body.source).toBe('mobile');
    const mobileFeedbackId = mobileSubmitRes.body.feedbackId;

    // 2. Non-admin cannot access admin feedback endpoints
    const nonAdminListRes = await request(app)
      .get('/api/admin/feedbacks')
      .set(authHeader(token));
    expect(nonAdminListRes.status).toBe(403);

    const nonAdminPatchRes = await request(app)
      .patch(`/api/admin/feedbacks/${feedbackId}/status`)
      .set(authHeader(token))
      .send({ status: 'reviewed' });
    expect(nonAdminPatchRes.status).toBe(403);

    const nonAdminDeleteRes = await request(app)
      .delete(`/api/admin/feedbacks/${feedbackId}`)
      .set(authHeader(token));
    expect(nonAdminDeleteRes.status).toBe(403);

    // 3. Admin lists feedbacks and verifies mapped shape & filters
    const adminListRes = await request(app)
      .get('/api/admin/feedbacks')
      .set(adminAuth());
    expect(adminListRes.status).toBe(200);
    expect(Array.isArray(adminListRes.body)).toBe(true);
    expect(adminListRes.body.length).toBe(2);
    const webItem = adminListRes.body.find((item) => item.id === feedbackId);
    const mobileItem = adminListRes.body.find((item) => item.id === mobileFeedbackId);
    expect(webItem).toBeDefined();
    expect(webItem._id).toBeUndefined();
    expect(webItem.screen).toBe('Weekly Planning');
    expect(webItem.userName).toBe('Gym Athlete');
    expect(webItem.userEmail).toBe(email);
    expect(webItem.source).toBe('web');
    expect(webItem.status).toBe('pending');
    expect(mobileItem.screen).toBe('AI Coach');
    expect(mobileItem.source).toBe('mobile');

    const filteredByScreen = await request(app)
      .get('/api/admin/feedbacks?status=pending&screen=AI%20Coach')
      .set(adminAuth());
    expect(filteredByScreen.status).toBe(200);
    expect(filteredByScreen.body.length).toBe(1);
    expect(filteredByScreen.body[0].id).toBe(mobileFeedbackId);

    const filteredByMobileSource = await request(app)
      .get('/api/admin/feedbacks?source=mobile')
      .set(adminAuth());
    expect(filteredByMobileSource.status).toBe(200);
    expect(filteredByMobileSource.body.length).toBe(1);
    expect(filteredByMobileSource.body[0].id).toBe(mobileFeedbackId);

    const filteredByWebSource = await request(app)
      .get('/api/admin/feedbacks?source=web')
      .set(adminAuth());
    expect(filteredByWebSource.status).toBe(200);
    expect(filteredByWebSource.body.length).toBe(1);
    expect(filteredByWebSource.body[0].id).toBe(feedbackId);

    const paginatedRes = await request(app)
      .get('/api/admin/feedbacks?limit=1&skip=1')
      .set(adminAuth());
    expect(paginatedRes.status).toBe(200);
    expect(paginatedRes.body.length).toBe(1);

    // 4. Admin updates status to reviewed
    const updateRes = await request(app)
      .patch(`/api/admin/feedbacks/${feedbackId}/status`)
      .set(adminAuth())
      .send({ status: 'reviewed' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.feedback._id).toBeUndefined();
    expect(updateRes.body.feedback.status).toBe('reviewed');

    const filteredReviewed = await request(app)
      .get('/api/admin/feedbacks?status=reviewed')
      .set(adminAuth());
    expect(filteredReviewed.status).toBe(200);
    expect(filteredReviewed.body.length).toBe(1);
    expect(filteredReviewed.body[0].id).toBe(feedbackId);

    // 5. Validation & 404 checks for PATCH / DELETE
    const invalidStatusRes = await request(app)
      .patch(`/api/admin/feedbacks/${feedbackId}/status`)
      .set(adminAuth())
      .send({ status: 'invalid-status' });
    expect(invalidStatusRes.status).toBe(400);

    const invalidIdPatchRes = await request(app)
      .patch('/api/admin/feedbacks/not-valid-id/status')
      .set(adminAuth())
      .send({ status: 'resolved' });
    expect(invalidIdPatchRes.status).toBe(400);

    const missingId = new ObjectId().toString();
    const notFoundPatchRes = await request(app)
      .patch(`/api/admin/feedbacks/${missingId}/status`)
      .set(adminAuth())
      .send({ status: 'resolved' });
    expect(notFoundPatchRes.status).toBe(404);

    const invalidIdDeleteRes = await request(app)
      .delete('/api/admin/feedbacks/not-valid-id')
      .set(adminAuth());
    expect(invalidIdDeleteRes.status).toBe(400);

    const notFoundDeleteRes = await request(app)
      .delete(`/api/admin/feedbacks/${missingId}`)
      .set(adminAuth());
    expect(notFoundDeleteRes.status).toBe(404);

    // 6. Admin deletes feedbacks
    const deleteRes = await request(app)
      .delete(`/api/admin/feedbacks/${feedbackId}`)
      .set(adminAuth());
    expect(deleteRes.status).toBe(200);

    const deleteMobileRes = await request(app)
      .delete(`/api/admin/feedbacks/${mobileFeedbackId}`)
      .set(adminAuth());
    expect(deleteMobileRes.status).toBe(200);

    // 7. Verify list is empty
    const listAfterDelete = await request(app)
      .get('/api/admin/feedbacks')
      .set(adminAuth());
    expect(listAfterDelete.body.length).toBe(0);
  });
});
