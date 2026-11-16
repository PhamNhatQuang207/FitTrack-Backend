const path = require('path');
const dotenv = require('dotenv');
const { connectDB, closeDB } = require('../config/db');
const { loadAndChunkKnowledgeDir } = require('../services/rag/chunker');
const { embedDocuments } = require('../services/rag/embeddingClient');
const { toFloat32Binary } = require('../services/rag/vectorMath');
const { KNOWLEDGE_COLLECTION, clearKnowledgeCache } = require('../services/rag/knowledgeSearchService');

dotenv.config();

async function ingestKnowledgeDirectory({
  db,
  knowledgeDir = path.resolve(__dirname, '../data/knowledge'),
  embedFn = embedDocuments
}) {
  const chunks = loadAndChunkKnowledgeDir(knowledgeDir);
  const collection = db.collection(KNOWLEDGE_COLLECTION);

  await collection.createIndex({ chunkId: 1 }, { unique: true });
  await collection.createIndex({ topic: 1 });

  const existingDocs = await collection
    .find({}, { projection: { chunkId: 1, contentHash: 1 } })
    .toArray();
  const existingHashes = new Map(existingDocs.map((d) => [d.chunkId, d.contentHash]));

  const chunksToEmbed = chunks.filter((c) => existingHashes.get(c.chunkId) !== c.contentHash);
  const skippedCount = chunks.length - chunksToEmbed.length;

  let embeddedCount = 0;
  if (chunksToEmbed.length > 0) {
    const vectors = await embedFn(
      chunksToEmbed.map((c) => ({ text: c.content, title: c.title }))
    );

    const now = new Date();
    const bulkOps = chunksToEmbed.map((chunk, i) => ({
      updateOne: {
        filter: { chunkId: chunk.chunkId },
        update: {
          $set: {
            ...chunk,
            embedding: toFloat32Binary(vectors[i]),
            updatedAt: now
          }
        },
        upsert: true
      }
    }));

    await collection.bulkWrite(bulkOps);
    embeddedCount = chunksToEmbed.length;
  }

  const validIds = chunks.map((c) => c.chunkId);
  const pruneRes = await collection.deleteMany({ chunkId: { $nin: validIds } });
  const deletedCount = pruneRes.deletedCount || 0;

  if (embeddedCount > 0 || deletedCount > 0) {
    clearKnowledgeCache();
  }

  return {
    totalChunks: chunks.length,
    embeddedCount,
    skippedCount,
    deletedCount
  };
}

if (require.main === module) {
  (async () => {
    try {
      const db = await connectDB();
      const summary = await ingestKnowledgeDirectory({ db });
      console.log('✅ Knowledge ingestion complete:', summary);
    } catch (err) {
      console.error('❌ Knowledge ingestion failed:', err);
      process.exitCode = 1;
    } finally {
      await closeDB();
    }
  })();
}

module.exports = { ingestKnowledgeDirectory };
