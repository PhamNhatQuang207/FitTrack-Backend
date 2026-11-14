const request = require('supertest');
const { ObjectId } = require('mongodb');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');
const { createFitTrackMcpServer } = require('../../src/mcp/createFitTrackMcpServer');

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

async function connectInMemoryClient(userId) {
  const mcpServer = createFitTrackMcpServer({ db, userId: userId.toString() });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcpServer.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return { client, mcpServer };
}

describe('FitTrack MCP Server & /mcp Endpoint (integration)', () => {
  test('HTTP /mcp rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  test('HTTP /mcp accepts authenticated requests and responds with 200 stream', async () => {
    const { token } = await createUserAndToken(db);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"tools"');
    expect(res.text).toContain('search_exercises');
  });

  test('lists all 8 tools via InMemoryTransport', async () => {
    const { userId } = await createUserAndToken(db);
    const { client, mcpServer } = await connectInMemoryClient(userId);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'delete_user_memory',
      'edit_weekly_schedule',
      'get_progress_analytics',
      'get_user_profile',
      'get_weekly_plans',
      'propose_weekly_plan',
      'save_user_memory',
      'search_exercises'
    ]);

    await client.close();
    await mcpServer.close();
  });

  test('executes search_exercises, propose_weekly_plan, edit_weekly_schedule, and memory tools scoped to userId', async () => {
    const { userId } = await createUserAndToken(db);
    const exInsert = await db.collection('exercises').insertOne({
      name: 'Incline Dumbbell Press',
      category: 'Chest',
      equipment: 'Dumbbell',
      isActive: true
    });
    const exId = exInsert.insertedId.toString();

    const { client, mcpServer } = await connectInMemoryClient(userId);

    // 1. search_exercises
    const searchRes = await client.callTool({
      name: 'search_exercises',
      arguments: { query: 'Incline' }
    });
    const searchData = JSON.parse(searchRes.content[0].text);
    expect(searchData.exercises).toHaveLength(1);
    expect(searchData.exercises[0].id).toBe(exId);

    // 2. propose_weekly_plan rejects hallucinated exerciseId
    const badDays = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      isRestDay: i !== 0,
      workout: i === 0
        ? {
            name: 'Chest Day',
            exercises: [
              {
                exerciseId: new ObjectId().toString(),
                sets: [{ setNumber: 1, targetReps: 10, targetWeight: 20 }]
              }
            ]
          }
        : null
    }));
    const badPlanRes = await client.callTool({
      name: 'propose_weekly_plan',
      arguments: { name: 'Bad Plan', days: badDays }
    });
    expect(badPlanRes.isError).toBe(true);

    // 3. propose_weekly_plan returns validated create_schedule draft without inserting to DB
    const goodDays = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      isRestDay: i !== 0,
      workout: i === 0
        ? {
            name: 'Chest Day',
            exercises: [
              {
                exerciseId: exId,
                sets: [{ setNumber: 1, targetReps: 10, targetWeight: 20 }]
              }
            ]
          }
        : null
    }));
    const goodPlanRes = await client.callTool({
      name: 'propose_weekly_plan',
      arguments: { name: 'Upper Lower Split', description: '4 day split', days: goodDays }
    });
    expect(goodPlanRes.isError).toBeFalsy();
    const draftPayload = JSON.parse(goodPlanRes.content[0].text);
    expect(draftPayload.draftPlan.mode).toBe('create_schedule');
    expect(draftPayload.draftPlan.plan.days[0].workout.exercises[0].exerciseName).toBe(
      'Incline Dumbbell Press'
    );
    expect(await db.collection('weekly-plans').countDocuments({ userId })).toBe(0);

    // 4. edit_weekly_schedule requires an active weekly-schedules record for userId
    const noActiveScheduleRes = await client.callTool({
      name: 'edit_weekly_schedule',
      arguments: { name: 'Updated Current Week', days: goodDays }
    });
    expect(noActiveScheduleRes.isError).toBe(true);

    // Insert active weekly schedule and verify edit_weekly_schedule returns edit_schedule draft
    const activeSchedule = await db.collection('weekly-schedules').insertOne({
      userId,
      weeklyPlanName: 'Current Plan',
      weekNumber: 46,
      year: 2026,
      status: 'active',
      days: goodDays
    });
    const editScheduleRes = await client.callTool({
      name: 'edit_weekly_schedule',
      arguments: { name: 'Updated Current Week', days: goodDays }
    });
    expect(editScheduleRes.isError).toBeFalsy();
    const editDraft = JSON.parse(editScheduleRes.content[0].text);
    expect(editDraft.draftPlan.mode).toBe('edit_schedule');
    expect(editDraft.draftPlan.targetScheduleId).toBe(activeSchedule.insertedId.toString());

    // 5. save_user_memory & delete_user_memory
    const saveMemRes = await client.callTool({
      name: 'save_user_memory',
      arguments: { category: 'goal', key: 'Primary Goal', value: 'Hypertrophy 4 days/week' }
    });
    expect(saveMemRes.isError).toBeFalsy();
    expect(await db.collection('ai-memories').countDocuments({ userId })).toBe(1);

    await client.callTool({
      name: 'delete_user_memory',
      arguments: { category: 'goal', key: 'primary_goal' }
    });
    expect(await db.collection('ai-memories').countDocuments({ userId })).toBe(0);

    await client.close();
    await mcpServer.close();
  });
});
