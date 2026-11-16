const { GoogleGenAI } = require('@google/genai');
const { normalizeVector } = require('./vectorMath');
const { ragEmbeddingCache } = require('../../utils/memoryCache');

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 768;

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }
  return new GoogleGenAI({ apiKey });
}

async function embedText(text, { taskType = 'RETRIEVAL_QUERY', title } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Cannot embed empty text');
  }

  const cacheKey = taskType === 'RETRIEVAL_QUERY'
    ? `${EMBEDDING_MODEL}:${cleanText.toLowerCase().replace(/\s+/g, ' ')}`
    : null;
  if (cacheKey) {
    const cached = ragEmbeddingCache.get(cacheKey);
    if (cached) return cached;
  }

  const ai = getAiClient();
  const config = {
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS
  };
  if (title && taskType === 'RETRIEVAL_DOCUMENT') {
    config.title = title;
  }

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: cleanText,
    config
  });

  const values = response?.embeddings?.[0]?.values || response?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedContent returned empty embedding vector');
  }
  const normalized = normalizeVector(values);
  if (cacheKey) {
    ragEmbeddingCache.set(cacheKey, normalized);
  }
  return normalized;
}

async function embedDocuments(items) {
  const vectors = [];
  for (const item of items) {
    const vec = await embedText(item.text, {
      taskType: 'RETRIEVAL_DOCUMENT',
      title: item.title
    });
    vectors.push(vec);
  }
  return vectors;
}

module.exports = {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedText,
  embedDocuments
};
