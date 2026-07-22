const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * One-off migration: fold the "Middle Back" category into "Traps".
 *
 * The category string is denormalised — it lives in the `exercises` catalogue
 * AND is copied onto every exercise the user has saved into a workout, a
 * logged session, a weekly plan, and a weekly schedule. Updating only the
 * catalogue would leave saved workouts pointing at a category the UI no
 * longer offers, so all five collections are rewritten together.
 *
 * Idempotent: re-running matches nothing and reports 0 updates.
 *
 * Usage: node src/scripts/mergeMiddleBackIntoTraps.js [--dry-run]
 */

const FROM = 'Middle Back';
const TO = 'Traps';

// The Traps catalogue already contains "Machine low row"; the Middle Back copy
// ("Machine Low Row") becomes a same-category duplicate once merged.
const DUPLICATE_TO_DROP = 'Machine Low Row';

const dryRun = process.argv.includes('--dry-run');

async function run() {
    const client = new MongoClient(process.env.MONGO_URI);

    try {
        await client.connect();
        const db = client.db(process.env.DB_NAME);
        console.log(`Connected to ${process.env.DB_NAME}${dryRun ? ' (DRY RUN — nothing will be written)' : ''}`);

        // 1. The catalogue itself.
        const catalogueCount = await db.collection('exercises').countDocuments({ category: FROM });
        const dupCount = await db.collection('exercises').countDocuments({ name: DUPLICATE_TO_DROP, category: FROM });

        // 2. Saved workouts and logged sessions: exercises[].category
        const flatFilter = { 'exercises.category': FROM };
        const flatUpdate = {
            update: { $set: { 'exercises.$[e].category': TO } },
            options: { arrayFilters: [{ 'e.category': FROM }] },
        };

        // 3. Plans and schedules: days[].workout.exercises[].category
        const nestedFilter = { 'days.workout.exercises.category': FROM };
        const nestedUpdate = {
            update: { $set: { 'days.$[d].workout.exercises.$[e].category': TO } },
            options: { arrayFilters: [{ 'd.workout.exercises.category': FROM }, { 'e.category': FROM }] },
        };

        const targets = [
            { name: 'workouts', filter: flatFilter, ...flatUpdate },
            { name: 'workout-sessions', filter: flatFilter, ...flatUpdate },
            { name: 'weekly-plans', filter: nestedFilter, ...nestedUpdate },
            { name: 'weekly-schedules', filter: nestedFilter, ...nestedUpdate },
        ];

        const pending = {};
        for (const t of targets) {
            pending[t.name] = await db.collection(t.name).countDocuments(t.filter);
        }

        console.log('\nDocuments to update:');
        console.log(`  exercises (catalogue)  ${catalogueCount}${dupCount ? `  (${dupCount} duplicate to remove)` : ''}`);
        for (const t of targets) console.log(`  ${t.name.padEnd(22)} ${pending[t.name]}`);

        if (dryRun) {
            console.log('\nDry run — no changes written.');
            return;
        }

        // Remove the duplicate before rewriting, so the merged category has no
        // two entries differing only by capitalisation.
        if (dupCount) {
            await db.collection('exercises').deleteMany({ name: DUPLICATE_TO_DROP, category: FROM });
        }
        const catalogueResult = await db.collection('exercises').updateMany(
            { category: FROM },
            { $set: { category: TO } }
        );

        console.log('\nUpdated:');
        console.log(`  exercises (catalogue)  ${catalogueResult.modifiedCount}${dupCount ? `  (${dupCount} duplicate removed)` : ''}`);

        for (const t of targets) {
            const result = await db.collection(t.name).updateMany(t.filter, t.update, t.options);
            console.log(`  ${t.name.padEnd(22)} ${result.modifiedCount}`);
        }

        const leftover = await db.collection('exercises').countDocuments({ category: FROM });
        console.log(`\n${leftover === 0 ? '✅' : '❌'} "${FROM}" documents remaining in catalogue: ${leftover}`);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

run();
