const { clearAllCaches } = require('../../src/utils/memoryCache');
const { toFloat32Binary } = require('../../src/services/rag/vectorMath');

jest.mock('@google/genai', () => {
  const mockEmbedContent = jest.fn().mockResolvedValue({
    embeddings: [{ values: [1, 0, 0] }],
  });
  return {
    GoogleGenAI: jest.fn(() => ({
      models: { embedContent: mockEmbedContent },
    })),
    __mockEmbedContent: mockEmbedContent,
  };
});

const { __mockEmbedContent } = require('@google/genai');
const { embedText } = require('../../src/services/rag/embeddingClient');
const { searchKnowledge, clearKnowledgeCache } = require('../../src/services/rag/knowledgeSearchService');

describe('RAG caching', () => {
  const prevKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    __mockEmbedContent.mockClear();
    clearAllCaches();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = prevKey;
  });

  test('embedText caches RETRIEVAL_QUERY normalized vectors and skips repeat Gemini calls', async () => {
    const v1 = await embedText('  creatine   dosage  ', { taskType: 'RETRIEVAL_QUERY' });
    const v2 = await embedText('creatine dosage', { taskType: 'RETRIEVAL_QUERY' });

    expect(v1).toEqual(v2);
    expect(__mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  test('embedText does NOT cache RETRIEVAL_DOCUMENT calls', async () => {
    await embedText('doc body', { taskType: 'RETRIEVAL_DOCUMENT', title: 'Doc 1' });
    await embedText('doc body', { taskType: 'RETRIEVAL_DOCUMENT', title: 'Doc 1' });
    expect(__mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  test('runLocalHybridSearch caches decoded chunks in ragChunksCache until cleared', async () => {
    const toArray = jest.fn().mockResolvedValue([
      {
        chunkId: 'c1',
        sourceId: 's1',
        title: 'Creatine',
        topic: 'supplements',
        authors: 'ISSN',
        year: 2017,
        section: 'Dosage',
        references: [],
        content: 'Take 3-5g creatine daily.',
        embedding: toFloat32Binary([1, 0, 0]),
      },
    ]);
    const fakeDb = {
      collection: jest.fn(() => ({ find: jest.fn(() => ({ toArray })) })),
    };

    const r1 = await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });
    const r2 = await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });

    expect(r1.results).toHaveLength(1);
    expect(r2.results).toHaveLength(1);
    expect(toArray).toHaveBeenCalledTimes(1);

    clearKnowledgeCache();
    await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });
    expect(toArray).toHaveBeenCalledTimes(2);
  });
});
