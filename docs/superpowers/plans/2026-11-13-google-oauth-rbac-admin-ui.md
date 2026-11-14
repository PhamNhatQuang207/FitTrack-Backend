# Google OAuth, Isolated Admin Auth, Dynamic Muscle Groups & Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth sign-in for app users, a completely isolated Admin authentication flow (`POST /api/admin/login`), dynamic Muscle Groups management (including automatic 5-collection cascade rename & merge), Admin Exercise CRUD + Site Config APIs, and a backend-hosted Admin UI at `/admin`.

**Architecture:**
- **Isolated Admin Auth:** Instead of mixing roles into the `users` collection, Admin authentication uses dedicated credentials (`ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`) via `POST /api/admin/login`, issuing a token with `{ isAdmin: true }`. `adminMiddleware` only accepts `{ isAdmin: true }` tokens, while `authMiddleware` requires `decoded.userId`, keeping app users and admin completely separate.
- **Google OAuth:** `POST /api/auth/google` verifies Google ID tokens via `google-auth-library`, performs case-insensitive email matching against `users`, prevents unverified account hijacking, and guards `login` / `requestPasswordReset` when `user.password` is absent.
- **Dynamic Muscle Groups & Cascade Migration:** Store muscle groups in `muscle_groups` (auto-seeded with the 14 default groups if empty). Renaming or merging a muscle group via `/api/admin/muscle-groups` automatically updates denormalized `category` strings across all 5 collections (`exercises`, `workouts`, `workout-sessions`, `weekly-plans`, `weekly-schedules`).
- **Backend-Hosted Admin UI:** Serve a static SPA (`src/public/admin/index.html`, `styles.css`, `app.js`) at `/admin` with zero inline scripts (preserving Helmet CSP) and 3 tabs: Exercises, Muscle Groups, and Site Content.

**Tech Stack:** Node.js, Express 5, MongoDB native driver (`mongodb`), `jsonwebtoken`, `bcryptjs`, `google-auth-library`, `express-validator`, `helmet`, Jest + Supertest + `mongodb-memory-server`.

## Global Constraints
- Follow CommonJS (`require` / `module.exports`) conventions in `server/`.
- Keep `users` collection strictly for app users; never grant admin access via `users`.
- Preserve historical workout integrity: `getExerciseById` (`GET /api/exercises/:id`) must still return soft-deleted exercises (`isActive: false`), while list/category/search endpoints filter `{ isActive: { $ne: false } }`.
- Whenever a muscle group is renamed or merged, cascade the `category` change across `exercises`, `workouts`, `workout-sessions`, `weekly-plans`, and `weekly-schedules`.
- Run all tests in-band with `npm test` (`jest --runInBand`).

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `tests/setup/env.js` | Set deterministic `ADMIN_USERNAME` and `ADMIN_PASSWORD` for tests |
| Modify | `src/middleware/authMiddleware.js` | Reject tokens that do not carry `decoded.userId` |
| Create | `src/middleware/adminMiddleware.js` | Verify Bearer JWT carries `decoded.isAdmin === true` |
| Create | `src/controllers/adminAuthController.js` | Handle `POST /api/admin/login` against `ADMIN_USERNAME` & `ADMIN_PASSWORD` |
| Create | `src/utils/verifyGoogleToken.js` | Thin wrapper around `google-auth-library` `OAuth2Client.verifyIdToken` |
| Modify | `src/controllers/authController.js` | Add `googleLogin` (case-insensitive email lookup, squatter cleanup) and `!user.password` guards |
| Modify | `src/routes/authRoutes.js` | Add `POST /api/auth/google` route |
| Create | `src/controllers/muscleGroupController.js` | Auto-seed 14 default muscle groups, public list, admin CRUD, 5-collection rename & merge |
| Modify | `src/controllers/exerciseController.js` | Filter `{ isActive: { $ne: false } }` on list, category, and search endpoints |
| Create | `src/controllers/adminExerciseController.js` | Admin CRUD & soft-delete toggle for exercises |
| Create | `src/controllers/siteConfigController.js` | Public `GET /api/site-config` and admin `PUT /api/admin/site-config` |
| Create | `src/routes/adminRoutes.js` | Mount `/api/admin/login` (public) and protected `/api/admin/*` routes |
| Modify | `src/app.js` | Mount `/api/muscle-groups`, `/api/site-config`, `/api/admin`, static `/admin`, and Helmet `imgSrc` |
| Create | `src/public/admin/index.html` | Admin UI markup (Login + Exercises + Muscle Groups + Site Content) |
| Create | `src/public/admin/styles.css` | Admin UI styles |
| Create | `src/public/admin/app.js` | Admin UI client logic |
| Create | `tests/unit/adminMiddleware.test.js` | Unit tests for isolated `adminMiddleware` and `authMiddleware` separation |
| Create | `tests/integration/googleAuth.test.js` | Integration tests for `POST /api/auth/google` and passwordless guards |
| Create | `tests/integration/muscleGroups.test.js` | Integration tests for muscle groups seeding, CRUD, rename cascade, and merge cascade |
| Create | `tests/integration/adminExercises.test.js` | Integration tests for `/api/admin/exercises` and soft-delete behavior |
| Create | `tests/integration/siteConfig.test.js` | Integration tests for `/api/site-config` and `/api/admin/site-config` |
| Create | `tests/integration/adminUi.test.js` | Smoke tests for `/admin` static UI |

---

### Task 1: Isolated Admin Authentication (`POST /api/admin/login` & `adminMiddleware`)

**Files:**
- Modify: `tests/setup/env.js`
- Modify: `src/middleware/authMiddleware.js`
- Create: `src/middleware/adminMiddleware.js`
- Create: `src/controllers/adminAuthController.js`
- Test: `tests/unit/adminMiddleware.test.js`

**Interfaces:**
- Consumes: `process.env.ADMIN_USERNAME`, `process.env.ADMIN_PASSWORD`, `process.env.JWT_SECRET`
- Produces:
  - `adminLogin(req, res)` -> `200 { message: 'Admin login successful', token, username }`
  - `adminMiddleware(req, res, next)` -> verifies `decoded.isAdmin === true`, sets `req.admin = { username: decoded.username }`

- [ ] **Step 1: Add test admin env vars and write failing unit test**

Append to `tests/setup/env.js`:
```javascript
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
```

Create `tests/unit/adminMiddleware.test.js`:
```javascript
const jwt = require('jsonwebtoken');
const adminMiddleware = require('../../src/middleware/adminMiddleware');
const authMiddleware = require('../../src/middleware/authMiddleware');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Admin & User token isolation (unit)', () => {
  test('adminMiddleware rejects missing Authorization header with 401', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('adminMiddleware rejects a normal user token ({ userId }) with 403', () => {
    const userToken = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${userToken}` } };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('adminMiddleware accepts a valid admin token ({ isAdmin: true })', () => {
    const adminToken = jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toEqual({ username: 'admin' });
  });

  test('authMiddleware rejects an admin token that has no userId', () => {
    const adminToken = jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/adminMiddleware.test.js`
Expected: FAIL with `Cannot find module '../../src/middleware/adminMiddleware'`

- [ ] **Step 3: Implement `adminMiddleware.js`, `adminAuthController.js`, and tighten `authMiddleware.js`**

Update `src/middleware/authMiddleware.js` (ensure `decoded.userId` is present):
```javascript
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded || !decoded.userId) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

module.exports = authMiddleware;
```

Create `src/middleware/adminMiddleware.js`:
```javascript
const jwt = require('jsonwebtoken');
require('dotenv').config();

const adminMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded || decoded.isAdmin !== true) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        req.admin = { username: decoded.username };
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

module.exports = adminMiddleware;
```

Create `src/controllers/adminAuthController.js`:
```javascript
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const safeEqual = (a, b) => {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};

const adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const expectedUser = process.env.ADMIN_USERNAME;
        const expectedPass = process.env.ADMIN_PASSWORD;

        if (!expectedUser || !expectedPass) {
            return res.status(503).json({ message: 'Admin credentials are not configured on server' });
        }

        const userOk = safeEqual(username, expectedUser);
        const passOk = safeEqual(password, expectedPass);

        if (!userOk || !passOk) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        const token = jwt.sign(
            { isAdmin: true, username: expectedUser },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            message: 'Admin login successful',
            token,
            username: expectedUser,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { adminLogin };
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx jest tests/unit/adminMiddleware.test.js tests/unit/authMiddleware.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/setup/env.js src/middleware/authMiddleware.js src/middleware/adminMiddleware.js src/controllers/adminAuthController.js tests/unit/adminMiddleware.test.js
git commit -m "feat: add isolated admin authentication and adminMiddleware"
```

---

### Task 2: Google OAuth (`POST /api/auth/google`) & Passwordless Account Guards

**Files:**
- Modify: `package.json` (install `google-auth-library`)
- Create: `src/utils/verifyGoogleToken.js`
- Modify: `src/controllers/authController.js`
- Modify: `src/routes/authRoutes.js`
- Test: `tests/integration/googleAuth.test.js`

**Interfaces:**
- Consumes: `process.env.GOOGLE_CLIENT_ID`, `req.body.idToken`
- Produces:
  - `verifyGoogleToken(idToken)` -> `{ sub, email, name, email_verified }`
  - `POST /api/auth/google` -> `200 { message, token, userId, name }`

- [ ] **Step 1: Install `google-auth-library`**

Run: `npm install google-auth-library`

- [ ] **Step 2: Write the failing integration tests**

Create `tests/integration/googleAuth.test.js`:
```javascript
const request = require('supertest');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

jest.mock('../../src/utils/verifyGoogleToken', () => jest.fn());
const verifyGoogleToken = require('../../src/utils/verifyGoogleToken');

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
  jest.clearAllMocks();
});

describe('POST /api/auth/google', () => {
  test('returns 400 when idToken is missing', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });

  test('returns 401 when Google token verification fails', async () => {
    verifyGoogleToken.mockRejectedValue(new Error('Invalid token'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 'bad-token' });
    expect(res.status).toBe(401);
  });

  test('creates a new verified user and returns JWT', async () => {
    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-123',
      email: 'newgoogle@example.com',
      name: 'Google User',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.name).toBe('Google User');

    const saved = await db.collection('users').findOne({ email: 'newgoogle@example.com' });
    expect(saved.isVerified).toBe(true);
    expect(saved.googleId).toBe('google-sub-123');
    expect(saved.password).toBeUndefined();
  });

  test('matches existing verified user case-insensitively without creating duplicate', async () => {
    await db.collection('users').insertOne({
      email: 'Quang@Example.com',
      name: 'Quang',
      password: 'hashed-password',
      isVerified: true,
    });

    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-777',
      email: 'quang@example.com',
      name: 'Quang Google',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
    expect(res.status).toBe(200);

    const count = await db.collection('users').countDocuments();
    expect(count).toBe(1);
    const user = await db.collection('users').findOne({ email: 'Quang@Example.com' });
    expect(user.googleId).toBe('google-sub-777');
  });

  test('clears unverified password and verificationToken when claiming unverified account via Google', async () => {
    await db.collection('users').insertOne({
      email: 'squatter@example.com',
      name: 'Squatter',
      password: 'hashed-squatter-password',
      isVerified: false,
      verificationToken: 'abc',
      verificationTokenExpiry: new Date(Date.now() + 10000),
    });

    verifyGoogleToken.mockResolvedValue({
      sub: 'google-sub-999',
      email: 'squatter@example.com',
      name: 'Real Owner',
      email_verified: true,
    });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
    expect(res.status).toBe(200);

    const updated = await db.collection('users').findOne({ email: 'squatter@example.com' });
    expect(updated.isVerified).toBe(true);
    expect(updated.googleId).toBe('google-sub-999');
    expect(updated.password).toBeUndefined();
    expect(updated.verificationToken).toBeUndefined();
  });

  test('password login returns 400 without crashing for Google-only user', async () => {
    await db.collection('users').insertOne({
      email: 'onlygoogle@example.com',
      name: 'Google Only',
      googleId: 'g-1',
      authProvider: 'google',
      isVerified: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'onlygoogle@example.com', password: 'any-password' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid credentials');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/integration/googleAuth.test.js`
Expected: FAIL with `Cannot find module '../../src/utils/verifyGoogleToken'`

- [ ] **Step 4: Implement `verifyGoogleToken.js`, `googleLogin`, and passwordless guards**

Create `src/utils/verifyGoogleToken.js`:
```javascript
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const verifyGoogleToken = async (idToken) => {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
};

module.exports = verifyGoogleToken;
```

Modify `src/controllers/authController.js`:
1. Require `verifyGoogleToken`:
```javascript
const verifyGoogleToken = require('../utils/verifyGoogleToken');
const escapeEmailRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```
2. In `login` (right before `const isMatch = await bcrypt.compare(password, user.password);`):
```javascript
        if (!user.password) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
```
3. In `requestPasswordReset` (right after `if (!user)`):
```javascript
        if (!user.password) {
            return res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
        }
```
4. Add `googleLogin` and export it in `module.exports`:
```javascript
const googleLogin = async (req, res) => {
    try {
        const { idToken } = req.body;
        let payload;
        try {
            payload = await verifyGoogleToken(idToken);
        } catch {
            return res.status(401).json({ message: 'Invalid Google token' });
        }

        if (!payload || !payload.email || !payload.email_verified) {
            return res.status(401).json({ message: 'Google account email is not verified' });
        }

        const email = payload.email.trim().toLowerCase();
        const name = payload.name || email.split('@')[0];
        const googleId = payload.sub;
        const db = getDb();

        let user = await db.collection('users').findOne({
            email: { $regex: `^${escapeEmailRegex(email)}$`, $options: 'i' }
        });

        if (!user) {
            const newUser = {
                email,
                name,
                googleId,
                authProvider: 'google',
                isVerified: true,
                createdAt: new Date()
            };
            const { insertedId } = await db.collection('users').insertOne(newUser);
            user = { ...newUser, _id: insertedId };
        } else if (!user.isVerified) {
            await db.collection('users').updateOne(
                { _id: user._id },
                {
                    $set: { isVerified: true, googleId, name: user.name || name },
                    $unset: { password: '', verificationToken: '', verificationTokenExpiry: '' }
                }
            );
        } else if (!user.googleId) {
            await db.collection('users').updateOne(
                { _id: user._id },
                { $set: { googleId } }
            );
        }

        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            userId: user._id,
            name: user.name
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
```

Modify `src/routes/authRoutes.js`:
- Import `googleLogin` from `../controllers/authController`.
- Add route:
```javascript
router.post('/google',
    authLimiter,
    [check('idToken', 'Google ID token is required').isString().notEmpty()],
    validate,
    googleLogin
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/integration/googleAuth.test.js tests/integration/auth.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/verifyGoogleToken.js src/controllers/authController.js src/routes/authRoutes.js tests/integration/googleAuth.test.js
git commit -m "feat: add Google OAuth login endpoint and passwordless account guards"
```

---

### Task 3: Dynamic Muscle Groups API (Auto-Seed, CRUD, 5-Collection Rename & Merge)

**Files:**
- Create: `src/controllers/muscleGroupController.js`
- Create: `src/routes/adminRoutes.js`
- Modify: `src/app.js`
- Test: `tests/integration/muscleGroups.test.js`

**Interfaces:**
- Produces:
  - `GET /api/muscle-groups` (public, auto-seeds 14 default groups if collection is empty, returns active groups)
  - `GET /api/admin/muscle-groups` (admin, returns all groups)
  - `POST /api/admin/muscle-groups` (admin, creates new muscle group)
  - `PUT /api/admin/muscle-groups/:id` (admin, updates group; if `name` changes, cascades category rename across `exercises`, `workouts`, `workout-sessions`, `weekly-plans`, `weekly-schedules`)
  - `POST /api/admin/muscle-groups/:id/merge` (admin, `{ targetId }`, cascades category rewrite from source name to target name across all 5 collections and deletes source group)

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/muscleGroups.test.js`:
```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

let db;
const adminAuth = () => ({
  Authorization: `Bearer ${jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET)}`,
});

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('Muscle Groups API & Cascade Rename/Merge', () => {
  test('GET /api/muscle-groups auto-seeds the 14 default muscle groups when empty', async () => {
    const res = await request(app).get('/api/muscle-groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(14);
    expect(res.body.map((g) => g.name)).toEqual(
      expect.arrayContaining(['Chest', 'Shoulders', 'Lats', 'Lower Back', 'Traps', 'Quadriceps'])
    );
  });

  test('renaming a muscle group cascades across all 5 collections', async () => {
    await request(app).get('/api/muscle-groups');
    const traps = await db.collection('muscle_groups').findOne({ name: 'Traps' });

    await db.collection('exercises').insertOne({ name: 'Barbell Shrug', category: 'Traps' });
    await db.collection('workouts').insertOne({ exercises: [{ exerciseName: 'Barbell Shrug', category: 'Traps' }] });
    await db.collection('workout-sessions').insertOne({ exercises: [{ exerciseName: 'Barbell Shrug', category: 'Traps' }] });
    await db.collection('weekly-plans').insertOne({ days: [{ workout: { exercises: [{ category: 'Traps' }] } }] });
    await db.collection('weekly-schedules').insertOne({ days: [{ workout: { exercises: [{ category: 'Traps' }] } }] });

    const res = await request(app)
      .put(`/api/admin/muscle-groups/${traps._id}`)
      .set(adminAuth())
      .send({ name: 'Upper Traps' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Upper Traps');
    expect(res.body.slug).toBe('upper_traps');

    expect(await db.collection('exercises').countDocuments({ category: 'Upper Traps' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('workout-sessions').countDocuments({ 'exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('weekly-plans').countDocuments({ 'days.workout.exercises.category': 'Upper Traps' })).toBe(1);
    expect(await db.collection('weekly-schedules').countDocuments({ 'days.workout.exercises.category': 'Upper Traps' })).toBe(1);
  });

  test('merging source muscle group into target updates all 5 collections and removes source', async () => {
    await request(app).get('/api/muscle-groups');
    const source = await db.collection('muscle_groups').findOne({ name: 'Lower Back' });
    const target = await db.collection('muscle_groups').findOne({ name: 'Lats' });

    await db.collection('exercises').insertOne({ name: 'Back Extension', category: 'Lower Back' });
    await db.collection('workouts').insertOne({ exercises: [{ exerciseName: 'Back Extension', category: 'Lower Back' }] });

    const res = await request(app)
      .post(`/api/admin/muscle-groups/${source._id}/merge`)
      .set(adminAuth())
      .send({ targetId: target._id.toString() });

    expect(res.status).toBe(200);
    expect(await db.collection('muscle_groups').findOne({ _id: source._id })).toBeNull();
    expect(await db.collection('exercises').countDocuments({ category: 'Lats' })).toBe(1);
    expect(await db.collection('workouts').countDocuments({ 'exercises.category': 'Lats' })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/muscleGroups.test.js`
Expected: FAIL with 404

- [ ] **Step 3: Implement `muscleGroupController.js`, `adminRoutes.js`, and mount in `app.js`**

Create `src/controllers/muscleGroupController.js`:
```javascript
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
```

Create `src/routes/adminRoutes.js`:
```javascript
const express = require('express');
const { check } = require('express-validator');
const adminMiddleware = require('../middleware/adminMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const { adminLogin } = require('../controllers/adminAuthController');
const {
  listAdminMuscleGroups,
  createMuscleGroup,
  updateMuscleGroup,
  mergeMuscleGroup,
} = require('../controllers/muscleGroupController');

const router = express.Router();

// Public admin login endpoint
router.post(
  '/login',
  authLimiter,
  [
    check('username', 'Username is required').isString().notEmpty(),
    check('password', 'Password is required').isString().notEmpty(),
  ],
  validate,
  adminLogin
);

// Protected admin endpoints below
router.use(adminMiddleware);

router.get('/muscle-groups', listAdminMuscleGroups);
router.post(
  '/muscle-groups',
  [check('name', 'Name is required').isString().trim().notEmpty()],
  validate,
  createMuscleGroup
);
router.put(
  '/muscle-groups/:id',
  [check('name').optional().isString().trim().notEmpty()],
  validate,
  updateMuscleGroup
);
router.post(
  '/muscle-groups/:id/merge',
  [check('targetId', 'targetId is required').isString().notEmpty()],
  validate,
  mergeMuscleGroup
);

module.exports = router;
```

In `src/app.js`, mount `/api/muscle-groups` and `/api/admin`:
```javascript
const { getPublicMuscleGroups } = require('./controllers/muscleGroupController');
const adminRoutes = require('./routes/adminRoutes');
// ...
app.get('/api/muscle-groups', getPublicMuscleGroups);
app.use('/api/admin', adminRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/integration/muscleGroups.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/muscleGroupController.js src/routes/adminRoutes.js src/app.js tests/integration/muscleGroups.test.js
git commit -m "feat: add dynamic muscle groups API with 5-collection cascade rename and merge"
```

---

### Task 4: Admin Exercise CRUD API (`/api/admin/exercises`) & Soft-Delete

**Files:**
- Modify: `src/controllers/exerciseController.js:8,33,70` (keep `getExerciseById` unfiltered so historical workouts never 404)
- Create: `src/controllers/adminExerciseController.js`
- Modify: `src/routes/adminRoutes.js`
- Test: `tests/integration/adminExercises.test.js`

**Interfaces:**
- Produces:
  - `GET /api/admin/exercises`
  - `POST /api/admin/exercises`
  - `PUT /api/admin/exercises/:id`
  - `PATCH /api/admin/exercises/:id/status`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/adminExercises.test.js`:
```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');

let db;
const adminAuth = () => ({
  Authorization: `Bearer ${jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET)}`,
});

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('Admin Exercises API', () => {
  test('admin can create, update, soft-delete, and still fetch by ID for history', async () => {
    const createRes = await request(app)
      .post('/api/admin/exercises')
      .set(adminAuth())
      .send({
        name: 'Incline Cable Fly',
        category: 'Chest',
        muscleGroup: 'Chest',
        equipment: 'Cable',
        difficulty: 'Intermediate',
        imageUrl: 'https://example.com/fly.png',
        instructions: ['Set bench to 30 degrees', 'Bring handles together'],
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id;

    const updateRes = await request(app)
      .put(`/api/admin/exercises/${id}`)
      .set(adminAuth())
      .send({ name: 'Incline Cable Fly V2', category: 'Chest' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Incline Cable Fly V2');

    const hideRes = await request(app)
      .patch(`/api/admin/exercises/${id}/status`)
      .set(adminAuth())
      .send({ isActive: false });
    expect(hideRes.status).toBe(200);
    expect(hideRes.body.isActive).toBe(false);

    // Public list excludes soft-deleted
    const publicList = await request(app).get('/api/exercises');
    expect(publicList.body.find((e) => e.id === id)).toBeUndefined();

    // Public getExerciseById still works for historical workouts
    const byId = await request(app).get(`/api/exercises/${id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.name).toBe('Incline Cable Fly V2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/adminExercises.test.js`
Expected: FAIL with 404

- [ ] **Step 3: Update `exerciseController.js`, create `adminExerciseController.js`, and wire into `adminRoutes.js`**

Modify `src/controllers/exerciseController.js`:
- In `getAllExercises`: `.find({ isActive: { $ne: false } })`
- In `getExercisesByCategory`: `.find({ category: formattedCategory, isActive: { $ne: false } })`
- In `searchExercises`: `.find({ name: { $regex: escapeRegex(trimmed), $options: 'i' }, isActive: { $ne: false } })`
- Leave `getExerciseById` as `.findOne({ _id: new ObjectId(id) })`.

Create `src/controllers/adminExerciseController.js`:
```javascript
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/db');

const mapExercise = (ex) => ({
  ...ex,
  id: ex._id.toString(),
  _id: undefined,
});

const listExercises = async (req, res) => {
  try {
    const db = getDb();
    const exercises = await db.collection('exercises').find({}).sort({ category: 1, name: 1 }).toArray();
    res.json(exercises.map(mapExercise));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createExercise = async (req, res) => {
  try {
    const db = getDb();
    const { name, category, muscleGroup, equipment, difficulty, imageUrl, instructions } = req.body;
    const doc = {
      name: name.trim(),
      category: category.trim(),
      muscleGroup: muscleGroup ? muscleGroup.trim() : category.trim(),
      equipment: equipment ? equipment.trim() : '',
      difficulty: difficulty ? difficulty.trim() : 'Beginner',
      imageUrl: imageUrl ? imageUrl.trim() : '',
      instructions: Array.isArray(instructions) ? instructions : [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await db.collection('exercises').insertOne(doc);
    res.status(201).json(mapExercise({ ...doc, _id: insertedId }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateExercise = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid exercise ID' });
    }

    const db = getDb();
    const allowed = ['name', 'category', 'muscleGroup', 'equipment', 'difficulty', 'imageUrl', 'instructions'];
    const updates = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
      }
    }

    const result = await db.collection('exercises').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    res.json(mapExercise(result));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const toggleExerciseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid exercise ID' });
    }

    const db = getDb();
    const result = await db.collection('exercises').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { isActive: Boolean(req.body.isActive), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    res.json(mapExercise(result));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { listExercises, createExercise, updateExercise, toggleExerciseStatus };
```

Mount in `src/routes/adminRoutes.js`:
```javascript
const {
  listExercises,
  createExercise,
  updateExercise,
  toggleExerciseStatus,
} = require('../controllers/adminExerciseController');

router.get('/exercises', listExercises);
router.post(
  '/exercises',
  [
    check('name', 'Name is required').isString().trim().notEmpty(),
    check('category', 'Category is required').isString().trim().notEmpty(),
  ],
  validate,
  createExercise
);
router.put(
  '/exercises/:id',
  [
    check('name').optional().isString().trim().notEmpty(),
    check('category').optional().isString().trim().notEmpty(),
  ],
  validate,
  updateExercise
);
router.patch(
  '/exercises/:id/status',
  [check('isActive', 'isActive boolean is required').isBoolean()],
  validate,
  toggleExerciseStatus
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/integration/adminExercises.test.js tests/integration/exercises.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/exerciseController.js src/controllers/adminExerciseController.js src/routes/adminRoutes.js tests/integration/adminExercises.test.js
git commit -m "feat: add admin exercise CRUD endpoints with soft delete"
```

---

### Task 5: Site Config / Background Content API (`/api/site-config` & `/api/admin/site-config`)

**Files:**
- Create: `src/controllers/siteConfigController.js`
- Modify: `src/routes/adminRoutes.js`
- Modify: `src/app.js`
- Test: `tests/integration/siteConfig.test.js`

**Interfaces:**
- Produces:
  - `GET /api/site-config` (public) -> `200 { heroBackgroundUrl, announcementBanner, featuredNote, updatedAt }`
  - `PUT /api/admin/site-config` (admin) -> `200` updated config

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/siteConfig.test.js`:
```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { createUserAndToken, authHeader } = require('../setup/helpers');

let db;
const adminAuth = () => ({
  Authorization: `Bearer ${jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET)}`,
});

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
});

describe('Site Config API', () => {
  test('GET /api/site-config returns defaults when no config is stored', async () => {
    const res = await request(app).get('/api/site-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      heroBackgroundUrl: '',
      announcementBanner: '',
      featuredNote: '',
      updatedAt: null,
    });
  });

  test('PUT /api/admin/site-config rejects normal user token and allows admin token', async () => {
    const { token: userToken } = await createUserAndToken(db);
    const forbidden = await request(app)
      .put('/api/admin/site-config')
      .set(authHeader(userToken))
      .send({ heroBackgroundUrl: 'https://example.com/bg.jpg' });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .put('/api/admin/site-config')
      .set(adminAuth())
      .send({
        heroBackgroundUrl: 'https://example.com/bg.jpg',
        announcementBanner: 'New workout library live!',
        featuredNote: 'Stay consistent',
      });
    expect(ok.status).toBe(200);
    expect(ok.body.heroBackgroundUrl).toBe('https://example.com/bg.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/siteConfig.test.js`
Expected: FAIL with 404

- [ ] **Step 3: Implement `siteConfigController.js` and mount routes**

Create `src/controllers/siteConfigController.js`:
```javascript
const { getDb } = require('../config/db');

const DEFAULT_CONFIG = {
  heroBackgroundUrl: '',
  announcementBanner: '',
  featuredNote: '',
  updatedAt: null,
};

const getPublicSiteConfig = async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('site_configs').findOne({ _id: 'default' });
    if (!doc) {
      return res.json(DEFAULT_CONFIG);
    }
    res.json({
      heroBackgroundUrl: doc.heroBackgroundUrl || '',
      announcementBanner: doc.announcementBanner || '',
      featuredNote: doc.featuredNote || '',
      updatedAt: doc.updatedAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateSiteConfig = async (req, res) => {
  try {
    const db = getDb();
    const { heroBackgroundUrl = '', announcementBanner = '', featuredNote = '' } = req.body;
    const updateDoc = {
      heroBackgroundUrl: String(heroBackgroundUrl).trim(),
      announcementBanner: String(announcementBanner).trim(),
      featuredNote: String(featuredNote).trim(),
      updatedAt: new Date(),
      updatedBy: req.admin ? req.admin.username : 'admin',
    };

    await db.collection('site_configs').updateOne(
      { _id: 'default' },
      { $set: updateDoc },
      { upsert: true }
    );

    res.json({
      heroBackgroundUrl: updateDoc.heroBackgroundUrl,
      announcementBanner: updateDoc.announcementBanner,
      featuredNote: updateDoc.featuredNote,
      updatedAt: updateDoc.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getPublicSiteConfig, updateSiteConfig };
```

Mount in `src/routes/adminRoutes.js`:
```javascript
const { updateSiteConfig } = require('../controllers/siteConfigController');
// ...
router.put(
  '/site-config',
  [
    check('heroBackgroundUrl').optional().isString(),
    check('announcementBanner').optional().isString(),
    check('featuredNote').optional().isString(),
  ],
  validate,
  updateSiteConfig
);
```

Mount in `src/app.js`:
```javascript
const { getPublicSiteConfig } = require('./controllers/siteConfigController');
// ...
app.get('/api/site-config', getPublicSiteConfig);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/integration/siteConfig.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/siteConfigController.js src/routes/adminRoutes.js src/app.js tests/integration/siteConfig.test.js
git commit -m "feat: add public and admin site-config endpoints"
```

---

### Task 6: Backend-Hosted Admin UI (`/admin`) with Exercises, Muscle Groups & Site Config Tabs

**Files:**
- Create: `src/public/admin/index.html`
- Create: `src/public/admin/styles.css`
- Create: `src/public/admin/app.js`
- Modify: `src/app.js`
- Test: `tests/integration/adminUi.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/login`, `/api/admin/exercises`, `/api/admin/muscle-groups`, `/api/site-config`, `/api/admin/site-config`
- Produces: Static Admin UI served at `/admin`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/integration/adminUi.test.js`:
```javascript
const request = require('supertest');
const app = require('../../src/app');

describe('Backend-hosted Admin UI', () => {
  test('GET /admin/ serves index.html', async () => {
    const res = await request(app).get('/admin/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('FitTrack Admin');
  });

  test('GET /admin/app.js serves client script', async () => {
    const res = await request(app).get('/admin/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/adminUi.test.js`
Expected: FAIL with 404

- [ ] **Step 3: Create `src/public/admin/index.html`, `styles.css`, `app.js` and mount in `src/app.js`**

Create `src/public/admin/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FitTrack Admin</title>
  <link rel="stylesheet" href="/admin/styles.css" />
</head>
<body>
  <div id="login-view" class="card login-card">
    <h1>FitTrack Admin</h1>
    <p class="muted">Sign in with dedicated Admin credentials.</p>
    <form id="login-form">
      <label>Username <input type="text" id="login-username" required /></label>
      <label>Password <input type="password" id="login-password" required /></label>
      <button type="submit" class="btn-primary">Sign In</button>
      <p id="login-error" class="error"></p>
    </form>
  </div>

  <div id="dashboard-view" class="hidden">
    <header class="topbar">
      <strong>FitTrack Admin</strong>
      <div class="topbar-actions">
        <button id="tab-exercises" class="tab active" type="button">Exercises</button>
        <button id="tab-groups" class="tab" type="button">Muscle Groups</button>
        <button id="tab-config" class="tab" type="button">Site Content</button>
        <button id="logout-btn" class="btn-secondary" type="button">Logout</button>
      </div>
    </header>

    <main class="container">
      <!-- TAB 1: EXERCISES -->
      <section id="panel-exercises">
        <div class="toolbar">
          <input type="search" id="exercise-search" placeholder="Filter exercises..." />
          <button id="new-exercise-btn" class="btn-primary" type="button">+ New Exercise</button>
        </div>

        <form id="exercise-form" class="card hidden">
          <h3 id="exercise-form-title">New Exercise</h3>
          <input type="hidden" id="ex-id" />
          <div class="grid">
            <label>Name <input type="text" id="ex-name" required /></label>
            <label>Category (Muscle Group)
              <select id="ex-category" required></select>
            </label>
            <label>Broad Muscle Group <input type="text" id="ex-muscle" placeholder="Chest, Back, Legs..." /></label>
            <label>Equipment <input type="text" id="ex-equipment" /></label>
            <label>Difficulty
              <select id="ex-difficulty">
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </label>
            <label>Image URL <input type="url" id="ex-image" placeholder="https://..." /></label>
          </div>
          <label>Instructions (one step per line)
            <textarea id="ex-instructions" rows="3"></textarea>
          </label>
          <div class="row-actions">
            <button type="submit" class="btn-primary">Save</button>
            <button type="button" id="cancel-exercise-btn" class="btn-secondary">Cancel</button>
          </div>
        </form>

        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Equipment</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="exercises-tbody"></tbody>
        </table>
      </section>

      <!-- TAB 2: MUSCLE GROUPS -->
      <section id="panel-groups" class="hidden">
        <div class="card">
          <h3>Add / Rename Muscle Group</h3>
          <p class="muted">Renaming a muscle group automatically updates all exercises, workouts, sessions, and plans.</p>
          <form id="group-form" class="grid">
            <input type="hidden" id="grp-id" />
            <label>Name <input type="text" id="grp-name" required /></label>
            <label>Icon URL (optional) <input type="url" id="grp-icon" placeholder="https://..." /></label>
            <div class="row-actions">
              <button type="submit" class="btn-primary">Save Group</button>
              <button type="button" id="cancel-group-btn" class="btn-secondary">Clear</button>
            </div>
          </form>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="groups-tbody"></tbody>
        </table>
      </section>

      <!-- TAB 3: SITE CONTENT -->
      <section id="panel-config" class="hidden card">
        <h2>Site Content & Backgrounds</h2>
        <form id="config-form">
          <label>Hero Background Image URL
            <input type="url" id="cfg-hero-bg" placeholder="https://..." />
          </label>
          <img id="cfg-hero-preview" class="preview hidden" alt="Hero preview" />
          <label>Announcement Banner
            <input type="text" id="cfg-banner" />
          </label>
          <label>Featured Note
            <textarea id="cfg-note" rows="3"></textarea>
          </label>
          <button type="submit" class="btn-primary">Save Config</button>
          <span id="cfg-status" class="muted"></span>
        </form>
      </section>
    </main>
  </div>

  <script src="/admin/app.js"></script>
</body>
</html>
```

Create `src/public/admin/styles.css`:
```css
* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; background: #f3f4f6; color: #111827; }
.hidden { display: none !important; }
.muted { color: #6b7280; font-size: 0.9rem; }
.error { color: #dc2626; font-size: 0.9rem; min-height: 1.2em; }
.card { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
.login-card { max-width: 380px; margin: 10vh auto; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: #111827; color: #fff; }
.topbar-actions { display: flex; gap: 0.5rem; }
.container { max-width: 1040px; margin: 1.5rem auto; padding: 0 1rem; }
.toolbar { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.toolbar input { flex: 1; padding: 0.5rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; align-items: end; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.75rem; }
input, select, textarea { padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; }
button { cursor: pointer; border: none; border-radius: 6px; padding: 0.5rem 0.9rem; font-weight: 600; }
.btn-primary { background: #2563eb; color: #fff; }
.btn-secondary { background: #e5e7eb; color: #111827; }
.tab { background: transparent; color: #9ca3af; }
.tab.active { background: #374151; color: #fff; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
.table th, .table td { padding: 0.65rem 0.75rem; border-bottom: 1px solid #e5e7eb; text-align: left; font-size: 0.9rem; }
.row-actions { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.preview { max-width: 100%; max-height: 220px; border-radius: 6px; margin-bottom: 0.75rem; object-fit: cover; }
```

Create `src/public/admin/app.js`:
```javascript
const TOKEN_KEY = 'fittrack_admin_token';
let exercisesCache = [];
let groupsCache = [];

const $ = (id) => document.getElementById(id);

const apiFetch = async (url, options = {}) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
};

const showDashboard = async () => {
  $('login-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  await Promise.all([loadGroups(), loadExercises(), loadSiteConfig()]);
};

const showLogin = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  $('dashboard-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
};

const populateCategorySelect = () => {
  const select = $('ex-category');
  select.innerHTML = '';
  groupsCache
    .filter((g) => g.isActive !== false)
    .forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.name;
      opt.textContent = g.name;
      select.appendChild(opt);
    });
};

const renderGroups = () => {
  const tbody = $('groups-tbody');
  tbody.innerHTML = '';
  groupsCache.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td>${g.isActive ? 'Active' : 'Hidden'}</td>
      <td class="row-actions">
        <button type="button" class="btn-secondary edit-grp">Rename/Edit</button>
        <button type="button" class="btn-secondary toggle-grp">${g.isActive ? 'Hide' : 'Restore'}</button>
        <button type="button" class="btn-secondary merge-grp">Merge Into...</button>
      </td>
    `;
    tr.children[0].textContent = g.name;
    tr.children[1].textContent = g.slug;
    tr.querySelector('.edit-grp').addEventListener('click', () => {
      $('grp-id').value = g.id;
      $('grp-name').value = g.name;
      $('grp-icon').value = g.iconUrl || '';
    });
    tr.querySelector('.toggle-grp').addEventListener('click', async () => {
      await apiFetch(`/api/admin/muscle-groups/${g.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !g.isActive }),
      });
      await loadGroups();
    });
    tr.querySelector('.merge-grp').addEventListener('click', async () => {
      const targetName = window.prompt(`Merge "${g.name}" into which existing Muscle Group name?`);
      if (!targetName) return;
      const target = groupsCache.find((x) => x.name.toLowerCase() === targetName.trim().toLowerCase());
      if (!target || target.id === g.id) {
        window.alert('Target muscle group not found.');
        return;
      }
      await apiFetch(`/api/admin/muscle-groups/${g.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetId: target.id }),
      });
      await Promise.all([loadGroups(), loadExercises()]);
    });
    tbody.appendChild(tr);
  });
};

const loadGroups = async () => {
  groupsCache = await apiFetch('/api/admin/muscle-groups');
  populateCategorySelect();
  renderGroups();
};

const renderExercises = () => {
  const q = $('exercise-search').value.trim().toLowerCase();
  const tbody = $('exercises-tbody');
  tbody.innerHTML = '';

  exercisesCache
    .filter((ex) => !q || ex.name.toLowerCase().includes(q) || ex.category.toLowerCase().includes(q))
    .forEach((ex) => {
      const tr = document.createElement('tr');
      const active = ex.isActive !== false;
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td>${active ? 'Active' : 'Hidden'}</td>
        <td class="row-actions">
          <button type="button" class="btn-secondary edit-btn">Edit</button>
          <button type="button" class="btn-secondary toggle-btn">${active ? 'Hide' : 'Restore'}</button>
        </td>
      `;
      tr.children[0].textContent = ex.name;
      tr.children[1].textContent = ex.category;
      tr.children[2].textContent = ex.equipment || '-';
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditForm(ex));
      tr.querySelector('.toggle-btn').addEventListener('click', () => toggleStatus(ex.id, !active));
      tbody.appendChild(tr);
    });
};

const loadExercises = async () => {
  exercisesCache = await apiFetch('/api/admin/exercises');
  renderExercises();
};

const openEditForm = (ex = null) => {
  $('exercise-form').classList.remove('hidden');
  $('exercise-form-title').textContent = ex ? 'Edit Exercise' : 'New Exercise';
  $('ex-id').value = ex ? ex.id : '';
  $('ex-name').value = ex ? ex.name : '';
  if (ex && ex.category) $('ex-category').value = ex.category;
  $('ex-muscle').value = ex ? (ex.muscleGroup || '') : '';
  $('ex-equipment').value = ex ? (ex.equipment || '') : '';
  $('ex-difficulty').value = ex ? (ex.difficulty || 'Beginner') : 'Beginner';
  $('ex-image').value = ex ? (ex.imageUrl || '') : '';
  $('ex-instructions').value = ex && Array.isArray(ex.instructions) ? ex.instructions.join('\n') : '';
};

const toggleStatus = async (id, isActive) => {
  await apiFetch(`/api/admin/exercises/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  await loadExercises();
};

const loadSiteConfig = async () => {
  const cfg = await apiFetch('/api/site-config');
  $('cfg-hero-bg').value = cfg.heroBackgroundUrl || '';
  $('cfg-banner').value = cfg.announcementBanner || '';
  $('cfg-note').value = cfg.featuredNote || '';
  updatePreview();
};

const updatePreview = () => {
  const url = $('cfg-hero-bg').value.trim();
  const img = $('cfg-hero-preview');
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
};

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const data = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('login-username').value,
        password: $('login-password').value,
      }),
    });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    await showDashboard();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout-btn').addEventListener('click', showLogin);
$('exercise-search').addEventListener('input', renderExercises);
$('new-exercise-btn').addEventListener('click', () => openEditForm(null));
$('cancel-exercise-btn').addEventListener('click', () => $('exercise-form').classList.add('hidden'));

$('exercise-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('ex-id').value;
  const payload = {
    name: $('ex-name').value,
    category: $('ex-category').value,
    muscleGroup: $('ex-muscle').value,
    equipment: $('ex-equipment').value,
    difficulty: $('ex-difficulty').value,
    imageUrl: $('ex-image').value,
    instructions: $('ex-instructions').value.split('\n').map((s) => s.trim()).filter(Boolean),
  };

  if (id) {
    await apiFetch(`/api/admin/exercises/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await apiFetch('/api/admin/exercises', { method: 'POST', body: JSON.stringify(payload) });
  }
  $('exercise-form').classList.add('hidden');
  await loadExercises();
});

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('grp-id').value;
  const payload = {
    name: $('grp-name').value,
    iconUrl: $('grp-icon').value,
  };
  if (id) {
    await apiFetch(`/api/admin/muscle-groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await apiFetch('/api/admin/muscle-groups', { method: 'POST', body: JSON.stringify(payload) });
  }
  $('grp-id').value = '';
  $('grp-name').value = '';
  $('grp-icon').value = '';
  await Promise.all([loadGroups(), loadExercises()]);
});

$('cancel-group-btn').addEventListener('click', () => {
  $('grp-id').value = '';
  $('grp-name').value = '';
  $('grp-icon').value = '';
});

$('cfg-hero-bg').addEventListener('input', updatePreview);
$('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('cfg-status').textContent = 'Saving...';
  await apiFetch('/api/admin/site-config', {
    method: 'PUT',
    body: JSON.stringify({
      heroBackgroundUrl: $('cfg-hero-bg').value,
      announcementBanner: $('cfg-banner').value,
      featuredNote: $('cfg-note').value,
    }),
  });
  $('cfg-status').textContent = 'Saved!';
});

const switchTab = (activeTabId, activePanelId) => {
  ['tab-exercises', 'tab-groups', 'tab-config'].forEach((id) => $(id).classList.remove('active'));
  ['panel-exercises', 'panel-groups', 'panel-config'].forEach((id) => $(id).classList.add('hidden'));
  $(activeTabId).classList.add('active');
  $(activePanelId).classList.remove('hidden');
};

$('tab-exercises').addEventListener('click', () => switchTab('tab-exercises', 'panel-exercises'));
$('tab-groups').addEventListener('click', () => switchTab('tab-groups', 'panel-groups'));
$('tab-config').addEventListener('click', () => switchTab('tab-config', 'panel-config'));

if (sessionStorage.getItem(TOKEN_KEY)) {
  showDashboard().catch(showLogin);
}
```

Modify `src/app.js`:
- Require `path = require('path')`.
- Configure Helmet `imgSrc`:
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },
}));
```
- Serve static `/admin`:
```javascript
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS (all unit and integration tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/public/admin/ src/app.js tests/integration/adminUi.test.js
git commit -m "feat: add backend-hosted Admin UI with Exercises, Muscle Groups, and Site Config tabs"
```
