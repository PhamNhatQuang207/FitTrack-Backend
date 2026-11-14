const request = require('supertest');
const app = require('../../src/app');

describe('Backend-hosted Admin UI', () => {
  test('GET /admin/ serves index.html', async () => {
    const res = await request(app).get('/admin/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('FitTrack Admin');
  });

  test('GET /admin/app.js serves client script', async () => {
    const res = await request(app).get('/admin/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });
});
