const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');
const { publicDataCache } = require('../utils/memoryCache');

const mapExercise = (ex) => ({
  ...ex,
  id: ex._id.toString(),
  _id: undefined,
});

const listExercises = async (req, res) => {
  try {
    const db = getDb();
    const exercises = await db.collection('exercises').find({}).sort({ category: 1, name: 1 }).toArray();
    res.json(exercises.map(mapExercise));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createExercise = async (req, res) => {
  try {
    const db = getDb();
    const { name, category, muscleGroup, equipment, difficulty, imageUrl, instructions } = req.body;
    const doc = {
      name: name.trim(),
      category: category.trim(),
      muscleGroup: muscleGroup ? muscleGroup.trim() : category.trim(),
      equipment: equipment ? equipment.trim() : '',
      difficulty: difficulty ? difficulty.trim() : 'Beginner',
      imageUrl: imageUrl ? imageUrl.trim() : '',
      instructions: Array.isArray(instructions) ? instructions : [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await db.collection('exercises').insertOne(doc);
    publicDataCache.delByPrefix('exercises:');
    res.status(201).json(mapExercise({ ...doc, _id: insertedId }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateExercise = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid exercise ID' });
    }

    const db = getDb();
    const allowed = ['name', 'category', 'muscleGroup', 'equipment', 'difficulty', 'imageUrl', 'instructions'];
    const updates = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
      }
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listExercises, createExercise, updateExercise, toggleExerciseStatus };
