const { getDb } = require('../config/db');
const exercises = require('../data/exercise.json');

async function seedExercises() {
  try {
    const db = getDb();

    // Check if exercises already exist
    const count = await db.collection('exercises').countDocuments();
    if (count > 0) {
      console.log(`⚠️  Exercises collection already has ${count} documents. Skipping seed.`);
      return;
    }

    // Insert exercises from the Atlas-synced dataset
    const result = await db.collection('exercises').insertMany(exercises);
    console.log(`✅ Successfully seeded ${result.insertedCount} exercises`);

    // Create indexes
    await db.collection('exercises').createIndex({ category: 1 });
    await db.collection('exercises').createIndex({ name: 'text' });
    console.log('✅ Created indexes on exercises collection');
  } catch (error) {
    console.error('❌ Error seeding exercises:', error);
    throw error;
  }
}

module.exports = { seedExercises, exercises };
