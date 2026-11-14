const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');

const DEFAULT_MUSCLE_GROUPS = [
  { name: 'Chest', order: 1 },
  { name: 'Shoulders', order: 2 },
  { name: 'Biceps', order: 3 },
  { name: 'Triceps', order: 4 },
  { name: 'Lats', order: 5 },
  { name: 'Lower Back', order: 6 },
  { name: 'Traps', order: 7 },
  { name: 'Abdominals', order: 8 },
  { name: 'Quadriceps', order: 9 },
  { name: 'Hamstrings', order: 10 },
  { name: 'Glutes', order: 11 },
  { name: 'Adductor', order: 12 },
  { name: 'Calves', order: 13 },
  { name: 'Forearms', order: 14 },
];

const toSlug = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const mapGroup = (g) => ({
  id: g._id.toString(),
  slug: g.slug,
  name: g.name,
  iconUrl: g.iconUrl || '',
  order: g.order || 0,
  isActive: g.isActive !== false,
});

const ensureSeeded = async (db) => {
  const count = await db.collection('muscle_groups').countDocuments();
  if (count === 0) {
    const docs = DEFAULT_MUSCLE_GROUPS.map((g) => ({
      name: g.name,
      slug: toSlug(g.name),
      iconUrl: '',
      order: g.order,
      isActive: true,
      createdAt: new Date(),
    }));
    await db.collection('muscle_groups').insertMany(docs);
  }
};

const cascadeCategoryRewrite = async (db, fromName, toName) => {
  if (!fromName || !toName || fromName === toName) return;

  await db.collection('exercises').updateMany(
    { category: fromName },
    { $set: { category: toName } }
  );

  const flatFilter = { 'exercises.category': fromName };
  const flatUpdate = { $set: { 'exercises.$[e].category': toName } };
  const flatOptions = { arrayFilters: [{ 'e.category': fromName }] };

  await db.collection('workouts').updateMany(flatFilter, flatUpdate, flatOptions);
  await db.collection('workout-sessions').updateMany(flatFilter, flatUpdate, flatOptions);

  const nestedFilter = { 'days.workout.exercises.category': fromName };
  const nestedUpdate = { $set: { 'days.$[d].workout.exercises.$[e].category': toName } };
  const nestedOptions = {
    arrayFilters: [{ 'd.workout.exercises.category': fromName }, { 'e.category': fromName }],
  };

  await db.collection('weekly-plans').updateMany(nestedFilter, nestedUpdate, nestedOptions);
  await db.collection('weekly-schedules').updateMany(nestedFilter, nestedUpdate, nestedOptions);
};

const getPublicMuscleGroups = async (req, res) => {
  try {
    const db = getDb();
    await ensureSeeded(db);
    const groups = await db
      .collection('muscle_groups')
      .find({ isActive: { $ne: false } })
      .sort({ order: 1, name: 1 })
      .toArray();
    res.json(groups.map(mapGroup));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listAdminMuscleGroups = async (req, res) => {
  try {
    const db = getDb();
    await ensureSeeded(db);
    const groups = await db
      .collection('muscle_groups')
      .find({})
      .sort({ order: 1, name: 1 })
      .toArray();
    res.json(groups.map(mapGroup));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createMuscleGroup = async (req, res) => {
  try {
    const db = getDb();
    await ensureSeeded(db);
    const name = req.body.name.trim();
    const slug = toSlug(name);

    const existing = await db.collection('muscle_groups').findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: 'Muscle group already exists' });
    }

    const doc = {
      name,
      slug,
      iconUrl: req.body.iconUrl ? String(req.body.iconUrl).trim() : '',
      order: typeof req.body.order === 'number' ? req.body.order : 99,
      isActive: true,
      createdAt: new Date(),
    };
    const { insertedId } = await db.collection('muscle_groups').insertOne(doc);
    res.status(201).json(mapGroup({ ...doc, _id: insertedId }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateMuscleGroup = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid muscle group ID' });
    }

    const db = getDb();
    const current = await db.collection('muscle_groups').findOne({ _id: new ObjectId(id) });
    if (!current) {
      return res.status(404).json({ message: 'Muscle group not found' });
    }

    const updates = { updatedAt: new Date() };
    if (req.body.name !== undefined) {
      updates.name = req.body.name.trim();
      updates.slug = toSlug(updates.name);
    }
    if (req.body.iconUrl !== undefined) updates.iconUrl = String(req.body.iconUrl).trim();
    if (req.body.order !== undefined) updates.order = Number(req.body.order);
    if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);

    const updated = await db.collection('muscle_groups').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (updates.name && updates.name !== current.name) {
      await cascadeCategoryRewrite(db, current.name, updates.name);
    }

    res.json(mapGroup(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const mergeMuscleGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetId } = req.body;
    if (!ObjectId.isValid(id) || !ObjectId.isValid(targetId) || id === targetId) {
      return res.status(400).json({ message: 'Valid distinct source and target IDs are required' });
    }

    const db = getDb();
    const source = await db.collection('muscle_groups').findOne({ _id: new ObjectId(id) });
    const target = await db.collection('muscle_groups').findOne({ _id: new ObjectId(targetId) });

    if (!source || !target) {
      return res.status(404).json({ message: 'Source or target muscle group not found' });
    }

    await cascadeCategoryRewrite(db, source.name, target.name);
    await db.collection('muscle_groups').deleteOne({ _id: source._id });

    res.json({
      message: `Merged "${source.name}" into "${target.name}"`,
      target: mapGroup(target),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPublicMuscleGroups,
  listAdminMuscleGroups,
  createMuscleGroup,
  updateMuscleGroup,
  mergeMuscleGroup,
  ensureSeeded,
};
