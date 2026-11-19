const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { publicDataCache } = require('../utils/memoryCache');
const { safeServerError } = require('../utils/security');

const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

// Get all exercises
const getAllExercises = async (req, res) => {
    try {
        const cacheKey = 'exercises:all';
        const cached = publicDataCache.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
            return res.json(cached);
        }

        const db = getDb();
        const exercises = await db.collection('exercises').find({ isActive: { $ne: false } }).toArray();
        
        const payload = exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        }));
        publicDataCache.set(cacheKey, payload);
        res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
        res.json(payload);
    } catch (error) {
        return safeServerError(res, 'exerciseController.getAllExercises', error);
    }
};

// Get exercises by category
const getExercisesByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        if (typeof category !== 'string' || !category.trim() || category.length > 100) {
            return res.status(400).json({ message: 'Invalid category' });
        }
        
        // Convert category format (e.g., "middle_back" to "Middle Back")
        const formattedCategory = category
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        const cacheKey = `exercises:category:${formattedCategory}`;
        const cached = publicDataCache.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
            return res.json(cached);
        }

        const db = getDb();
        const exercises = await db.collection('exercises')
            .find({ category: formattedCategory, isActive: { $ne: false } })
            .toArray();
        
        const payload = exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        }));
        publicDataCache.set(cacheKey, payload);
        res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
        res.json(payload);
    } catch (error) {
        return safeServerError(res, 'exerciseController.getExercisesByCategory', error);
    }
};

// Escape user input so it is matched literally (prevents regex injection / ReDoS)
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Search exercises by name
const searchExercises = async (req, res) => {
    try {
        const { q } = req.query;
        const db = getDb();

        // Only accept a string query and cap its length to avoid abuse
        if (!q || typeof q !== 'string') {
            return res.status(400).json({ message: 'Search query is required' });
        }

        const trimmed = q.trim();
        if (!trimmed) {
            return res.status(400).json({ message: 'Search query is required' });
        }
        if (trimmed.length > 100) {
            return res.status(400).json({ message: 'Search query is too long' });
        }

        // Match the escaped input literally (case-insensitive)
        const pattern = { $regex: escapeRegex(trimmed), $options: 'i' };
        const exercises = await db.collection('exercises')
            .find({
                isActive: { $ne: false },
                $or: [{ name: pattern }, { 'translations.vi.name': pattern }],
            })
            .toArray();
        
        res.json(exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        })));
    } catch (error) {
        return safeServerError(res, 'exerciseController.searchExercises', error);
    }
};

// Get single exercise by ID
const getExerciseById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid exercise ID' });
        }

        const cacheKey = `exercises:id:${id}`;
        const cached = publicDataCache.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
            return res.json(cached);
        }

        const db = getDb();
        const exercise = await db.collection('exercises')
            .findOne({ _id: new ObjectId(id) });
        
        if (!exercise) {
            return res.status(404).json({ message: 'Exercise not found' });
        }
        
        const payload = {
            ...exercise,
            id: exercise._id,
            _id: undefined
        };
        publicDataCache.set(cacheKey, payload);
        res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
        res.json(payload);
    } catch (error) {
        return safeServerError(res, 'exerciseController.getExerciseById', error);
    }
};

module.exports = {
    getAllExercises,
    getExercisesByCategory,
    searchExercises,
    getExerciseById,
    escapeRegex // exported for unit testing
};
