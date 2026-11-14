const { ObjectId } = require('mongodb');
const { validateUserInput } = require('./inputGuard');

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

const ALLOWED_MEMORY_CATEGORIES = ['goal', 'schedule', 'equipment', 'injury', 'preference'];
const MAX_MEMORIES_PER_USER = 25;
const MAX_MEMORY_VALUE_LENGTH = 200;

async function validateAndNormalizeDays({ db, days }) {
  if (!Array.isArray(days) || days.length !== 7) {
    return {
      ok: false,
      error: 'Weekly plan/schedule must contain exactly 7 days (Monday=0 through Sunday=6).'
    };
  }

  // Collect all referenced exerciseIds across all 7 days
  const referencedIds = new Set();
  for (let i = 0; i < 7; i++) {
    const day = days[i];
    if (!day || typeof day !== 'object') {
      return { ok: false, error: `Day at index ${i} must be an object.` };
    }
    if (!day.isRestDay && day.workout && Array.isArray(day.workout.exercises)) {
      for (const ex of day.workout.exercises) {
        if (!ex?.exerciseId || !ObjectId.isValid(String(ex.exerciseId))) {
          return {
            ok: false,
            error: `Invalid or inactive exerciseId "${ex?.exerciseId}". Call search_exercises first to get real exercise IDs.`
          };
        }
        referencedIds.add(String(ex.exerciseId));
      }
    }
  }

  // Verify all referenced IDs exist and are active in MongoDB
  const exerciseMap = new Map();
  if (referencedIds.size > 0) {
    const objectIds = Array.from(referencedIds).map((id) => new ObjectId(id));
    const activeExercises = await db
      .collection('exercises')
      .find({
        _id: { $in: objectIds },
        isActive: { $ne: false }
      })
      .toArray();

    for (const ex of activeExercises) {
      exerciseMap.set(ex._id.toString(), ex);
    }

    const missingIds = Array.from(referencedIds).filter((id) => !exerciseMap.has(id));
    if (missingIds.length > 0) {
      return {
        ok: false,
        error: `Invalid or inactive exerciseId(s): ${missingIds.join(', ')}. Call search_exercises first and only use returned IDs.`
      };
    }
  }

  // Normalize all 7 days in order 0..6
  const normalizedDays = [];
  for (let index = 0; index < 7; index++) {
    const rawDay = days.find((d) => Number(d.dayOfWeek) === index) || days[index];
    const rawExercises =
      !rawDay.isRestDay && Array.isArray(rawDay.workout?.exercises)
        ? rawDay.workout.exercises
        : [];

    // Any day with zero exercises is automatically normalized to a rest day
    if (rawDay.isRestDay || rawExercises.length === 0) {
      normalizedDays.push({
        dayOfWeek: index,
        dayName: DAY_NAMES[index],
        isRestDay: true,
        workout: null
      });
      continue;
    }

    const workoutName = String(rawDay.workout?.name || '').trim() || `${DAY_NAMES[index]} Workout`;

    const normalizedExercises = rawExercises.map((ex) => {
      const dbEx = exerciseMap.get(String(ex.exerciseId));
      const rawSets = Array.isArray(ex.sets) && ex.sets.length > 0
        ? ex.sets
        : [
            { setNumber: 1, targetReps: 10, targetWeight: 0 },
            { setNumber: 2, targetReps: 10, targetWeight: 0 },
            { setNumber: 3, targetReps: 10, targetWeight: 0 }
          ];

      const sets = rawSets.slice(0, 10).map((s, idx) => ({
        setNumber: idx + 1,
        targetReps: Math.max(1, Math.min(100, Number(s.targetReps) || 10)),
        targetWeight: Math.max(0, Math.min(1000, Number(s.targetWeight) || 0))
      }));

      return {
        exerciseId: dbEx._id.toString(),
        exerciseName: dbEx.name,
        category: dbEx.category,
        sets
      };
    });

    normalizedDays.push({
      dayOfWeek: index,
      dayName: DAY_NAMES[index],
      isRestDay: false,
      workout: {
        name: workoutName,
        exercises: normalizedExercises
      }
    });
  }

  return { ok: true, days: normalizedDays };
}

function validateMemoryFact({ category, key, value }) {
  if (!ALLOWED_MEMORY_CATEGORIES.includes(category)) {
    return {
      ok: false,
      error: `Invalid category. Must be one of: ${ALLOWED_MEMORY_CATEGORIES.join(', ')}`
    };
  }

  const normalizedKey = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  if (!normalizedKey) {
    return { ok: false, error: 'Memory key must be a non-empty string.' };
  }

  const trimmedValue = String(value || '').trim();
  if (!trimmedValue || trimmedValue.length > MAX_MEMORY_VALUE_LENGTH) {
    return {
      ok: false,
      error: `Memory value must be 1..${MAX_MEMORY_VALUE_LENGTH} characters.`
    };
  }

  const inputCheck = validateUserInput(trimmedValue);
  if (!inputCheck.ok) {
    return { ok: false, error: inputCheck.message };
  }

  return {
    ok: true,
    normalized: {
      category,
      key: normalizedKey,
      value: trimmedValue
    }
  };
}

module.exports = {
  DAY_NAMES,
  ALLOWED_MEMORY_CATEGORIES,
  MAX_MEMORIES_PER_USER,
  MAX_MEMORY_VALUE_LENGTH,
  validateAndNormalizeDays,
  validateMemoryFact
};
