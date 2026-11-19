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

function parseMcpJsonRpc(res) {
  if (res.body && typeof res.body === 'object' && Object.keys(res.body).length > 0) {
    return res.body;
  }
  const text = res.text || '';
  const dataLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:'));
  for (const line of dataLines) {
    const rawJson = line.slice(5).trim();
    if (rawJson) {
      return JSON.parse(rawJson);
    }
  }
  return JSON.parse(text);
}

async function callMcp(authHeaders, body) {
  return request(app)
    .post('/mcp')
    .set(authHeaders)
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}

describe('E2E Flow 6: External MCP Streamable HTTP & Personal Access Key Lifecycle', () => {
  test('key generation -> Bearer & X-Mcp-Api-Key & JWT auth -> tool execution -> multi-tenant isolation -> key rotation & revocation', async () => {
    const userA = await createUserAndToken(db, {
      name: 'User A',
      age: 29,
      sex: 'Male',
      height: 178,
      weightHistory: [{ value: 76, date: new Date() }],
    });
    const userB = await createUserAndToken(db, { name: 'User B' });

    const exInsert = await db.collection('exercises').insertOne({
      name: 'Romanian Deadlift',
      category: 'Hamstrings',
      equipment: 'Barbell',
      isActive: true,
    });
    const rdlId = exInsert.insertedId.toString();

    await db.collection('workout-sessions').insertOne({
      userId: new ObjectId(userA.userId),
      name: 'Posterior Chain',
      status: 'completed',
      date: new Date(),
      exercises: [
        {
          exerciseName: 'Romanian Deadlift',
          category: 'Hamstrings',
          actualSets: [{ setNumber: 1, reps: 8, weight: 100 }],
        },
      ],
    });

    // 1. Key status initially false
    const status0 = await request(app).get('/api/ai/mcp-key').set(authHeader(userA.token));
    expect(status0.status).toBe(200);
    expect(status0.body.hasKey).toBe(false);

    // 2. Generate first ftk_ key
    const gen1 = await request(app).post('/api/ai/mcp-key').set(authHeader(userA.token));
    expect(gen1.status).toBe(201);
    const key1 = gen1.body.apiKey;
    expect(key1).toMatch(/^ftk_[a-f0-9]{48}$/);

    // Verify stored hashed in DB
    const storedA = await db.collection('users').findOne({ _id: new ObjectId(userA.userId) });
    expect(storedA.mcpApiKeyHash).toBeTruthy();
    expect(storedA.mcpApiKeyHash).not.toBe(key1);

    // 3. List tools via Authorization: Bearer ftk_...
    const listRes = await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(listRes.status).toBe(200);
    const listRpc = parseMcpJsonRpc(listRes);
    const toolNames = listRpc.result.tools.map((t) => t.name);
    expect(toolNames).toHaveLength(10);

    // 4. Call get_user_profile & get_progress_analytics via X-Mcp-Api-Key
    const profileRes = await callMcp({ 'X-Mcp-Api-Key': key1 }, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_user_profile', arguments: {} },
    });
    expect(profileRes.status).toBe(200);
    const profilePayload = JSON.parse(parseMcpJsonRpc(profileRes).result.content[0].text);
    expect(profilePayload.name).toBe('User A');
    expect(profilePayload.age).toBe(29);

    const analyticsRes = await callMcp({ 'X-Mcp-Api-Key': key1 }, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_progress_analytics', arguments: { weeksBack: 4 } },
    });
    expect(analyticsRes.status).toBe(200);
    const analyticsPayload = JSON.parse(parseMcpJsonRpc(analyticsRes).result.content[0].text);
    expect(analyticsPayload.completedSessionsCount).toBe(1);
    expect(analyticsPayload.totalVolume).toBe(800);

    // 5. Call search_exercises, save_user_memory, propose_weekly_plan, delete_user_memory
    const searchRes = await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'search_exercises', arguments: { query: 'Romanian' } },
    });
    const searchPayload = JSON.parse(parseMcpJsonRpc(searchRes).result.content[0].text);
    expect(searchPayload.exercises[0].id).toBe(rdlId);

    const memSaveRes = await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'save_user_memory',
        arguments: { category: 'equipment', key: 'home_gym', value: 'Barbell and rack' },
      },
    });
    expect(parseMcpJsonRpc(memSaveRes).result.isError).toBe(false);
    expect(await db.collection('ai-memories').countDocuments({ userId: new ObjectId(userA.userId) })).toBe(1);

    const sevenDays = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      isRestDay: i !== 0,
      workout: i === 0 ? { name: 'Hinge Day', exercises: [{ exerciseId: rdlId, sets: [{ targetReps: 8, targetWeight: 90 }] }] } : null,
    }));
    const propRes = await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'propose_weekly_plan', arguments: { name: 'MCP Plan', days: sevenDays } },
    });
    const propPayload = JSON.parse(parseMcpJsonRpc(propRes).result.content[0].text);
    expect(propPayload.draftPlan.mode).toBe('create_schedule');

    await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'delete_user_memory', arguments: { category: 'equipment', key: 'home_gym' } },
    });
    expect(await db.collection('ai-memories').countDocuments({ userId: new ObjectId(userA.userId) })).toBe(0);

    // 6. User B via User B JWT or ftk_ key cannot see User A's profile or sessions
    const genB = await request(app).post('/api/ai/mcp-key').set(authHeader(userB.token));
    const keyB = genB.body.apiKey;

    const userBProfileRes = await callMcp({ Authorization: `Bearer ${keyB}` }, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'get_user_profile', arguments: {} },
    });
    const userBProfile = JSON.parse(parseMcpJsonRpc(userBProfileRes).result.content[0].text);
    expect(userBProfile.name).toBe('User B');

    const userBAnalyticsRes = await callMcp({ Authorization: `Bearer ${userB.token}` }, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'get_progress_analytics', arguments: {} },
    });
    const userBAnalytics = JSON.parse(parseMcpJsonRpc(userBAnalyticsRes).result.content[0].text);
    expect(userBAnalytics.completedSessionsCount).toBe(0);

    // 7. Key regeneration invalidates key1; revoking key2 returns 401
    const gen2 = await request(app).post('/api/ai/mcp-key').set(authHeader(userA.token));
    expect(gen2.status).toBe(201);
    const key2 = gen2.body.apiKey;
    expect(key2).not.toBe(key1);

    const staleRes = await callMcp({ Authorization: `Bearer ${key1}` }, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/list',
    });
    expect(staleRes.status).toBe(401);

    const activeRes = await callMcp({ Authorization: `Bearer ${key2}` }, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/list',
    });
    expect(activeRes.status).toBe(200);

    await request(app).delete('/api/ai/mcp-key').set(authHeader(userA.token)).expect(200);

    const revokedRes = await callMcp({ Authorization: `Bearer ${key2}` }, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/list',
    });
    expect(revokedRes.status).toBe(401);
  });
});
