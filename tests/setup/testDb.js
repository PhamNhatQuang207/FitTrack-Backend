const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDB, getDb, closeDB } = require('../../src/config/db');

let mongod;

// Start an in-memory MongoDB and point the app's DB layer at it.
const startTestDb = async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.DB_NAME = 'fittrack_test';
  await connectDB();
  return getDb();
};

// Close the connection and shut the in-memory server down.
const stopTestDb = async () => {
  await closeDB();
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
};

// Wipe every collection between tests for isolation.
const clearDb = async () => {
  const db = getDb();
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    await db.collection(c.name).deleteMany({});
  }
};

module.exports = { startTestDb, stopTestDb, clearDb };
