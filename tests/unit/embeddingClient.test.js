const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    models: {
      embedContent: mockEmbedContent
    }
  }))
}));

const {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedText,
  embedDocuments
} = require('../../src/services/rag/embeddingClient');

describe('embeddingClient (unit)', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-api-key';
    mockEmbedContent.mockReset();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  test('embedText requests 768-dim embedding and L2-normalizes the returned vector', async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [3, 4, ...Array(766).fill(0)] }]
    });

    const vec = await embedText('how much protein for fat loss', {
      taskType: 'RETRIEVAL_QUERY'
    });

    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      contents: 'how much protein for fat loss',
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    });
    expect(vec).toHaveLength(768);
    expect(vec[0]).toBeCloseTo(0.6, 5);
    expect(vec[1]).toBeCloseTo(0.8, 5);
  });

  test('embedDocuments embeds each document with RETRIEVAL_DOCUMENT and title', async () => {
    mockEmbedContent.mockResolvedValue({
      embedding: { values: [1, ...Array(767).fill(0)] }
    });

    const vectors = await embedDocuments([
      { text: 'Chunk 1', title: 'Doc 1' },
      { text: 'Chunk 2', title: 'Doc 2' }
    ]);

    expect(vectors).toHaveLength(2);
    expect(mockEmbedContent).toHaveBeenNthCalledWith(1, {
      model: EMBEDDING_MODEL,
      contents: 'Chunk 1',
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        title: 'Doc 1',
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    });
  });

  test('throws 503-tagged error when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(embedText('test')).rejects.toMatchObject({ statusCode: 503 });
  });
});
