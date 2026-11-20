const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

let client;
let db;

const ensureIndexes = async (database) => {
  try {
    await Promise.all([
      database.collection('refresh-tokens').createIndex({ tokenHash: 1 }, { unique: true }),
      database.collection('refresh-tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database.collection('users').createIndex({ mcpApiKeyHash: 1 }, { sparse: true }),
      database.collection('feedbacks').createIndex({ status: 1, createdAt: -1 }),
      database.collection('feedbacks').createIndex({ source: 1, createdAt: -1 }),
      database.collection('feedbacks').createIndex({ createdAt: -1 }),
    ]);
  } catch (err) {
    console.warn('⚠️ Failed to ensure MongoDB indexes:', err.message);
  }
};

const connectDB = async () => {
  // Read connection info at call time so tests (and env reloads) are respected.
  const url = process.env.MONGO_URI;
  const dbName = process.env.DB_NAME;
  try {
    client = new MongoClient(url);
    await client.connect();
    console.log('✅ Connected successfully to MongoDB');
    db = client.db(dbName);
    await ensureIndexes(db);
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const getDb = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
};

// Close the active connection (used by the test suite for clean teardown).
const closeDB = async () => {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
};

module.exports = { connectDB, getDb, closeDB };
