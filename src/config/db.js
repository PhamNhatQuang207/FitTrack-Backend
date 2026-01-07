const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const url = process.env.MONGO_URI;
const client = new MongoClient(url);
const dbName = process.env.DB_NAME;

let db;

const connectDB = async () => {
  try {
    await client.connect();
    console.log('✅ Connected successfully to MongoDB Atlas');
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

module.exports = { connectDB, getDb };