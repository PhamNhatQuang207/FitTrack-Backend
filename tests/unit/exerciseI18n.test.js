jest.mock('../../src/config/db', () => ({ getDb: jest.fn() }));
jest.mock('../../src/utils/memoryCache', () => ({
  publicDataCache: { get: jest.fn(), set: jest.fn(), delByPrefix: jest.fn(), del: jest.fn() },
}));

const { ObjectId } = require('mongodb');
const { getDb } = require('../../src/config/db');
const { createExercise, updateExercise } = require('../../src/controllers/adminExerciseController');
const { searchExercises } = require('../../src/controllers/exerciseController');
const {
  DEFAULT_MUSCLE_GROUPS,
  ensureSeeded,
  createMuscleGroup,
  updateMuscleGroup,
} = require('../../src/controllers/muscleGroupController');

describe('Exercise & Muscle Group i18n backend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('DEFAULT_MUSCLE_GROUPS includes default Vietnamese translations for all 14 groups', () => {
    expect(DEFAULT_MUSCLE_GROUPS).toHaveLength(14);
    for (const group of DEFAULT_MUSCLE_GROUPS) {
      expect(group.translations?.vi?.name).toBeTruthy();
    }
  });

  test('ensureSeeded backfills missing translations.vi.name on existing default groups', async () => {
    const countDocuments = jest.fn().mockResolvedValue(14);
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    getDb.mockReturnValue({ collection: () => ({ countDocuments, updateOne }) });

    await ensureSeeded(getDb());

    expect(updateOne).toHaveBeenCalledTimes(14);
    expect(updateOne).toHaveBeenCalledWith(
      {
        slug: 'chest',
        $or: [
          { 'translations.vi.name': { $exists: false } },
          { 'translations.vi.name': '' },
        ],
      },
      { $set: { 'translations.vi.name': 'Ngực' } }
    );
  });

  test('createExercise persists sanitized translations.vi', async () => {
    const insertOne = jest.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' });
    getDb.mockReturnValue({ collection: () => ({ insertOne }) });

    const req = {
      body: {
        name: 'Bench Press',
        category: 'Chest',
        translations: { vi: { name: '  Đẩy ngực ngang  ', instructions: ['  Nằm ngửa  ', ''] } },
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createExercise(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insertedDoc = insertOne.mock.calls[0][0];
    expect(insertedDoc.translations).toEqual({
      vi: { name: 'Đẩy ngực ngang', instructions: ['Nằm ngửa'] },
    });
  });

  test('updateExercise persists sanitized translations.vi when provided', async () => {
    const id = new ObjectId().toString();
    const findOneAndUpdate = jest.fn().mockResolvedValue({
      _id: new ObjectId(id),
      name: 'Bench Press',
      translations: { vi: { name: 'Đẩy ngực' } },
    });
    getDb.mockReturnValue({ collection: () => ({ findOneAndUpdate }) });

    const req = {
      params: { id },
      body: {
        translations: { vi: { name: '  Đẩy ngực  ', instructions: ['   '] } },
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await updateExercise(req, res);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(id) },
      { $set: expect.objectContaining({ translations: { vi: { name: 'Đẩy ngực' } } }) },
      { returnDocument: 'after' }
    );
  });

  test('createMuscleGroup & updateMuscleGroup persist sanitized translations.vi', async () => {
    const countDocuments = jest.fn().mockResolvedValue(14);
    const updateOne = jest.fn().mockResolvedValue({});
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
    getDb.mockReturnValue({
      collection: () => ({ countDocuments, updateOne, findOne, insertOne }),
    });

    const createReq = {
      body: {
        name: 'Neck',
        translations: { vi: { name: '  Cổ  ' } },
      },
    };
    const createRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createMuscleGroup(createReq, createRes);

    expect(createRes.status).toHaveBeenCalledWith(201);
    expect(insertOne.mock.calls[0][0].translations).toEqual({ vi: { name: 'Cổ' } });
    expect(createRes.json.mock.calls[0][0].translations).toEqual({ vi: { name: 'Cổ' } });

    const id = new ObjectId().toString();
    const findOneForUpdate = jest.fn().mockResolvedValue({ _id: new ObjectId(id), name: 'Neck' });
    const findOneAndUpdate = jest.fn().mockResolvedValue({
      _id: new ObjectId(id),
      name: 'Neck',
      slug: 'neck',
      translations: { vi: { name: 'Cơ cổ' } },
    });
    getDb.mockReturnValue({
      collection: () => ({ findOne: findOneForUpdate, findOneAndUpdate }),
    });

    const updateReq = {
      params: { id },
      body: { translations: { vi: { name: '  Cơ cổ  ' } } },
    };
    const updateRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await updateMuscleGroup(updateReq, updateRes);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(id) },
      { $set: expect.objectContaining({ translations: { vi: { name: 'Cơ cổ' } } }) },
      { returnDocument: 'after' }
    );
    expect(updateRes.json.mock.calls[0][0].translations).toEqual({ vi: { name: 'Cơ cổ' } });
  });

  test('searchExercises queries both English name and translations.vi.name', async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const find = jest.fn().mockReturnValue({ toArray });
    getDb.mockReturnValue({ collection: () => ({ find }) });

    const req = { query: { q: 'ngực' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await searchExercises(req, res);

    const queryArg = find.mock.calls[0][0];
    expect(queryArg.$or).toEqual([
      { name: { $regex: 'ngực', $options: 'i' } },
      { 'translations.vi.name': { $regex: 'ngực', $options: 'i' } },
    ]);
  });
});
