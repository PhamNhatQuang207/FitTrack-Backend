const request = require('supertest');
const { ObjectId } = require('mongodb');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('E2E Flow 4: Full Training Lifecycle (Catalog -> Plan -> Schedule -> Session -> Analytics)', () => {
  test('completes end-to-end fitness journey from catalog discovery to analytics calculation and cleanup', async () => {
    const { token } = await createUserAndToken(db);

    // 1. Seed exercises and verify public catalog discovery endpoints
    const benchInsert = await db.collection('exercises').insertOne({
      name: 'Barbell Bench Press',
      category: 'Chest',
      equipment: 'Barbell',
      isActive: true,
    });
    const squatInsert = await db.collection('exercises').insertOne({
      name: 'Barbell Squat',
      category: 'Quadriceps',
      equipment: 'Barbell',
      isActive: true,
    });
    const benchId = benchInsert.insertedId.toString();
    const squatId = squatInsert.insertedId.toString();

    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('OK');

    const cfgRes = await request(app).get('/api/site-config');
    expect(cfgRes.status).toBe(200);

    const mgRes = await request(app).get('/api/muscle-groups');
    expect(mgRes.status).toBe(200);
    expect(mgRes.body).toHaveLength(14);

    const allExRes = await request(app).get('/api/exercises');
    expect(allExRes.status).toBe(200);
    expect(allExRes.body).toHaveLength(2);

    const chestExRes = await request(app).get('/api/exercises/category/chest');
    expect(chestExRes.status).toBe(200);
    expect(chestExRes.body).toHaveLength(1);

    const singleExRes = await request(app).get(`/api/exercises/${benchId}`);
    expect(singleExRes.status).toBe(200);
    expect(singleExRes.body.name).toBe('Barbell Bench Press');

    // 2. Create, read, and update a Weekly Plan template
    const sevenDays = Array.from({ length: 7 }, (_, i) => ({
      isRestDay: i !== 0 && i !== 2,
      workout:
        i === 0
          ? {
              name: 'Push Day',
              exercises: [
                {
                  exerciseId: benchId,
                  exerciseName: 'Barbell Bench Press',
                  category: 'Chest',
                  sets: [{ setNumber: 1, targetReps: 8, targetWeight: 80 }],
                },
              ],
            }
          : i === 2
          ? {
              name: 'Leg Day',
              exercises: [
                {
                  exerciseId: squatId,
                  exerciseName: 'Barbell Squat',
                  category: 'Quadriceps',
                  sets: [{ setNumber: 1, targetReps: 5, targetWeight: 100 }],
                },
              ],
            }
          : null,
    }));

    const planCreateRes = await request(app)
      .post('/api/weekly-plans')
      .set(authHeader(token))
      .send({ name: 'Push/Leg Split', description: 'E2E template', days: sevenDays });
    expect(planCreateRes.status).toBe(201);
    const planId = planCreateRes.body.planId;

    const plansList = await request(app).get('/api/weekly-plans').set(authHeader(token));
    expect(plansList.status).toBe(200);
    expect(plansList.body).toHaveLength(1);

    await request(app)
      .put(`/api/weekly-plans/${planId}`)
      .set(authHeader(token))
      .send({ description: 'Updated E2E template' })
      .expect(200);

    const planDetail = await request(app).get(`/api/weekly-plans/${planId}`).set(authHeader(token));
    expect(planDetail.status).toBe(200);
    expect(planDetail.body.description).toBe('Updated E2E template');

    // 3. Before starting a schedule, /current returns 200 null
    const emptyCurrent = await request(app).get('/api/weekly-schedules/current').set(authHeader(token));
    expect(emptyCurrent.status).toBe(200);
    expect(emptyCurrent.body).toBeNull();

    // Start schedule from plan; second start in same week rejected
    const startSchRes = await request(app)
      .post('/api/weekly-schedules/start')
      .set(authHeader(token))
      .send({ weeklyPlanId: planId });
    expect(startSchRes.status).toBe(201);
    const scheduleId = startSchRes.body.scheduleId;

    const dupSchRes = await request(app)
      .post('/api/weekly-schedules/start')
      .set(authHeader(token))
      .send({ weeklyPlanId: planId });
    expect(dupSchRes.status).toBe(400);
    expect(dupSchRes.body.code).toBe('SCHEDULE_ACTIVE_EXISTS');

    const currentSch = await request(app).get('/api/weekly-schedules/current').set(authHeader(token));
    expect(currentSch.status).toBe(200);
    expect(currentSch.body.id).toBe(scheduleId);

    // 4. Customize active schedule days (updateWorkoutName, swap, toggleRest, assignWorkout)
    const renameRes = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'updateWorkoutName', dayOfWeek: 0, workoutName: 'Heavy Push Day' });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.updatedSchedule.userId).toBeUndefined();
    expect(renameRes.body.updatedSchedule.days[0].workout.name).toBe('Heavy Push Day');

    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'swap', dayOfWeek: 0, targetDayOfWeek: 1 })
      .expect(200);

    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'swap', dayOfWeek: 1, targetDayOfWeek: 0 })
      .expect(200);

    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'toggleRest', dayOfWeek: 4 })
      .expect(200);

    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({
        action: 'assignWorkout',
        dayOfWeek: 4,
        workout: { name: 'Bonus Chest Day', exercises: [] },
      })
      .expect(200);

    // Turn day 4 back to rest day
    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/update-day`)
      .set(authHeader(token))
      .send({ action: 'toggleRest', dayOfWeek: 4 })
      .expect(200);

    // 5. Execute Workout Session linked to schedule day 0 (create, idempotent resume, start, update, log sets, complete)
    const sessionPayload = {
      name: 'Heavy Push Day',
      scheduledDate: '2026-11-10T10:00:00Z',
      weeklyScheduleId: scheduleId,
      dayOfWeek: 0,
      exercises: [
        {
          exerciseId: benchId,
          exerciseName: 'Barbell Bench Press',
          category: 'Chest',
          sets: [
            { setNumber: 1, targetReps: 8, targetWeight: 80 },
            { setNumber: 2, targetReps: 8, targetWeight: 85 },
          ],
        },
      ],
    };

    const sessCreate = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send(sessionPayload);
    expect(sessCreate.status).toBe(201);
    const sessionId = sessCreate.body.sessionId;

    // Resuming same scheduleId + dayOfWeek returns 200 with existing sessionId
    const sessResume = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send(sessionPayload);
    expect(sessResume.status).toBe(200);
    expect(sessResume.body.sessionId).toBe(sessionId);

    await request(app)
      .patch(`/api/workout-sessions/${sessionId}/start`)
      .set(authHeader(token))
      .expect(200);

    await request(app)
      .put(`/api/workout-sessions/${sessionId}`)
      .set(authHeader(token))
      .send({ notes: 'Felt strong on warmups' })
      .expect(200);

    // Log 2 sets for Bench Press: 8*80 = 640, 6*90 = 540 (Total = 1180, Max = 90)
    await request(app)
      .post(`/api/workout-sessions/${sessionId}/log-set`)
      .set(authHeader(token))
      .send({ exerciseId: benchId, setNumber: 1, reps: 8, weight: 80, completed: true })
      .expect(200);

    await request(app)
      .post(`/api/workout-sessions/${sessionId}/log-set`)
      .set(authHeader(token))
      .send({ exerciseId: benchId, setNumber: 2, reps: 6, weight: 90, completed: true })
      .expect(200);

    await request(app)
      .patch(`/api/workout-sessions/${sessionId}/complete`)
      .set(authHeader(token))
      .expect(200);

    const sessionDetail = await request(app)
      .get(`/api/workout-sessions/${sessionId}`)
      .set(authHeader(token));
    expect(sessionDetail.status).toBe(200);
    expect(sessionDetail.body.status).toBe('completed');
    expect(sessionDetail.body.notes).toBe('Felt strong on warmups');
    expect(sessionDetail.body.exercises[0].actualSets).toHaveLength(2);

    // Second completed session later to verify strength progression
    const sess2Create = await request(app)
      .post('/api/workout-sessions')
      .set(authHeader(token))
      .send({
        name: 'Push Session 2',
        scheduledDate: '2026-11-17T10:00:00Z',
        exercises: [
          {
            exerciseId: benchId,
            exerciseName: 'Barbell Bench Press',
            category: 'Chest',
            sets: [{ setNumber: 1, targetReps: 5, targetWeight: 95 }],
          },
        ],
      })
      .expect(201);
    const session2Id = sess2Create.body.sessionId;
    await request(app)
      .post(`/api/workout-sessions/${session2Id}/log-set`)
      .set(authHeader(token))
      .send({ exerciseId: benchId, setNumber: 1, reps: 5, weight: 100 })
      .expect(200);
    await request(app)
      .patch(`/api/workout-sessions/${session2Id}/complete`)
      .set(authHeader(token))
      .expect(200);

    // 6. Complete day on schedule (idempotent count) & reject completing rest day -> complete week
    const completeRestDay = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(token))
      .send({ dayOfWeek: 1 });
    expect(completeRestDay.status).toBe(400);

    const completeDay1 = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(token))
      .send({ dayOfWeek: 0 });
    expect(completeDay1.status).toBe(200);
    expect(completeDay1.body.completedDays).toBe(1);

    const completeDayAgain = await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete-day`)
      .set(authHeader(token))
      .send({ dayOfWeek: 0 });
    expect(completeDayAgain.status).toBe(200);
    expect(completeDayAgain.body.completedDays).toBe(1);

    await request(app)
      .patch(`/api/weekly-schedules/${scheduleId}/complete`)
      .set(authHeader(token))
      .expect(200);

    const scheduleList = await request(app)
      .get('/api/weekly-schedules')
      .query({ status: 'completed' })
      .set(authHeader(token));
    expect(scheduleList.status).toBe(200);
    expect(scheduleList.body).toHaveLength(1);

    // 7. Quick workout logging
    const quickLog = await request(app)
      .post('/api/workouts')
      .set(authHeader(token))
      .send({
        date: '2026-11-18',
        exercises: [
          {
            exerciseName: 'Barbell Squat',
            category: 'Quadriceps',
            sets: [{ setNumber: 1, reps: 5, weight: 120 }],
          },
        ],
      });
    expect(quickLog.status).toBe(201);

    const workoutsList = await request(app).get('/api/workouts').set(authHeader(token));
    expect(workoutsList.status).toBe(200);
    expect(workoutsList.body).toHaveLength(1);

    // 8. Verify all 4 analytics endpoints
    const userExRes = await request(app).get('/api/analytics/user-exercises').set(authHeader(token));
    expect(userExRes.status).toBe(200);
    expect(userExRes.body).toEqual(['Barbell Bench Press']);

    const progRes = await request(app)
      .get('/api/analytics/strength-progression/Barbell Bench Press')
      .set(authHeader(token));
    expect(progRes.status).toBe(200);
    expect(progRes.body).toHaveLength(2);
    expect(progRes.body[0]).toMatchObject({ date: '2026-11-10', weight: 90 });
    expect(progRes.body[1]).toMatchObject({ date: '2026-11-17', weight: 100 });

    const statsRes = await request(app).get('/api/analytics/workout-stats').set(authHeader(token));
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totalCompleted).toBe(2);
    expect(statsRes.body.totalVolume).toBe(1680); // 1180 + (5*100)

    const weeklyProgRes = await request(app).get('/api/analytics/weekly-progress').set(authHeader(token));
    expect(weeklyProgRes.status).toBe(200);
    expect(weeklyProgRes.body).toHaveLength(1);
    expect(weeklyProgRes.body[0]).toMatchObject({ completed: 1, total: 2, rate: 50 });

    // 9. Cleanup sessions & plan
    await request(app).delete(`/api/workout-sessions/${sessionId}`).set(authHeader(token)).expect(200);
    await request(app).delete(`/api/workout-sessions/${session2Id}`).set(authHeader(token)).expect(200);
    await request(app).delete(`/api/weekly-plans/${planId}`).set(authHeader(token)).expect(200);

    expect(await db.collection('workout-sessions').countDocuments()).toBe(0);
    expect(await db.collection('weekly-plans').countDocuments()).toBe(0);
  });
});
