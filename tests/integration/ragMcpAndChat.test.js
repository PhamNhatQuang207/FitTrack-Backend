const request = require('supertest');

jest.mock('../../src/services/ai/geminiClient', () => ({
  isGeminiConfigured: jest.fn(() => true),
  generateAgentTurn: jest.fn()
}));

jest.mock('../../src/services/rag/embeddingClient', () => ({
  embedText: jest.fn()
}));

const { generateAgentTurn, isGeminiConfigured } = require('../../src/services/ai/geminiClient');
const { embedText } = require('../../src/services/rag/embeddingClient');
const { toFloat32Binary, normalizeVector } = require('../../src/services/rag/vectorMath');
const { KNOWLEDGE_COLLECTION } = require('../../src/services/rag/knowledgeSearchService');
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
  isGeminiConfigured.mockReturnValue(true);
  generateAgentTurn.mockReset();
  embedText.mockReset();
});

describe('RAG MCP Tool & Grounded Citations (integration)', () => {
  test('exposes search_fitness_knowledge over /mcp and persists deduplicated citations on /api/ai/chat', async () => {
    const { token, userId } = await createUserAndToken(db);
    const creatineVec = normalizeVector([1, 0, 0, 0]);

    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'issn-creatine-supplementation-2017#1',
      sourceId: 'issn-creatine-supplementation-2017',
      title: 'Creatine Supplementation Safety, Dosage, and Efficacy',
      topic: 'supplements',
      authors: 'Kreider et al. (ISSN)',
      year: 2017,
      section: 'Dosing Protocols',
      references: [
        {
          label: 'ISSN Position Stand - Creatine (2017)',
          doi: '10.1186/s12970-017-0173-z',
          url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5469049/'
        }
      ],
      content: 'Taking 3 to 5 g/day of creatine monohydrate achieves full muscle saturation over 3 to 4 weeks.',
      embedding: toFloat32Binary(creatineVec)
    });

    embedText.mockResolvedValue(creatineVec);

    // 1. Verify external /mcp tool call
    const mcpRes = await request(app)
      .post('/mcp')
      .set(authHeader(token))
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_fitness_knowledge',
          arguments: { query: 'creatine daily dosage', topic: 'supplements', limit: 3 }
        }
      });

    expect(mcpRes.status).toBe(200);
    const mcpText = mcpRes.text || JSON.stringify(mcpRes.body);
    expect(mcpText).toContain('issn-creatine-supplementation-2017#1');

    // 2. Verify /api/ai/chat executes tool via InMemoryTransport and persists citations
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [
          {
            name: 'search_fitness_knowledge',
            args: { query: 'creatine daily dosage', topic: 'supplements', limit: 3 }
          }
        ],
        text: ''
      })
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Daily intake of 3-5 g creatine monohydrate saturates muscle stores over 3-4 weeks [1].'
      });

    const chatRes = await request(app)
      .post('/api/ai/chat')
      .set(authHeader(token))
      .send({ message: 'How much creatine should I take per day?' });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.assistantMessage.toolTrace).toEqual([
      { name: 'search_fitness_knowledge', status: 'ok' }
    ]);
    expect(chatRes.body.assistantMessage.citations).toHaveLength(1);
    expect(chatRes.body.assistantMessage.citations[0]).toMatchObject({
      citationNumber: 1,
      chunkId: 'issn-creatine-supplementation-2017#1',
      section: 'Dosing Protocols'
    });

    const savedConv = await db.collection('ai-conversations').findOne({ userId });
    expect(savedConv.messages[1].citations).toHaveLength(1);
  });
});
