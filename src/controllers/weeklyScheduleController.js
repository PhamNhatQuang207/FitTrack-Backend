const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

// Helper to get ISO week number
const getWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

// Helper to get Monday of current week
const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(d.setDate(diff));
};

// Start a new weekly schedule from a plan
const startWeeklySchedule = async (req, res) => {
    try {
        const { weeklyPlanId, startDate } = req.body;
        const userId = req.userId;
        const db = getDb();

        // Fetch the weekly plan template
        const plan = await db.collection('weekly-plans').findOne({
            _id: new ObjectId(weeklyPlanId),
            userId: new ObjectId(userId)
        });

        if (!plan) {
            return res.status(404).json({ message: 'Weekly plan not found' });
        }

        // Determine week start (Monday)
        const monday = startDate ? getMonday(new Date(startDate)) : getMonday(new Date());
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);

        const weekNumber = getWeekNumber(monday);
        const year = monday.getFullYear();

        // Check if an ACTIVE schedule already exists for this week
        const existing = await db.collection('weekly-schedules').findOne({
            userId: new ObjectId(userId),
            weekNumber,
            year,
            status: 'active'
        });

        if (existing) {
            return res.status(400).json({ message: 'You already have an active schedule for this week' });
        }

        // Create weekly schedule from plan
        const schedule = {
            userId: new ObjectId(userId),
            weeklyPlanId: new ObjectId(weeklyPlanId),
            weeklyPlanName: plan.name,
            weekNumber,
            year,
            startDate: monday,
            endDate: sunday,
            status: 'active',
            days: plan.days.map((day, index) => {
                const dayDate = new Date(monday);
                dayDate.setDate(dayDate.getDate() + index);
                
                return {
                    dayOfWeek: day.dayOfWeek,
                    dayName: day.dayName,
                    date: dayDate,
                    isRestDay: day.isRestDay,
                    workout: day.isRestDay ? null : {
                        name: day.workout.name,
                        exercises: day.workout.exercises.map(ex => ({
                            ...ex,
                            isCompleted: false,
                            actualSets: []
                        })),
                        isCompleted: false,
                        completedAt: null
                    }
                };
            }),
            completedDays: 0,
            totalWorkoutDays: plan.days.filter(d => !d.isRestDay).length,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('weekly-schedules').insertOne(schedule);

        res.status(201).json({
            message: 'Weekly schedule started successfully',
            scheduleId: result.insertedId
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get all weekly schedules
const getWeeklySchedules = async (req, res) => {
    try {
        const userId = req.userId;
        const { status } = req.query;
        const db = getDb();

        const query = { userId: new ObjectId(userId) };
        if (status) {
            query.status = status;
        }

        const schedules = await db.collection('weekly-schedules')
            .find(query)
            .sort({ startDate: -1 })
            .toArray();

        res.json(schedules.map(schedule => ({
            ...schedule,
            id: schedule._id,
            _id: undefined,
            userId: undefined
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get current week's schedule
const getCurrentWeek = async (req, res) => {
    try {
        const userId = req.userId;
        const db = getDb();

        const monday = getMonday(new Date());
        const weekNumber = getWeekNumber(monday);
        const year = monday.getFullYear();

        const schedule = await db.collection('weekly-schedules').findOne({
            userId: new ObjectId(userId),
            weekNumber,
            year,
            status: 'active'
        });

        if (!schedule) {
            return res.status(404).json({ message: 'No active schedule for current week' });
        }

        res.json({
            ...schedule,
            id: schedule._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get specific weekly schedule
const getWeeklyScheduleById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const schedule = await db.collection('weekly-schedules').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!schedule) {
            return res.status(404).json({ message: 'Weekly schedule not found' });
        }

        res.json({
            ...schedule,
            id: schedule._id,
            _id: undefined,
            userId: undefined
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Complete a day's workout
const completeDayWorkout = async (req, res) => {
    try {
        const { id } = req.params;
        const { dayOfWeek, workoutData } = req.body;
        const userId = req.userId;
        const db = getDb();

        console.log("completeDayWorkout called with:", { id, dayOfWeek, userId });

        const schedule = await db.collection('weekly-schedules').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!schedule) {
            console.log("Schedule not found");
            return res.status(404).json({ message: 'Weekly schedule not found' });
        }

        console.log("Schedule found:", {
            scheduleId: schedule._id,
            days: schedule.days.map(d => ({ dayOfWeek: d.dayOfWeek, dayName: d.dayName, isCompleted: d.workout?.isCompleted }))
        });

        // Update the specific day
        const dayIndex = schedule.days.findIndex(d => d.dayOfWeek === dayOfWeek);
        console.log("Day index found:", dayIndex);
        
        if (dayIndex === -1) {
            console.log("Day not found for dayOfWeek:", dayOfWeek);
            return res.status(404).json({ message: 'Day not found' });
        }

        // Check if this day was already completed
        const wasAlreadyCompleted = schedule.days[dayIndex].workout?.isCompleted;
        console.log("Was already completed:", wasAlreadyCompleted);
        
        const updatePath = `days.${dayIndex}.workout`;
        
        // Only increment if not already completed
        const newCompletedDays = wasAlreadyCompleted 
            ? schedule.completedDays 
            : (schedule.completedDays || 0) + 1;

        console.log("Updating completedDays from", schedule.completedDays, "to", newCompletedDays);

        await db.collection('weekly-schedules').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    [`${updatePath}.isCompleted`]: true,
                    [`${updatePath}.completedAt`]: new Date(),
                    [`${updatePath}.exercises`]: workoutData?.exercises || schedule.days[dayIndex].workout.exercises,
                    completedDays: newCompletedDays,
                    updatedAt: new Date()
                }
            }
        );

        console.log("Update successful");
        res.json({ message: 'Day workout completed successfully', completedDays: newCompletedDays });
    } catch (error) {
        console.error("Error in completeDayWorkout:", error);
        res.status(500).json({ message: error.message });
    }
};

// Complete entire week
const completeWeek = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const db = getDb();

        const result = await db.collection('weekly-schedules').updateOne(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            {
                $set: {
                    status: 'completed',
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'Weekly schedule not found' });
        }

        res.json({ message: 'Week completed successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    startWeeklySchedule,
    getWeeklySchedules,
    getCurrentWeek,
    getWeeklyScheduleById,
    completeDayWorkout,
    completeWeek
};
