const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * Migration script to set isVerified: true for all existing users
 * Run this once to update users created before email verification was implemented
 */
async function migrateExistingUsers() {
    const client = new MongoClient(process.env.MONGO_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db();
        const usersCollection = db.collection('users');
        
        // Update all users that don't have isVerified field
        const result = await usersCollection.updateMany(
            { isVerified: { $exists: false } },
            { 
                $set: { isVerified: true },
                $unset: { verificationToken: '' }
            }
        );
        
        console.log(`✅ Migration complete!`);
        console.log(`   Updated ${result.modifiedCount} existing users`);
        console.log(`   All existing users can now log in without email verification`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await client.close();
        console.log('Disconnected from MongoDB');
    }
}

// Run the migration
migrateExistingUsers();
