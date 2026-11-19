const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');
const { publicDataCache } = require('../utils/memoryCache');
const { isSafeHttpUrl, safeServerError } = require('../utils/security');

const MAX_INSTRUCTIONS = 50;

const mapExercise = (ex) => ({
  ...ex,
  id: ex._id.toString(),
  _id: undefined,
});

function sanitizeExerciseTranslations(raw) {
  const viName = typeof raw?.vi?.name === 'string' ? raw.vi.name.trim() : '';
  const viInstructions = Array.isArray(raw?.vi?.instructions)
    ? raw.vi.instructions
        .filter((s) => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_INSTRUCTIONS)
    : [];
  if (!viName && viInstructions.length === 0) return {};
  return {
    vi: {
      ...(viName ? { name: viName } : {}),
      ...(viInstructions.length ? { instructions: viInstructions } : {}),
    },
  };
}

function validateExerciseFields(body) {
  const stringFields = ['muscleGroup', 'equipment', 'difficulty', 'imageUrl'];
  for (const field of stringFields) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      return `${field} must be a string`;
    }
  }
  if (body.imageUrl !== undefined && !isSafeHttpUrl(body.imageUrl)) {
    return 'Invalid imageUrl: must be an http or https URL';
  }
  if (body.instructions !== undefined) {
    if (
      !Array.isArray(body.instructions) ||
      body.instructions.length > MAX_INSTRUCTIONS ||
      !body.instructions.every((s) => typeof s === 'string')
    ) {
      return `instructions must be an array of at most ${MAX_INSTRUCTIONS} strings`;
    }
  }
  return null;
}

const listExercises = async (req, res) => {
  try {
    const db = getDb();
    const exercises = await db.collection('exercises').find({}).sort({ category: 1, name: 1 }).toArray();
    res.json(exercises.map(mapExercise));
  } catch (error) {
    return safeServerError(res, 'adminExerciseController.listExercises', error);
  }
};

const createExercise = async (req, res) => {
  try {
    const validationErr = validateExerciseFields(req.body || {});
    if (validationErr) {
      return res.status(400).json({ message: validationErr });
    }

    const db = getDb();
    const { name, category, muscleGroup, equipment, difficulty, imageUrl, instructions, translations } = req.body;
    const doc = {
      name: name.trim(),
      category: category.trim(),
      muscleGroup: muscleGroup ? muscleGroup.trim() : category.trim(),
      equipment: equipment ? equipment.trim() : '',
      difficulty: difficulty ? difficulty.trim() : 'Beginner',
      imageUrl: imageUrl ? imageUrl.trim() : '',
      instructions: Array.isArray(instructions)
        ? instructions.map((s) => s.trim()).filter(Boolean)
        : [],
      translations: sanitizeExerciseTranslations(translations),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await db.collection('exercises').insertOne(doc);
    publicDataCache.delByPrefix('exercises:');
    res.status(201).json(mapExercise({ ...doc, _id: insertedId }));
  } catch (error) {
    return safeServerError(res, 'adminExerciseController.createExercise', error);
  }
};

const updateExercise = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid exercise ID' });
    }

    const validationErr = validateExerciseFields(req.body || {});
    if (validationErr) {
      return res.status(400).json({ message: validationErr });
    }

    const db = getDb();
    const allowed = ['name', 'category', 'muscleGroup', 'equipment', 'difficulty', 'imageUrl'];
    const updates = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
      }
    }
    if (req.body.instructions !== undefined) {
      updates.instructions = req.body.instructions.map((s) => s.trim()).filter(Boolean);
    }
    if (req.body.translations !== undefined) {
      updates.translations = sanitizeExerciseTranslations(req.body.translations);
    }

    const result = await db.collection('exercises').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    publicDataCache.delByPrefix('exercises:');
    res.json(mapExercise(result));
  } catch (error) {
    return safeServerError(res, 'adminExerciseController.updateExercise', error);
  }
};

const toggleExerciseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid exercise ID' });
    }

    const db = getDb();
    const result = await db.collection('exercises').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { isActive: Boolean(req.body.isActive), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    publicDataCache.delByPrefix('exercises:');
    res.json(mapExercise(result));
  } catch (error) {
    return safeServerError(res, 'adminExerciseController.toggleExerciseStatus', error);
  }
};

module.exports = { listExercises, createExercise, updateExercise, toggleExerciseStatus };
