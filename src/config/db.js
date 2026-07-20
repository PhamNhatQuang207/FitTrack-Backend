const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

let client;
let db;

const connectDB = async () => {
  // Read connection info at call time so tests (and env reloads) are respected.
  const url = process.env.MONGO_URI;
  const dbName = process.env.DB_NAME;
  try {
    client = new MongoClient(url);
    await client.connect();
    console.log('✅ Connected successfully to MongoDB');
    db = client.db(dbName);
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
