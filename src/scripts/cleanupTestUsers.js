const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * Clean up test users - delete all unverified users
 */
async function cleanupTestUsers() {
    const client = new MongoClient(process.env.MONGO_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db();
        const usersCollection = db.collection('users');
        
        // Delete all unverified users
        const result = await usersCollection.deleteMany({ isVerified: false });
        
        console.log(`✅ Cleanup complete!`);
        console.log(`   Deleted ${result.deletedCount} unverified test users`);
        console.log(`   You can now register a fresh user`);
        
    } catch (error) {
        console.error('❌ Cleanup failed:', error);
    } finally {
        await client.close();
        console.log('Disconnected from MongoDB');
    }
}

cleanupTestUsers();
