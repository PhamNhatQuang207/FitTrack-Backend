const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { ObjectId } = require('mongodb');
const { escapeRegex } = require('../controllers/exerciseController');
const {
  validateAndNormalizeDays,
  validateMemoryFact,
  ALLOWED_MEMORY_CATEGORIES,
  MAX_MEMORIES_PER_USER
} = require('../services/ai/guards/groundingAndSchemaGuard');

const setSchema = z.object({
  setNumber: z.number().int().min(1).max(20).optional(),
  targetReps: z.number().min(1).max(100),
  targetWeight: z.number().min(0).max(1000)
});

const dayExerciseSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string().optional(),
  category: z.string().optional(),
  sets: z.array(setSchema).min(1).max(10)
});

const daySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  dayName: z.string().optional(),
  isRestDay: z.boolean(),
  workout: z
    .object({
      name: z.string(),
      exercises: z.array(dayExerciseSchema)
    })
    .nullable()
    .optional()
});

function toMcpJson(payload, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload)
      }
    ]
  };
}

function createFitTrackMcpServer({ db, userId }) {
  if (!db || !userId || !ObjectId.isValid(String(userId))) {
    throw new Error('createFitTrackMcpServer requires valid { db, userId }');
  }
  const userObjectId = new ObjectId(String(userId));

  const server = new McpServer({
    name: 'fittrack-mcp-server',
    version: '1.0.0'
  });

  // 1. get_user_profile
  server.tool(
    'get_user_profile',
    'Read authenticated user body metrics, profile, latest weight and body fat history',
    {},
    async () => {
      const user = await db.collection('users').findOne(
        { _id: userObjectId },
        {
          projection: {
            name: 1,
            age: 1,
            sex: 1,
            height: 1,
            weightHistory: 1,
            bodyFatHistory: 1,
            _id: 0
          }
        }
      );
      if (!user) {
        return toMcpJson({ error: 'User not found' }, true);
      }
      const weightHistory = Array.isArray(user.weightHistory) ? user.weightHistory.slice(-5) : [];
      const bodyFatHistory = Array.isArray(user.bodyFatHistory) ? user.bodyFatHistory.slice(-5) : [];
      return toMcpJson({
        name: user.name || null,
        age: user.age || null,
        sex: user.sex || null,
        height: user.height || null,
        latestWeight: weightHistory[weightHistory.length - 1] || null,
        latestBodyFat: bodyFatHistory[bodyFatHistory.length - 1] || null,
        recentWeightHistory: weightHistory,
        recentBodyFatHistory: bodyFatHistory
      });
    }
  );

  // 2. get_progress_analytics
  server.tool(
    'get_progress_analytics',
    'Summarize completed workout sessions, weekly schedule adherence, total volume, and strength progression',
    {
      weeksBack: z.number().int().min(1).max(12).optional(),
      exerciseName: z.string().max(100).optional()
    },
    async ({ weeksBack = 6, exerciseName } = {}) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - weeksBack * 7);

      const sessionQuery = {
        userId: userObjectId,
        status: 'completed',
        date: { $gte: cutoff }
      };

      const sessions = await db
        .collection('workout-sessions')
        .find(sessionQuery)
        .sort({ date: 1 })
        .toArray();

      let totalVolume = 0;
      const categoryCounts = {};
      const exerciseProgression = [];
      const regex = exerciseName?.trim() ? new RegExp(escapeRegex(exerciseName.trim()), 'i') : null;

      for (const s of sessions) {
        for (const ex of s.exercises || []) {
          if (ex.category) {
            categoryCounts[ex.category] = (categoryCounts[ex.category] || 0) + 1;
          }
          let maxWeight = 0;
          for (const set of ex.actualSets || []) {
            const w = Number(set.weight) || 0;
            const r = Number(set.reps) || 0;
            totalVolume += w * r;
            if (w > maxWeight) maxWeight = w;
          }
          if (regex && regex.test(ex.exerciseName || '')) {
            exerciseProgression.push({
              date: s.date ? new Date(s.date).toISOString().split('T')[0] : null,
              exerciseName: ex.exerciseName,
              maxWeight
            });
          }
        }
      }

      const schedules = await db
        .collection('weekly-schedules')
        .find({ userId: userObjectId })
        .sort({ startDate: -1 })
        .limit(weeksBack)
        .toArray();

      const weeklyAdherence = schedules.map((sch) => ({
        scheduleId: sch._id.toString(),
        weeklyPlanName: sch.weeklyPlanName,
        weekNumber: sch.weekNumber,
        year: sch.year,
        status: sch.status,
        completedDays: sch.completedDays || 0,
        totalWorkoutDays: sch.totalWorkoutDays || 0,
        adherenceRate:
          sch.totalWorkoutDays > 0
            ? Math.round(((sch.completedDays || 0) / sch.totalWorkoutDays) * 100)
            : 0
      }));

      return toMcpJson({
        weeksBack,
        completedSessionsCount: sessions.length,
        totalVolume: Math.round(totalVolume),
        categoryBreakdown: categoryCounts,
        weeklyAdherence,
        exerciseProgression: regex ? exerciseProgression : undefined
      });
    }
  );

  // 3. search_exercises
  server.tool(
    'search_exercises',
    'Search active exercises in FitTrack database by category or name query. Always call this before proposing a plan or schedule edit.',
    {
      category: z.string().max(60).optional(),
      query: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(30).optional()
    },
    async ({ category, query, limit = 15 } = {}) => {
      const filter = { isActive: { $ne: false } };
      if (category && category.trim()) {
        filter.category = { $regex: `^${escapeRegex(category.trim())}$`, $options: 'i' };
      }
      if (query && query.trim()) {
        filter.name = { $regex: escapeRegex(query.trim()), $options: 'i' };
      }

      const exercises = await db
        .collection('exercises')
        .find(filter)
        .limit(limit)
        .toArray();

      return toMcpJson({
        count: exercises.length,
        exercises: exercises.map((ex) => ({
          id: ex._id.toString(),
          name: ex.name,
          category: ex.category,
          equipment: ex.equipment || null,
          difficulty: ex.difficulty || null
        }))
      });
    }
  );

  // 4. get_weekly_plans
  server.tool(
    'get_weekly_plans',
    'Get user saved weekly plan templates and currently active weekly schedule',
    {
      includeActiveSchedule: z.boolean().optional()
    },
    async ({ includeActiveSchedule = true } = {}) => {
      const plans = await db
        .collection('weekly-plans')
        .find({ userId: userObjectId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .toArray();

      let activeSchedule = null;
      if (includeActiveSchedule) {
        activeSchedule = await db.collection('weekly-schedules').findOne(
          { userId: userObjectId, status: 'active' },
          { sort: { startDate: -1, createdAt: -1 } }
        );
      }

      return toMcpJson({
        plans: plans.map((p) => ({
          id: p._id.toString(),
          name: p.name,
          description: p.description || '',
          days: p.days
        })),
        activeSchedule: activeSchedule
          ? {
              id: activeSchedule._id.toString(),
              weeklyPlanId: activeSchedule.weeklyPlanId?.toString() || null,
              weeklyPlanName: activeSchedule.weeklyPlanName,
              weekNumber: activeSchedule.weekNumber,
              year: activeSchedule.year,
              completedDays: activeSchedule.completedDays || 0,
              totalWorkoutDays: activeSchedule.totalWorkoutDays || 0,
              days: activeSchedule.days
            }
          : null
      });
    }
  );

  // 5. propose_weekly_plan
  server.tool(
    'propose_weekly_plan',
    'Build a validated 7-day Draft Weekly Plan & Schedule payload (mode: create_schedule). Requires user confirmation in UI before saving and starting the new schedule.',
    {
      name: z.string().min(1).max(120),
      description: z.string().max(400).optional(),
      days: z.array(daySchema).length(7)
    },
    async ({ name, description = '', days }) => {
      const check = await validateAndNormalizeDays({ db, days });
      if (!check.ok) {
        return toMcpJson({ error: check.error }, true);
      }

      const draftPlan = {
        mode: 'create_schedule',
        targetScheduleId: null,
        targetPlanId: null,
        targetPlanName: null,
        plan: {
          name: name.trim(),
          description: description.trim(),
          days: check.days
        },
        appliedScheduleId: null,
        appliedPlanId: null,
        appliedAt: null
      };

      return toMcpJson({
        status: 'draft_ready_for_confirmation',
        message: 'Draft new weekly schedule prepared. Ask the user to review and click Apply Plan in the chat card.',
        draftPlan
      });
    }
  );

  // 6. edit_weekly_schedule
  server.tool(
    'edit_weekly_schedule',
    'Build a validated 7-day Draft Schedule Update payload (mode: edit_schedule) to modify the user currently active weekly schedule.',
    {
      scheduleId: z.string().optional(),
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(400).optional(),
      days: z.array(daySchema).length(7)
    },
    async ({ scheduleId, name, description = '', days }) => {
      const scheduleFilter = { userId: userObjectId, status: 'active' };
      if (scheduleId) {
        if (!ObjectId.isValid(scheduleId)) {
          return toMcpJson({ error: 'Invalid scheduleId format.' }, true);
        }
        scheduleFilter._id = new ObjectId(scheduleId);
      }

      const activeSchedule = await db
        .collection('weekly-schedules')
        .findOne(scheduleFilter, { sort: { startDate: -1, createdAt: -1 } });

      if (!activeSchedule) {
        return toMcpJson(
          {
            error:
              'No active weekly schedule found for this user. Use propose_weekly_plan to create and start a new weekly schedule instead.'
          },
          true
        );
      }

      const check = await validateAndNormalizeDays({ db, days });
      if (!check.ok) {
        return toMcpJson({ error: check.error }, true);
      }

      const draftPlan = {
        mode: 'edit_schedule',
        targetScheduleId: activeSchedule._id.toString(),
        targetPlanId: activeSchedule.weeklyPlanId ? activeSchedule.weeklyPlanId.toString() : null,
        targetPlanName: activeSchedule.weeklyPlanName || 'Active Weekly Schedule',
        plan: {
          name: (name || activeSchedule.weeklyPlanName || 'Updated Weekly Schedule').trim(),
          description: description.trim(),
          days: check.days
        },
        appliedScheduleId: null,
        appliedPlanId: null,
        appliedAt: null
      };

      return toMcpJson({
        status: 'draft_ready_for_confirmation',
        message:
          'Draft update for active weekly schedule prepared. Ask the user to review and click Apply Schedule Changes in the chat card.',
        draftPlan
      });
    }
  );

  // 7. save_user_memory
  server.tool(
    'save_user_memory',
    'Save or update a concise long-term fitness memory fact about the user (goal, schedule, equipment, injury, preference)',
    {
      category: z.enum(ALLOWED_MEMORY_CATEGORIES),
      key: z.string().min(1).max(60),
      value: z.string().min(1).max(200)
    },
    async ({ category, key, value }) => {
      const check = validateMemoryFact({ category, key, value });
      if (!check.ok) {
        return toMcpJson({ error: check.error }, true);
      }

      const { normalized } = check;
      const existing = await db.collection('ai-memories').findOne({
        userId: userObjectId,
        category: normalized.category,
        key: normalized.key
      });

      if (!existing) {
        const count = await db.collection('ai-memories').countDocuments({ userId: userObjectId });
        if (count >= MAX_MEMORIES_PER_USER) {
          return toMcpJson(
            {
              error: `Memory limit of ${MAX_MEMORIES_PER_USER} facts reached. Delete an outdated memory first.`
            },
            true
          );
        }
      }

      await db.collection('ai-memories').updateOne(
        {
          userId: userObjectId,
          category: normalized.category,
          key: normalized.key
        },
        {
          $set: {
            value: normalized.value,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      );

      return toMcpJson({
        saved: true,
        memory: normalized
      });
    }
  );

  // 8. delete_user_memory
  server.tool(
    'delete_user_memory',
    'Delete an outdated user fitness memory fact by category and key',
    {
      category: z.enum(ALLOWED_MEMORY_CATEGORIES),
      key: z.string().min(1).max(60)
    },
    async ({ category, key }) => {
      const normalizedKey = String(key)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const result = await db.collection('ai-memories').deleteOne({
        userId: userObjectId,
        category,
        key: normalizedKey
      });

      return toMcpJson({
        deleted: result.deletedCount > 0,
        category,
        key: normalizedKey
      });
    }
  );

  return server;
}

module.exports = {
  createFitTrackMcpServer
};
