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

// Search exercises by name
const searchExercises = async (req, res) => {
    try {
        const { q } = req.query;
        const db = getDb();
        
        if (!q) {
            return res.status(400).json({ message: 'Search query is required' });
        }
        
        // Use text search or regex
        const exercises = await db.collection('exercises')
            .find({
                name: { $regex: q, $options: 'i' }
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
    getExerciseById
};
