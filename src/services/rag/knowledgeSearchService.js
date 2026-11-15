const { embedText } = require('./embeddingClient');
const {
  fromFloat32Binary,
  cosineSimilarity,
  reciprocalRankFusion
} = require('./vectorMath');

const KNOWLEDGE_COLLECTION = 'knowledge-chunks';
const ALLOWED_TOPICS = ['training', 'nutrition', 'supplements', 'recovery'];
const DEFAULT_MIN_VECTOR_SCORE = 0.35;

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'best', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'per',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'use', 'used', 'using', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !ENGLISH_STOPWORDS.has(t));
}

function scoreLexicalMatch(queryTokens, docContent) {
  if (queryTokens.length === 0) return 0;
  const docTokens = tokenize(docContent);
  if (docTokens.length === 0) return 0;

  const tf = new Map();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  let score = 0;
  for (const qt of new Set(queryTokens)) {
    const freq = tf.get(qt) || 0;
    if (freq > 0) {
      // BM25-like saturated term weight
      score += (freq * 2.2) / (freq + 1.2 * (0.25 + 0.75 * (docTokens.length / 200)));
    }
  }
  return score;
}

function buildAtlasVectorPipeline({ queryVector, topic, limit = 5, numCandidates = 60 }) {
  const vectorStage = {
    index: 'knowledge_vector_index',
    path: 'embedding',
    queryVector,
    numCandidates,
    limit
  };
  if (topic && ALLOWED_TOPICS.includes(topic)) {
    vectorStage.filter = { topic };
  }

  return [
    { $vectorSearch: vectorStage },
    {
      $project: {
        _id: 0,
        chunkId: 1,
        sourceId: 1,
        title: 1,
        topic: 1,
        authors: 1,
        year: 1,
        section: 1,
        references: 1,
        content: 1,
        vectorScore: { $meta: 'vectorSearchScore' }
      }
    }
  ];
}

function buildAtlasTextPipeline({ query, topic, limit = 5 }) {
  const textClause = {
    text: {
      query,
      path: ['content', 'section', 'title']
    }
  };

  const searchStage = topic && ALLOWED_TOPICS.includes(topic)
    ? {
        index: 'knowledge_text_index',
        compound: {
          must: [textClause],
          filter: [{ equals: { path: 'topic', value: topic } }]
        }
      }
    : {
        index: 'knowledge_text_index',
        ...textClause
      };

  return [
    { $search: searchStage },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        chunkId: 1,
        sourceId: 1,
        title: 1,
        topic: 1,
        authors: 1,
        year: 1,
        section: 1,
        references: 1,
        content: 1,
        lexicalScore: { $meta: 'searchScore' }
      }
    }
  ];
}

function formatResult(doc, score) {
  return {
    chunkId: doc.chunkId,
    sourceId: doc.sourceId,
    title: doc.title,
    topic: doc.topic,
    authors: doc.authors,
    year: doc.year,
    section: doc.section,
    references: Array.isArray(doc.references) ? doc.references : [],
    excerpt: doc.content,
    score: Number((score || 0).toFixed(4))
  };
}

async function runLocalHybridSearch({ db, query, queryVector, topic, limit, minScore }) {
  const filter = topic && ALLOWED_TOPICS.includes(topic) ? { topic } : {};
  const docs = await db.collection(KNOWLEDGE_COLLECTION).find(filter).toArray();
  if (docs.length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);

  const vectorScored = docs
    .map((doc) => {
      const vec = fromFloat32Binary(doc.embedding);
      const sim = cosineSimilarity(queryVector, vec);
      return { ...doc, vectorScore: sim };
    })
    .filter((doc) => doc.vectorScore >= minScore)
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, limit * 3);

  const lexicalScored = docs
    .map((doc) => ({
      ...doc,
      lexicalScore: scoreLexicalMatch(queryTokens, doc.content)
    }))
    .filter((doc) => doc.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, limit * 3);

  if (vectorScored.length === 0) {
    return [];
  }

  // Require candidates to meet the semantic threshold; lexical matches only boost RRF ordering
  const validVectorIds = new Set(vectorScored.map((d) => d.chunkId));
  const fused = reciprocalRankFusion([vectorScored, lexicalScored], 60)
    .filter((d) => validVectorIds.has(d.chunkId))
    .slice(0, limit);

  return fused.map((doc) => formatResult(doc, doc.vectorScore));
}

async function runAtlasHybridSearch({ db, query, queryVector, topic, limit, minScore }) {
  const candidateLimit = Math.min(20, limit * 3);
  const collection = db.collection(KNOWLEDGE_COLLECTION);

  const [vectorDocs, textDocs] = await Promise.all([
    collection
      .aggregate(
        buildAtlasVectorPipeline({
          queryVector,
          topic,
          limit: candidateLimit,
          numCandidates: Math.max(50, candidateLimit * 5)
        })
      )
      .toArray(),
    collection
      .aggregate(
        buildAtlasTextPipeline({
          query,
          topic,
          limit: candidateLimit
        })
      )
      .toArray()
      .catch(() => [])
  ]);

  const filteredVectorDocs = vectorDocs.filter((d) => (d.vectorScore || 0) >= minScore);
  if (filteredVectorDocs.length === 0) {
    return [];
  }

  const validVectorIds = new Set(filteredVectorDocs.map((d) => d.chunkId));
  const fused = reciprocalRankFusion([filteredVectorDocs, textDocs], 60)
    .filter((d) => validVectorIds.has(d.chunkId))
    .slice(0, limit);

  return fused.map((doc) => formatResult(doc, doc.vectorScore));
}

async function searchKnowledge({
  db,
  query,
  topic,
  limit = 5,
  minScore = DEFAULT_MIN_VECTOR_SCORE,
  mode = process.env.RAG_SEARCH_MODE || 'auto'
}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { query: '', modeUsed: mode, results: [] };
  }

  const queryVector = await embedText(cleanQuery, { taskType: 'RETRIEVAL_QUERY' });

  if (mode === 'local') {
    const results = await runLocalHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'local', results };
  }

  if (mode === 'atlas') {
    const results = await runAtlasHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'atlas', results };
  }

  // 'auto': try Atlas hybrid search first, fall back cleanly to local mode if $vectorSearch is unsupported
  try {
    const results = await runAtlasHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'atlas', results };
  } catch (err) {
    const msg = String(err?.message || '');
    const isUnsupportedAtlasStage =
      err?.code === 40324 ||
      err?.code === 31082 ||
      err?.codeName === 'Location40324' ||
      /vectorSearch|SearchNotEnabled|Atlas Search/i.test(msg);

    if (!isUnsupportedAtlasStage) {
      throw err;
    }

    const results = await runLocalHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'local', results };
  }
}

module.exports = {
  KNOWLEDGE_COLLECTION,
  ALLOWED_TOPICS,
  DEFAULT_MIN_VECTOR_SCORE,
  tokenize,
  buildAtlasVectorPipeline,
  buildAtlasTextPipeline,
  searchKnowledge
};
