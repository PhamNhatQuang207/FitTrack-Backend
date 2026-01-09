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


        const schedule = await db.collection('weekly-schedules').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!schedule) {
            return res.status(404).json({ message: 'Weekly schedule not found' });
        }


        // Update the specific day
        const dayIndex = schedule.days.findIndex(d => d.dayOfWeek === dayOfWeek);
        
        if (dayIndex === -1) {

            return res.status(404).json({ message: 'Day not found' });
        }

        // Check if this day was already completed
        const wasAlreadyCompleted = schedule.days[dayIndex].workout?.isCompleted;
        
        const updatePath = `days.${dayIndex}.workout`;
        
        // Only increment if not already completed
        const newCompletedDays = wasAlreadyCompleted 
            ? schedule.completedDays 
            : (schedule.completedDays || 0) + 1;


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

// Update a day in an active schedule (swap days or toggle rest)
const updateScheduleDay = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, dayOfWeek, targetDayOfWeek, workout } = req.body;
        const userId = req.userId;
        const db = getDb();

        // Validate ObjectId format
        if (!ObjectId.isValid(id)) {
            console.error('Invalid schedule ID:', id);
            return res.status(400).json({ message: 'Invalid schedule ID format' });
        }

        const schedule = await db.collection('weekly-schedules').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId)
        });

        if (!schedule) {
            return res.status(404).json({ message: 'Schedule not found' });
        }

        if (schedule.status !== 'active') {
            return res.status(400).json({ message: 'Can only edit active schedules' });
        }

        const days = [...schedule.days];
        const dayIndex = days.findIndex(d => d.dayOfWeek === dayOfWeek);
        
        if (dayIndex === -1) {
            return res.status(400).json({ message: 'Invalid day of week' });
        }

        if (action === 'swap') {
            const targetIndex = days.findIndex(d => d.dayOfWeek === targetDayOfWeek);
            
            if (targetIndex === -1) {
                return res.status(400).json({ message: 'Invalid target day of week' });
            }

            const tempWorkout = days[dayIndex].workout;
            const tempIsRestDay = days[dayIndex].isRestDay;
            
            days[dayIndex].workout = days[targetIndex].workout;
            days[dayIndex].isRestDay = days[targetIndex].isRestDay;
            
            days[targetIndex].workout = tempWorkout;
            days[targetIndex].isRestDay = tempIsRestDay;

        } else if (action === 'toggleRest') {
            if (days[dayIndex].isRestDay) {
                days[dayIndex].isRestDay = false;
                days[dayIndex].workout = workout || {
                    name: 'Workout',
                    exercises: [],
                    isCompleted: false,
                    completedAt: null
                };
            } else {
                days[dayIndex].isRestDay = true;
                days[dayIndex].workout = null;
            }
        } else if (action === 'assignWorkout') {
            if (!workout) {
                return res.status(400).json({ message: 'Workout data required for assignWorkout action' });
            }
            
            days[dayIndex].isRestDay = false;
            days[dayIndex].workout = {
                name: workout.name,
                exercises: workout.exercises.map(ex => ({
                    ...ex,
                    isCompleted: false,
                    actualSets: []
                })),
                isCompleted: false,
                completedAt: null
            };
        } else if (action === 'updateWorkoutName') {
            const { workoutName } = req.body;
            if (!workoutName) {
                return res.status(400).json({ message: 'Workout name is required' });
            }
            if (days[dayIndex].isRestDay) {
                return res.status(400).json({ message: 'Cannot update name for rest day' });
            }
            days[dayIndex].workout.name = workoutName;
        } else {
            return res.status(400).json({ message: 'Invalid action. Must be swap, toggleRest, assignWorkout, or updateWorkoutName' });
        }

        const totalWorkoutDays = days.filter(d => !d.isRestDay).length;

        await db.collection('weekly-schedules').updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: { 
                    days,
                    totalWorkoutDays,
                    updatedAt: new Date()
                }
            }
        );

        res.json({ 
            message: 'Schedule updated successfully',
            updatedSchedule: { ...schedule, days, totalWorkoutDays }
        });

    } catch (error) {
        console.error('Error updating schedule day:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    startWeeklySchedule,
    getWeeklySchedules,
    getCurrentWeek,
    getWeeklyScheduleById,
    completeDayWorkout,
    completeWeek,
    updateScheduleDay
};
