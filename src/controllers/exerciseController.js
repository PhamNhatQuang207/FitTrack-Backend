const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Get all exercises
const getAllExercises = async (req, res) => {
    try {
        const db = getDb();
        const exercises = await db.collection('exercises').find({}).toArray();
        
        res.json(exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get exercises by category
const getExercisesByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        const db = getDb();
        
        // Convert category format (e.g., "middle_back" to "Middle Back")
        const formattedCategory = category
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        
        const exercises = await db.collection('exercises')
            .find({ category: formattedCategory })
            .toArray();
        
        res.json(exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
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
        const exercises = await db.collection('exercises')
            .find({
                name: { $regex: escapeRegex(trimmed), $options: 'i' }
            })
            .toArray();
        
        res.json(exercises.map(ex => ({
            ...ex,
            id: ex._id,
            _id: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get single exercise by ID
const getExerciseById = async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();
        
        const exercise = await db.collection('exercises')
            .findOne({ _id: new ObjectId(id) });
        
        if (!exercise) {
            return res.status(404).json({ message: 'Exercise not found' });
        }
        
        res.json({
            ...exercise,
            id: exercise._id,
            _id: undefined
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAllExercises,
    getExercisesByCategory,
    searchExercises,
    getExerciseById,
    escapeRegex // exported for unit testing
};
