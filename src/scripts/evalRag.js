const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { connectDB, closeDB } = require('../config/db');
const { searchKnowledge } = require('../services/rag/knowledgeSearchService');

dotenv.config();

async function evaluateRetrieval({ db, dataset, topK = 3 }) {
  let hits = 0;
  const misses = [];

  for (const item of dataset) {
    const { results } = await searchKnowledge({
      db,
      query: item.query,
      topic: item.topic,
      limit: topK
    });
    const matched = results.some((r) => r.sourceId === item.expectedSourceId);
    if (matched) {
      hits += 1;
    } else {
      misses.push({
        query: item.query,
        expectedSourceId: item.expectedSourceId,
        actualSourceIds: results.map((r) => r.sourceId)
      });
    }
  }

  return {
    total: dataset.length,
    hits,
    recallAtK: dataset.length > 0 ? Number((hits / dataset.length).toFixed(3)) : 0,
    misses
  };
}

if (require.main === module) {
  (async () => {
    try {
      const db = await connectDB();
      const datasetPath = path.resolve(__dirname, '../../tests/fixtures/ragEvalDataset.json');
      const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
      const report = await evaluateRetrieval({ db, dataset, topK: 3 });
      console.log('📊 RAG Retrieval Eval (Recall@3):', JSON.stringify(report, null, 2));
      if (report.recallAtK < 0.85) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error('❌ RAG eval failed:', err);
      process.exitCode = 1;
    } finally {
      await closeDB();
    }
  })();
}

module.exports = { evaluateRetrieval };
