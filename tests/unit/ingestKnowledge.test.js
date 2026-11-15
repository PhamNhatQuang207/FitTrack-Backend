const path = require('path');
const { Binary } = require('mongodb');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { KNOWLEDGE_COLLECTION } = require('../../src/services/rag/knowledgeSearchService');
const { ingestKnowledgeDirectory } = require('../../src/scripts/ingestKnowledge');

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

describe('ingestKnowledge (unit)', () => {
  test('embeds all chunks on first run, skips unchanged chunks on second run, and stores Binary Float32', async () => {
    const knowledgeDir = path.resolve(__dirname, '../../src/data/knowledge');
    const mockEmbedFn = jest.fn(async (items) =>
      items.map(() => [1, ...Array(767).fill(0)])
    );

    const first = await ingestKnowledgeDirectory({ db, knowledgeDir, embedFn: mockEmbedFn });
    expect(first.totalChunks).toBeGreaterThanOrEqual(12);
    expect(first.embeddedCount).toBe(first.totalChunks);
    expect(first.skippedCount).toBe(0);

    const sampleDoc = await db.collection(KNOWLEDGE_COLLECTION).findOne({});
    expect(sampleDoc.embedding.sub_type).toBe(Binary.SUBTYPE_VECTOR);
    expect(sampleDoc.embedding.buffer.byteLength).toBe(768 * 4 + 2);

    // Insert a stale chunk to confirm pruning works
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'obsolete-source#0',
      sourceId: 'obsolete-source'
    });

    mockEmbedFn.mockClear();
    const second = await ingestKnowledgeDirectory({ db, knowledgeDir, embedFn: mockEmbedFn });
    expect(second.embeddedCount).toBe(0);
    expect(second.skippedCount).toBe(first.totalChunks);
    expect(second.deletedCount).toBe(1);
    expect(mockEmbedFn).not.toHaveBeenCalled();
  });
});
