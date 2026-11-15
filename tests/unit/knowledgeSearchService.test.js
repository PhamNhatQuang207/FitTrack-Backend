jest.mock('../../src/services/rag/embeddingClient', () => ({
  embedText: jest.fn()
}));

const { embedText } = require('../../src/services/rag/embeddingClient');
const { toFloat32Binary, normalizeVector } = require('../../src/services/rag/vectorMath');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const {
  KNOWLEDGE_COLLECTION,
  tokenize,
  buildAtlasVectorPipeline,
  buildAtlasTextPipeline,
  searchKnowledge
} = require('../../src/services/rag/knowledgeSearchService');

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
  embedText.mockReset();
});

describe('knowledgeSearchService (unit)', () => {
  test('buildAtlasVectorPipeline targets knowledge_vector_index with optional topic filter', () => {
    const pipeline = buildAtlasVectorPipeline({
      queryVector: [0.1, 0.2],
      topic: 'nutrition',
      limit: 5,
      numCandidates: 50
    });

    expect(pipeline[0].$vectorSearch).toMatchObject({
      index: 'knowledge_vector_index',
      path: 'embedding',
      numCandidates: 50,
      limit: 5,
      filter: { topic: 'nutrition' }
    });
  });

  test('buildAtlasTextPipeline targets knowledge_text_index with lucene compound filter', () => {
    const pipeline = buildAtlasTextPipeline({
      query: 'creatine loading dosage',
      topic: 'supplements',
      limit: 5
    });

    expect(pipeline[0].$search.index).toBe('knowledge_text_index');
    expect(pipeline[0].$search.compound.filter).toEqual([
      { equals: { path: 'topic', value: 'supplements' } }
    ]);
  });

  test('searchKnowledge in local mode ranks matching chunks via hybrid vector + lexical RRF', async () => {
    const proteinVec = normalizeVector([1, 0, 0, 0]);
    const squatVec = normalizeVector([0, 1, 0, 0]);

    await db.collection(KNOWLEDGE_COLLECTION).insertMany([
      {
        chunkId: 'issn-protein#0',
        sourceId: 'issn-protein-and-exercise-2017',
        title: 'Protein and Macronutrient Guidelines',
        topic: 'nutrition',
        authors: 'Jäger et al.',
        year: 2017,
        section: 'Daily Protein Targets',
        references: [{ label: 'ISSN Protein (2017)', doi: '10.1186/s12970-017-0177-8', url: 'https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8' }],
        content: 'Protein and Macronutrient Guidelines — Daily Protein Targets\nAim for 1.4 to 2.0 g/kg/day for muscle building and 2.3 to 3.1 g/kg/day during fat loss.',
        embedding: toFloat32Binary(proteinVec)
      },
      {
        chunkId: 'acsm-training#0',
        sourceId: 'acsm-schoenfeld-resistance-training',
        title: 'Resistance Training Principles',
        topic: 'training',
        authors: 'ACSM',
        year: 2009,
        section: 'Rest Intervals',
        references: [{ label: 'ACSM (2009)', doi: '10.1249/MSS.0b013e3181915670', url: 'https://doi.org/10.1249/MSS.0b013e3181915670' }],
        content: 'Resistance Training Principles — Rest Intervals\nRest 3 to 5 minutes between heavy compound sets.',
        embedding: toFloat32Binary(squatVec)
      }
    ]);

    embedText.mockResolvedValueOnce(proteinVec);

    const out = await searchKnowledge({
      db,
      query: 'How much protein per day for fat loss?',
      topic: 'nutrition',
      limit: 3,
      mode: 'local'
    });

    expect(out.modeUsed).toBe('local');
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      chunkId: 'issn-protein#0',
      sourceId: 'issn-protein-and-exercise-2017',
      section: 'Daily Protein Targets',
      year: 2017
    });
    expect(out.results[0].references).toHaveLength(1);
  });

  test('searchKnowledge returns empty array when no chunk meets minVectorScore in local mode', async () => {
    const docVec = normalizeVector([0, 1, 0, 0]);
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'acsm#0',
      sourceId: 'acsm',
      title: 'Training',
      topic: 'training',
      authors: 'ACSM',
      year: 2009,
      section: 'Rest',
      references: [],
      content: 'Squat rest intervals',
      embedding: toFloat32Binary(docVec)
    });

    embedText.mockResolvedValueOnce(normalizeVector([1, 0, 0, 0]));

    const out = await searchKnowledge({
      db,
      query: 'quantum physics black holes',
      limit: 3,
      minScore: 0.4,
      mode: 'local'
    });

    expect(out.results).toEqual([]);
  });

  test('searchKnowledge in auto mode falls back cleanly to local mode when $vectorSearch is unsupported', async () => {
    const proteinVec = normalizeVector([1, 0, 0, 0]);
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'issn-protein#0',
      sourceId: 'issn-protein-and-exercise-2017',
      title: 'Protein and Macronutrient Guidelines',
      topic: 'nutrition',
      authors: 'Jäger et al.',
      year: 2017,
      section: 'Daily Protein Targets',
      references: [],
      content: 'Aim for 1.4 to 2.0 g/kg/day for muscle building.',
      embedding: toFloat32Binary(proteinVec)
    });

    embedText.mockResolvedValueOnce(proteinVec);

    const out = await searchKnowledge({
      db,
      query: 'daily protein target',
      topic: 'nutrition',
      limit: 3,
      mode: 'auto'
    });

    expect(out.modeUsed).toBe('local');
    expect(out.results).toHaveLength(1);
    expect(out.results[0].chunkId).toBe('issn-protein#0');
  });

  test('searchKnowledge blocks long off-topic stopword queries when no chunk passes minVectorScore', async () => {
    const docVec = normalizeVector([0, 1, 0, 0]);
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'acsm#0',
      sourceId: 'acsm',
      title: 'Training',
      topic: 'training',
      authors: 'ACSM',
      year: 2009,
      section: 'Rest',
      references: [],
      content: 'What is the best guide for strength training and how to progress in sets with rest for beginners?',
      embedding: toFloat32Binary(docVec)
    });

    embedText.mockResolvedValueOnce(normalizeVector([1, 0, 0, 0]));

    const out = await searchKnowledge({
      db,
      query: 'What is the best Python tutorial for beginners and how to install it in windows?',
      limit: 3,
      minScore: 0.35,
      mode: 'local'
    });

    expect(out.results).toEqual([]);
  });

  test('tokenize strips English stopwords while preserving domain terms', () => {
    expect(tokenize('What is the best protein for muscle recovery and strength in beginners?')).toEqual([
      'protein',
      'muscle',
      'recovery',
      'strength',
      'beginners'
    ]);
  });

  test('searchKnowledge returns empty results for blank query without calling embedText', async () => {
    const out = await searchKnowledge({
      db,
      query: '   ',
      mode: 'local'
    });

    expect(out).toEqual({ query: '', modeUsed: 'local', results: [] });
    expect(embedText).not.toHaveBeenCalled();
  });
});
