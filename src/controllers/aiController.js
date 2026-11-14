const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');
const { validateUserInput } = require('../services/ai/guards/inputGuard');
const { validateAndNormalizeDays } = require('../services/ai/guards/groundingAndSchemaGuard');
const { isGeminiConfigured } = require('../services/ai/geminiClient');
const { runAiChatTurn } = require('../services/ai/aiAgentService');

const MAX_CONTEXT_MESSAGES = 14;
const MAX_STORED_MESSAGES = 100;

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

const getMonday = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const chatWithAi = async (req, res) => {
  try {
    if (!isGeminiConfigured()) {
      return res.status(503).json({
        code: 'AI_UNAVAILABLE',
        message: 'AI Coaching Assistant is unavailable because GEMINI_API_KEY is not configured.'
      });
    }

    const { conversationId, message } = req.body || {};
    const guardResult = validateUserInput(message);
    if (!guardResult.ok) {
      return res.status(400).json({
        code: guardResult.code,
        message: guardResult.message
      });
    }

    const db = getDb();
    const userObjectId = new ObjectId(req.userId);
    let conversation = null;

    if (conversationId) {
      if (!ObjectId.isValid(conversationId)) {
        return res.status(400).json({ message: 'Invalid conversationId format' });
      }
      conversation = await db.collection('ai-conversations').findOne({
        _id: new ObjectId(conversationId),
        userId: userObjectId
      });
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }
    }

    const memories = await db
      .collection('ai-memories')
      .find({ userId: userObjectId })
      .sort({ category: 1, key: 1 })
      .toArray();

    const priorMessages = conversation?.messages
      ? conversation.messages.slice(-MAX_CONTEXT_MESSAGES)
      : [];

    const agentResponse = await runAiChatTurn({
      db,
      userId: userObjectId,
      historyMessages: priorMessages,
      userText: guardResult.sanitizedMessage,
      memories
    });

    const now = new Date();
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: guardResult.sanitizedMessage,
      toolTrace: [],
      draftPlan: null,
      createdAt: now
    };

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: agentResponse.text,
      toolTrace: agentResponse.toolTrace,
      draftPlan: agentResponse.draftPlan || null,
      createdAt: new Date(now.getTime() + 1)
    };

    let activeConversationId = conversation ? conversation._id : null;

    if (!conversation) {
      const title = guardResult.sanitizedMessage.slice(0, 60);
      const insertRes = await db.collection('ai-conversations').insertOne({
        userId: userObjectId,
        title,
        createdAt: now,
        updatedAt: now,
        messages: [userMessage, assistantMessage]
      });
      activeConversationId = insertRes.insertedId;
    } else {
      await db.collection('ai-conversations').updateOne(
        { _id: conversation._id, userId: userObjectId },
        {
          $push: {
            messages: {
              $each: [userMessage, assistantMessage],
              $slice: -MAX_STORED_MESSAGES
            }
          },
          $set: { updatedAt: now }
        }
      );
    }

    return res.status(200).json({
      conversationId: activeConversationId.toString(),
      userMessage,
      assistantMessage,
      memoriesUpdated: agentResponse.memoriesUpdated
    });
  } catch (error) {
    const status = error.statusCode || (error.status === 429 ? 429 : 502);
    return res.status(status).json({
      message: error.message || 'AI Assistant encountered an upstream error.'
    });
  }
};

const getConversations = async (req, res) => {
  try {
    const db = getDb();
    const userObjectId = new ObjectId(req.userId);
    const docs = await db
      .collection('ai-conversations')
      .find({ userId: userObjectId })
      .sort({ updatedAt: -1 })
      .toArray();

    return res.json(
      docs.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid conversation ID' });
    }
    const db = getDb();
    const doc = await db.collection('ai-conversations').findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.userId)
    });
    if (!doc) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    return res.json({
      id: doc._id.toString(),
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      messages: doc.messages || []
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid conversation ID' });
    }
    const db = getDb();
    const result = await db.collection('ai-conversations').deleteOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.userId)
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    return res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMemories = async (req, res) => {
  try {
    const db = getDb();
    const docs = await db
      .collection('ai-memories')
      .find({ userId: new ObjectId(req.userId) })
      .sort({ category: 1, key: 1 })
      .toArray();

    return res.json(
      docs.map((m) => ({
        id: m._id.toString(),
        category: m.category,
        key: m.key,
        value: m.value,
        updatedAt: m.updatedAt
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteMemoryById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid memory ID' });
    }
    const db = getDb();
    const result = await db.collection('ai-memories').deleteOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.userId)
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Memory not found' });
    }
    return res.json({ message: 'Memory deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const applyDraftPlan = async (req, res) => {
  try {
    const { id, messageId } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid conversation ID' });
    }

    const db = getDb();
    const userObjectId = new ObjectId(req.userId);
    const conversation = await db.collection('ai-conversations').findOne({
      _id: new ObjectId(id),
      userId: userObjectId
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const msgIndex = (conversation.messages || []).findIndex((m) => m.id === messageId);
    if (msgIndex === -1) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const targetMessage = conversation.messages[msgIndex];
    if (!targetMessage.draftPlan || !targetMessage.draftPlan.plan) {
      return res.status(400).json({ message: 'No draft plan attached to this message' });
    }

    if (targetMessage.draftPlan.appliedAt) {
      return res.status(409).json({
        message: 'This draft plan has already been applied',
        planId: targetMessage.draftPlan.appliedPlanId,
        scheduleId: targetMessage.draftPlan.appliedScheduleId
      });
    }

    // Re-validate exercises and 7-day structure before writing to DB
    const { mode, targetScheduleId, targetPlanId, plan } = targetMessage.draftPlan;
    const validation = await validateAndNormalizeDays({ db, days: plan.days });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.error });
    }

    const normalizedDays = validation.days;
    const now = new Date();
    const monday = getMonday(now);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const weekNumber = getWeekNumber(monday);
    const year = monday.getFullYear();

    let appliedPlanId = null;
    let appliedScheduleId = null;

    if (mode === 'edit_schedule') {
      const scheduleFilter = { userId: userObjectId, status: 'active' };
      if (targetScheduleId && ObjectId.isValid(targetScheduleId)) {
        scheduleFilter._id = new ObjectId(targetScheduleId);
      }

      const activeSchedule = await db
        .collection('weekly-schedules')
        .findOne(scheduleFilter, { sort: { startDate: -1, createdAt: -1 } });

      if (!activeSchedule) {
        return res.status(404).json({ message: 'Active weekly schedule not found' });
      }

      const baseMonday = activeSchedule.startDate ? getMonday(new Date(activeSchedule.startDate)) : monday;
      const mergedScheduleDays = normalizedDays.map((day, index) => {
        const existingDay = (activeSchedule.days || []).find((d) => d.dayOfWeek === index);
        const dayDate = new Date(baseMonday);
        dayDate.setDate(dayDate.getDate() + index);

        // Preserve already completed day state
        if (existingDay?.workout?.isCompleted && !day.isRestDay) {
          return {
            ...existingDay,
            dayOfWeek: index,
            dayName: day.dayName,
            date: existingDay.date || dayDate
          };
        }

        return {
          dayOfWeek: day.dayOfWeek,
          dayName: day.dayName,
          date: existingDay?.date || dayDate,
          isRestDay: day.isRestDay,
          workout: day.isRestDay
            ? null
            : {
                name: day.workout.name,
                exercises: day.workout.exercises.map((ex) => ({
                  ...ex,
                  isCompleted: false,
                  actualSets: []
                })),
                isCompleted: false,
                completedAt: null
              }
        };
      });

      const totalWorkoutDays = mergedScheduleDays.filter((d) => !d.isRestDay).length;
      const completedDays = mergedScheduleDays.filter((d) => d.workout?.isCompleted).length;

      await db.collection('weekly-schedules').updateOne(
        { _id: activeSchedule._id, userId: userObjectId },
        {
          $set: {
            weeklyPlanName: plan.name || activeSchedule.weeklyPlanName,
            days: mergedScheduleDays,
            totalWorkoutDays,
            completedDays,
            updatedAt: now
          }
        }
      );

      appliedScheduleId = activeSchedule._id.toString();

      const requestedAction = req.body?.action || 'update_schedule_and_plan';
      const linkedPlanId = targetPlanId || activeSchedule.weeklyPlanId?.toString();
      if (
        requestedAction !== 'update_schedule_only' &&
        linkedPlanId &&
        ObjectId.isValid(linkedPlanId)
      ) {
        await db.collection('weekly-plans').updateOne(
          { _id: new ObjectId(linkedPlanId), userId: userObjectId },
          {
            $set: {
              name: plan.name || activeSchedule.weeklyPlanName,
              days: normalizedDays,
              updatedAt: now
            }
          }
        );
        appliedPlanId = linkedPlanId;
      }
    } else if (mode === 'update_plan') {
      if (!targetPlanId || !ObjectId.isValid(targetPlanId)) {
        return res.status(400).json({ message: 'Invalid targetPlanId for update_plan' });
      }
      const updateRes = await db.collection('weekly-plans').updateOne(
        { _id: new ObjectId(targetPlanId), userId: userObjectId },
        {
          $set: {
            name: plan.name,
            description: plan.description || '',
            days: normalizedDays,
            updatedAt: now
          }
        }
      );
      if (updateRes.matchedCount === 0) {
        return res.status(404).json({ message: 'Weekly plan template not found' });
      }
      appliedPlanId = targetPlanId;
    } else {
      // mode === 'create_schedule':
      // - action === 'save_plan': only save template in weekly-plans (do not overwrite current weekly-schedules)
      // - action === 'activate_schedule' (or default): save in weekly-plans AND start/replace active weekly-schedules
      const requestedAction = req.body?.action || 'activate_schedule';
      const planDoc = {
        userId: userObjectId,
        name: plan.name,
        description: plan.description || '',
        days: normalizedDays,
        createdAt: now,
        updatedAt: now
      };
      const planInsert = await db.collection('weekly-plans').insertOne(planDoc);
      appliedPlanId = planInsert.insertedId.toString();

      if (requestedAction !== 'save_plan') {
        // Mark any prior active schedule for this user as completed/superseded so the new schedule becomes the active one
        await db.collection('weekly-schedules').updateMany(
          { userId: userObjectId, status: 'active' },
          { $set: { status: 'completed', updatedAt: now } }
        );

        const scheduleDoc = {
          userId: userObjectId,
          weeklyPlanId: planInsert.insertedId,
          weeklyPlanName: plan.name,
          weekNumber,
          year,
          startDate: monday,
          endDate: sunday,
          status: 'active',
          days: normalizedDays.map((day, index) => {
            const dayDate = new Date(monday);
            dayDate.setDate(dayDate.getDate() + index);
            return {
              dayOfWeek: day.dayOfWeek,
              dayName: day.dayName,
              date: dayDate,
              isRestDay: day.isRestDay,
              workout: day.isRestDay
                ? null
                : {
                    name: day.workout.name,
                    exercises: day.workout.exercises.map((ex) => ({
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
          totalWorkoutDays: normalizedDays.filter((d) => !d.isRestDay).length,
          createdAt: now,
          updatedAt: now
        };

        const scheduleInsert = await db.collection('weekly-schedules').insertOne(scheduleDoc);
        appliedScheduleId = scheduleInsert.insertedId.toString();
      }
    }

    await db.collection('ai-conversations').updateOne(
      { _id: conversation._id, userId: userObjectId },
      {
        $set: {
          [`messages.${msgIndex}.draftPlan.appliedPlanId`]: appliedPlanId,
          [`messages.${msgIndex}.draftPlan.appliedScheduleId`]: appliedScheduleId,
          [`messages.${msgIndex}.draftPlan.appliedAt`]: now,
          updatedAt: now
        }
      }
    );

    return res.status(200).json({
      message:
        mode === 'edit_schedule'
          ? 'Active weekly schedule updated successfully'
          : appliedScheduleId
          ? 'New weekly plan and schedule started successfully'
          : 'Weekly plan saved to library successfully',
      mode,
      planId: appliedPlanId,
      scheduleId: appliedScheduleId
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMcpKeyStatus = async (req, res) => {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.userId) },
      { projection: { mcpApiKeyHash: 1, mcpApiKeyPrefix: 1, mcpApiKeyCreatedAt: 1 } }
    );
    return res.status(200).json({
      hasKey: Boolean(user?.mcpApiKeyHash),
      keyPrefix: user?.mcpApiKeyPrefix || null,
      createdAt: user?.mcpApiKeyCreatedAt || null
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const generateMcpKey = async (req, res) => {
  try {
    const rawKey = 'ftk_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12) + '...';
    const now = new Date();

    const db = getDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      {
        $set: {
          mcpApiKeyHash: hash,
          mcpApiKeyPrefix: keyPrefix,
          mcpApiKeyCreatedAt: now
        }
      }
    );

    return res.status(201).json({
      apiKey: rawKey,
      keyPrefix,
      createdAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const revokeMcpKey = async (req, res) => {
  try {
    const db = getDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      {
        $unset: {
          mcpApiKeyHash: '',
          mcpApiKeyPrefix: '',
          mcpApiKeyCreatedAt: ''
        }
      }
    );

    return res.status(200).json({
      message: 'MCP API key revoked successfully'
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  chatWithAi,
  getConversations,
  getConversationById,
  deleteConversation,
  getMemories,
  deleteMemoryById,
  applyDraftPlan,
  getMcpKeyStatus,
  generateMcpKey,
  revokeMcpKey
};
