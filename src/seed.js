const { connectDB } = require('./config/db');
const { seedExercises } = require('./seeds/exercises.seed');

const seedDatabase = async () => {
    try {
        await connectDB();
        console.log('🌱 Starting database seeding...\n');
        
        await seedExercises();
        
        console.log('\n✅ Database seeding completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedDatabase();