# FitTrack Caching & React Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight, Render-Free-safe server-side in-memory caching + HTTP `Cache-Control` headers for shared/RAG endpoints and `@tanstack/react-query` client-side caching + invalidation across the FitTrack React app.

**Architecture:**
- **Backend (`server`, branch `feat/caching-and-react-query`):** Single-process bounded LRU+TTL `MemoryCache` (zero external infra, no Redis) for public read-mostly catalogs (`muscle-groups`, `site-config`, `exercises`), admin write-through invalidation, HTTP `Cache-Control` headers, and bounded RAG embedding/chunk caches. Per-user dynamic data stays uncached in server RAM to protect the 512 MB Render Free ceiling.
- **Frontend (`client`, branch `feat/caching-and-react-query`):** `@tanstack/react-query` v5 `QueryClient` with sensible `staleTime`/`gcTime`, centralized `queryKeys`, full `queryClient.clear()` on auth changes, and targeted `invalidateQueries` on mutations (including AI Coach `applyPlan` updating Weekly Plans & Active Schedule immediately).

**Tech Stack:** Node.js CommonJS, Express 5, MongoDB 7, Jest + Supertest (`server`); React 19.1, `@tanstack/react-query@^5`, Axios, React Testing Library (`client`).

## Global Constraints

- **Render Free ceiling:** Single Node instance, 512 MB RAM, 0.1 vCPU, possible cold restarts on deploy/OOM/idle. Every server cache MUST be bounded (`maxEntries`), TTL-expired, and strictly cache-aside (cache miss reads MongoDB; never store unpersisted state).
- **No Redis / external cache service:** Zero new infrastructure dependencies in `docker-compose.yml` or `package.json` on the server.
- **No unbounded per-user server RAM caches:** User-specific endpoints (`/api/workout-sessions`, `/api/analytics/*`, `/api/weekly-schedules/*`, `/api/users/progress`) are cached ONLY on the client via React Query.
- **No arbitrary search string caching in server RAM:** `GET /api/exercises/search?q=...` stays uncached on the server to prevent unbounded key cardinality.
- **Auth cache isolation:** `logout`, `login`, and `googleLogin` MUST clear `queryClient` so user A's cached data never leaks to user B.
- **Test isolation:** `server/tests/setup/testDb.js` `clearDb()` MUST flush all server caches between integration tests; `client` page tests render components directly without `<App />`, so tests must wrap with a fresh `QueryClient` (`retry: false`, `gcTime: 0`).

---

## File Map

### Server (`server/`)
- Create: `src/utils/memoryCache.js` — bounded LRU+TTL `MemoryCache` class + shared instances (`publicDataCache`, `ragEmbeddingCache`, `ragChunksCache`) + `clearAllCaches()`.
- Modify: `tests/setup/testDb.js` — call `clearAllCaches()` inside `clearDb()`.
- Modify: `src/controllers/muscleGroupController.js` — cache `getPublicMuscleGroups`, set `Cache-Control`, invalidate `muscle-groups:public` (and `exercises:` on cascade rename/merge).
- Modify: `src/controllers/siteConfigController.js` — cache `getPublicSiteConfig`, set `Cache-Control`, invalidate `site-config:public` on `updateSiteConfig`.
- Modify: `src/controllers/exerciseController.js` — cache `getAllExercises`, `getExercisesByCategory`, `getExerciseById`, set `Cache-Control` (leave `searchExercises` uncached).
- Modify: `src/controllers/adminExerciseController.js` — invalidate `exercises:` prefix on `createExercise`, `updateExercise`, `toggleExerciseStatus`.
- Modify: `src/services/rag/embeddingClient.js` — cache `RETRIEVAL_QUERY` embeddings in `ragEmbeddingCache`.
- Modify: `src/services/rag/knowledgeSearchService.js` — cache decoded local chunks in `ragChunksCache` + export `clearKnowledgeCache()`.
- Create: `tests/unit/memoryCache.test.js`
- Create: `tests/integration/cacheControlAndInvalidation.test.js`
- Create: `tests/unit/ragCaching.test.js`

### Client (`client/`)
- Modify: `package.json` — add `@tanstack/react-query@^5`.
- Create: `src/lib/queryClient.js` — singleton `queryClient`, `queryKeys` factory, and `invalidateWorkoutAndAnalytics(queryClient)` helper.
- Create: `src/test-utils/queryTestUtils.js` — `createTestQueryClient()` & `renderWithQueryClient(ui)` for Jest/RTL tests.
- Modify: `src/api/index.js` — add `exerciseAPI`, `workoutSessionAPI`, `weeklyPlanAPI`, `weeklyScheduleAPI`, `analyticsAPI` alongside existing `authAPI`, `userAPI`, `workoutAPI`, `muscleGroupAPI`, `siteConfigAPI`, `aiAPI`.
- Modify: `src/App.js` — wrap app in `<QueryClientProvider client={queryClient}>` and migrate `/site-config` fetch to `useQuery`.
- Modify: `src/context/AuthContext.jsx` — call `queryClient.clear()` in `login`, `googleLogin`, and `logout`.
- Modify: `src/pages/WorkoutPlanning.jsx` + `src/pages/WorkoutPlanning.test.jsx`
- Modify: `src/pages/ActiveWorkout.jsx` + `src/pages/ActiveWorkout.test.jsx`
- Modify: `src/pages/WeeklyPlanBuilder.jsx`
- Modify: `src/pages/WeeklyPlanLibrary.jsx`
- Modify: `src/pages/WeeklyCalendar.jsx`
- Modify: `src/pages/WorkoutHistory.jsx`
- Modify: `src/pages/Dashboard.jsx`
- Modify: `src/pages/ProgressTracking.jsx`
- Modify: `src/pages/Profile.jsx`
- Modify: `src/components/AiCoachWidget.jsx` + `src/components/AiCoachWidget.test.jsx`
- Create: `src/lib/queryClient.test.js`

---

### Task 1: Server Bounded LRU + TTL Cache Utility & Test Isolation

**Files:**
- Create: `server/src/utils/memoryCache.js`
- Modify: `server/tests/setup/testDb.js:24-33`
- Test: `server/tests/unit/memoryCache.test.js`

**Interfaces:**
- Produces:
  - `class MemoryCache({ maxEntries = 200, defaultTtlMs = 300000 })` with `.get(key)`, `.set(key, value, ttlMs)`, `.del(key)`, `.delByPrefix(prefix)`, `.clear()`, `.size()`
  - `publicDataCache` (`maxEntries: 100, defaultTtlMs: 5 * 60 * 1000`)
  - `ragEmbeddingCache` (`maxEntries: 100, defaultTtlMs: 30 * 60 * 1000`)
  - `ragChunksCache` (`maxEntries: 10, defaultTtlMs: 15 * 60 * 1000`)
  - `clearAllCaches()`

- [ ] **Step 1: Write the failing unit tests**

Create `server/tests/unit/memoryCache.test.js`:

```js
const { MemoryCache, clearAllCaches, publicDataCache } = require('../../src/utils/memoryCache');

describe('MemoryCache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearAllCaches();
  });

  test('returns undefined on miss and stored value on hit before TTL', () => {
    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 5000 });
    expect(cache.get('missing')).toBeUndefined();

    cache.set('k1', { ok: true });
    expect(cache.get('k1')).toEqual({ ok: true });
    expect(cache.size()).toBe(1);
  });

  test('expires entries after TTL elapses', () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 1000 });
    cache.set('k1', 'v1');
    expect(cache.get('k1')).toBe('v1');

    now += 1001;
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test('evicts least-recently-used entry when maxEntries is exceeded', () => {
    const cache = new MemoryCache({ maxEntries: 2, defaultTtlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so 'b' becomes least-recently-used
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('delByPrefix removes only matching keys', () => {
    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 10000 });
    cache.set('exercises:all', [1]);
    cache.set('exercises:category:Chest', [2]);
    cache.set('muscle-groups:public', [3]);

    cache.delByPrefix('exercises:');
    expect(cache.get('exercises:all')).toBeUndefined();
    expect(cache.get('exercises:category:Chest')).toBeUndefined();
    expect(cache.get('muscle-groups:public')).toEqual([3]);
  });

  test('clearAllCaches flushes shared caches', () => {
    publicDataCache.set('site-config:public', { announcementBanner: 'Hi' });
    expect(publicDataCache.size()).toBe(1);
    clearAllCaches();
    expect(publicDataCache.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `server/`): `npx jest tests/unit/memoryCache.test.js`
Expected: FAIL (`Cannot find module '../../src/utils/memoryCache'`).

- [ ] **Step 3: Implement `server/src/utils/memoryCache.js` and hook `clearAllCaches` into `testDb.js`**

Create `server/src/utils/memoryCache.js`:

```js
class MemoryCache {
  constructor({ maxEntries = 200, defaultTtlMs = 5 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh insertion order so recently read keys stay hot (O(1) LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return value;
  }

  del(key) {
    return this.store.delete(key);
  }

  delByPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (String(key).startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

const publicDataCache = new MemoryCache({ maxEntries: 100, defaultTtlMs: 5 * 60 * 1000 });
const ragEmbeddingCache = new MemoryCache({ maxEntries: 100, defaultTtlMs: 30 * 60 * 1000 });
const ragChunksCache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 15 * 60 * 1000 });

const clearAllCaches = () => {
  publicDataCache.clear();
  ragEmbeddingCache.clear();
  ragChunksCache.clear();
};

module.exports = {
  MemoryCache,
  publicDataCache,
  ragEmbeddingCache,
  ragChunksCache,
  clearAllCaches,
};
```

Modify `server/tests/setup/testDb.js` inside `clearDb`:

```js
const { clearAllCaches } = require('../../src/utils/memoryCache');
```

And at the end of `clearDb()`:

```js
  clearAllCaches();
```

- [ ] **Step 4: Run test to verify it passes**

Run (in `server/`): `npx jest tests/unit/memoryCache.test.js`
Expected: PASS (5/5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/memoryCache.js server/tests/setup/testDb.js server/tests/unit/memoryCache.test.js
git commit -m "feat(cache): add bounded LRU+TTL MemoryCache utility and clear in test setup"
```

---

### Task 2: Public Catalog Caching, Admin Invalidation & `Cache-Control` Headers

**Files:**
- Modify: `server/src/controllers/muscleGroupController.js:76-198`
- Modify: `server/src/controllers/siteConfigController.js:10-55`
- Modify: `server/src/controllers/exerciseController.js:1-108`
- Modify: `server/src/controllers/adminExerciseController.js:20-98`
- Test: `server/tests/integration/cacheControlAndInvalidation.test.js`

**Interfaces:**
- Consumes: `publicDataCache` from `src/utils/memoryCache.js`
- Cache keys:
  - `'muscle-groups:public'`
  - `'site-config:public'`
  - `'exercises:all'`
  - `'exercises:category:<TitleCaseCategory>'`
  - `'exercises:id:<id>'`
- Header on public catalog GET 200 responses: `Cache-Control: public, max-age=60, stale-while-revalidate=300` (keeps browser cache fresh within 1 min after admin updates while serving stale-while-revalidate up to 5 min)

- [ ] **Step 1: Write the failing integration test**

Create `server/tests/integration/cacheControlAndInvalidation.test.js`:

```js
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { publicDataCache } = require('../../src/utils/memoryCache');

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

describe('Public catalog caching & admin invalidation', () => {
  test('GET /api/muscle-groups caches payload and invalidates on admin create/update', async () => {
    const first = await request(app).get('/api/muscle-groups');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('public, max-age=60');
    expect(publicDataCache.get('muscle-groups:public')).toHaveLength(14);

    // Direct DB insert behind cache should still serve cached 14 items until invalidated
    await db.collection('muscle_groups').insertOne({
      name: 'Neck',
      slug: 'neck',
      order: 15,
      isActive: true,
    });
    const cached = await request(app).get('/api/muscle-groups');
    expect(cached.body).toHaveLength(14);

    // Admin create triggers invalidation
    const created = await request(app)
      .post('/api/admin/muscle-groups')
      .set(adminAuth())
      .send({ name: 'Grip', order: 16 });
    expect(created.status).toBe(201);
    expect(publicDataCache.get('muscle-groups:public')).toBeUndefined();

    const fresh = await request(app).get('/api/muscle-groups');
    expect(fresh.body).toHaveLength(16);
  });

  test('GET /api/site-config caches payload and invalidates on PUT /api/admin/site-config', async () => {
    const first = await request(app).get('/api/site-config');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('public, max-age=60');
    expect(first.body.announcementBanner).toBe('');

    const updated = await request(app)
      .put('/api/admin/site-config')
      .set(adminAuth())
      .send({ announcementBanner: 'Maintenance at 02:00' });
    expect(updated.status).toBe(200);
    expect(publicDataCache.get('site-config:public')).toBeUndefined();

    const fresh = await request(app).get('/api/site-config');
    expect(fresh.body.announcementBanner).toBe('Maintenance at 02:00');
  });

  test('GET /api/exercises caches all/category/id and invalidates on admin exercise mutations & muscle group rename', async () => {
    await db.collection('exercises').insertOne({ name: 'Bench Press', category: 'Chest', isActive: true });

    const list1 = await request(app).get('/api/exercises');
    expect(list1.status).toBe(200);
    expect(list1.headers['cache-control']).toContain('public, max-age=60');
    expect(list1.body).toHaveLength(1);
    expect(publicDataCache.get('exercises:all')).toHaveLength(1);

    const cat1 = await request(app).get('/api/exercises/category/chest');
    expect(cat1.status).toBe(200);
    expect(publicDataCache.get('exercises:category:Chest')).toHaveLength(1);

    // Admin adds a new exercise -> invalidates exercises:*
    const createRes = await request(app)
      .post('/api/admin/exercises')
      .set(adminAuth())
      .send({ name: 'Push Up', category: 'Chest' });
    expect(createRes.status).toBe(201);
    expect(publicDataCache.get('exercises:all')).toBeUndefined();
    expect(publicDataCache.get('exercises:category:Chest')).toBeUndefined();

    const list2 = await request(app).get('/api/exercises');
    expect(list2.body).toHaveLength(2);

    // Deactivating an exercise also invalidates exercises:*
    const toggleRes = await request(app)
      .patch(`/api/admin/exercises/${createRes.body.id}/status`)
      .set(adminAuth())
      .send({ isActive: false });
    expect(toggleRes.status).toBe(200);

    const list3 = await request(app).get('/api/exercises');
    expect(list3.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `server/`): `npx jest tests/integration/cacheControlAndInvalidation.test.js`
Expected: FAIL (`expect(first.headers['cache-control']).toContain('public, max-age=60')` fails).

- [ ] **Step 3: Implement caching + invalidation in the 4 controllers**

1. `server/src/controllers/muscleGroupController.js`:
   - Require `{ publicDataCache } = require('../utils/memoryCache');`
   - Define `const PUBLIC_CACHE_KEY = 'muscle-groups:public';` and `const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';`
   - In `getPublicMuscleGroups`:
     ```js
     const cached = publicDataCache.get(PUBLIC_CACHE_KEY);
     if (cached) {
       res.set('Cache-Control', PUBLIC_CACHE_CONTROL);
       return res.json(cached);
     }
     ```
     After querying and mapping `const payload = groups.map(mapGroup);`, call `publicDataCache.set(PUBLIC_CACHE_KEY, payload);`, `res.set('Cache-Control', PUBLIC_CACHE_CONTROL);`, `res.json(payload);`.
   - In `createMuscleGroup`: call `publicDataCache.del(PUBLIC_CACHE_KEY);` after `insertOne`.
   - In `updateMuscleGroup`: call `publicDataCache.del(PUBLIC_CACHE_KEY);` and if `cascadeCategoryRewrite` ran, also call `publicDataCache.delByPrefix('exercises:');`.
   - In `mergeMuscleGroup`: call `publicDataCache.del(PUBLIC_CACHE_KEY);` and `publicDataCache.delByPrefix('exercises:');`.

2. `server/src/controllers/siteConfigController.js`:
   - Require `{ publicDataCache } = require('../utils/memoryCache');`
   - Define `const SITE_CONFIG_CACHE_KEY = 'site-config:public';` and `const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';`
   - In `getPublicSiteConfig`: check `publicDataCache.get(SITE_CONFIG_CACHE_KEY)` first; when querying DB, build `payload` (`DEFAULT_CONFIG` if `!doc` else mapped object), store `publicDataCache.set(SITE_CONFIG_CACHE_KEY, payload)`, set `Cache-Control`, return `res.json(payload)`.
   - In `updateSiteConfig`: call `publicDataCache.del(SITE_CONFIG_CACHE_KEY);` after `updateOne`.

3. `server/src/controllers/exerciseController.js`:
   - Require `{ publicDataCache } = require('../utils/memoryCache');`
   - Define `const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';`
   - In `getAllExercises`: check `'exercises:all'`; set cache and `Cache-Control`.
   - In `getExercisesByCategory`: check `exercises:category:${formattedCategory}`; set cache and `Cache-Control`.
   - In `getExerciseById`: guard `if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid exercise ID' });` — wait: check existing `tests/integration/exercises.test.js` first to see what status code existing tests expect for invalid IDs! Let's keep existing invalid-ID behavior untouched and only cache valid hit (`if (exercise)`), checking `publicDataCache.get('exercises:id:' + id)` before `findOne`.
   - Leave `searchExercises` uncached in server RAM.

4. `server/src/controllers/adminExerciseController.js`:
   - Require `{ publicDataCache } = require('../utils/memoryCache');`
   - Call `publicDataCache.delByPrefix('exercises:');` after DB write in `createExercise`, `updateExercise`, and `toggleExerciseStatus`.

- [ ] **Step 4: Run integration tests to verify they pass**

Run (in `server/`): `npx jest tests/integration/cacheControlAndInvalidation.test.js tests/integration/exercises.test.js tests/integration/muscleGroups.test.js tests/integration/siteConfig.test.js tests/integration/adminExercises.test.js`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/muscleGroupController.js server/src/controllers/siteConfigController.js server/src/controllers/exerciseController.js server/src/controllers/adminExerciseController.js server/tests/integration/cacheControlAndInvalidation.test.js
git commit -m "feat(cache): cache public catalogs with admin invalidation and Cache-Control headers"
```

---

### Task 3: RAG Query Embedding & Local Knowledge Chunk Caching

**Files:**
- Modify: `server/src/services/rag/embeddingClient.js:1-44`
- Modify: `server/src/services/rag/knowledgeSearchService.js:146-185,273-281`
- Modify: `server/src/scripts/ingestKnowledge.js:1-65`
- Test: `server/tests/unit/ragCaching.test.js`

**Interfaces:**
- Consumes: `ragEmbeddingCache`, `ragChunksCache` from `src/utils/memoryCache.js`
- Produces: `clearKnowledgeCache()` exported from `knowledgeSearchService.js`

- [ ] **Step 1: Write the failing unit tests**

Create `server/tests/unit/ragCaching.test.js`:

```js
const { clearAllCaches } = require('../../src/utils/memoryCache');
const { toFloat32Binary } = require('../../src/services/rag/vectorMath');

jest.mock('@google/genai', () => {
  const mockEmbedContent = jest.fn().mockResolvedValue({
    embeddings: [{ values: [1, 0, 0] }],
  });
  return {
    GoogleGenAI: jest.fn(() => ({
      models: { embedContent: mockEmbedContent },
    })),
    __mockEmbedContent: mockEmbedContent,
  };
});

const { __mockEmbedContent } = require('@google/genai');
const { embedText } = require('../../src/services/rag/embeddingClient');
const { searchKnowledge, clearKnowledgeCache } = require('../../src/services/rag/knowledgeSearchService');

describe('RAG caching', () => {
  const prevKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    __mockEmbedContent.mockClear();
    clearAllCaches();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = prevKey;
  });

  test('embedText caches RETRIEVAL_QUERY normalized vectors and skips repeat Gemini calls', async () => {
    const v1 = await embedText('  creatine   dosage  ', { taskType: 'RETRIEVAL_QUERY' });
    const v2 = await embedText('creatine dosage', { taskType: 'RETRIEVAL_QUERY' });

    expect(v1).toEqual(v2);
    expect(__mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  test('embedText does NOT cache RETRIEVAL_DOCUMENT calls', async () => {
    await embedText('doc body', { taskType: 'RETRIEVAL_DOCUMENT', title: 'Doc 1' });
    await embedText('doc body', { taskType: 'RETRIEVAL_DOCUMENT', title: 'Doc 1' });
    expect(__mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  test('runLocalHybridSearch caches decoded chunks in ragChunksCache until cleared', async () => {
    const toArray = jest.fn().mockResolvedValue([
      {
        chunkId: 'c1',
        sourceId: 's1',
        title: 'Creatine',
        topic: 'supplements',
        authors: 'ISSN',
        year: 2017,
        section: 'Dosage',
        references: [],
        content: 'Take 3-5g creatine daily.',
        embedding: toFloat32Binary([1, 0, 0]),
      },
    ]);
    const fakeDb = {
      collection: jest.fn(() => ({ find: jest.fn(() => ({ toArray })) })),
    };

    const r1 = await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });
    const r2 = await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });

    expect(r1.results).toHaveLength(1);
    expect(r2.results).toHaveLength(1);
    expect(toArray).toHaveBeenCalledTimes(1);

    clearKnowledgeCache();
    await searchKnowledge({ db: fakeDb, query: 'creatine', mode: 'local' });
    expect(toArray).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `server/`): `npx jest tests/unit/ragCaching.test.js`
Expected: FAIL (`__mockEmbedContent` called twice, `toArray` called twice, `clearKnowledgeCache is not a function`).

- [ ] **Step 3: Implement embedding and local chunk caching**

1. In `server/src/services/rag/embeddingClient.js`:
   - Import `{ ragEmbeddingCache } = require('../../utils/memoryCache');`
   - In `embedText`: normalize cache key `const cacheKey = taskType === 'RETRIEVAL_QUERY' ? \`\${EMBEDDING_MODEL}:\${cleanText.toLowerCase().replace(/\\s+/g, ' ')}\` : null;`
   - Before calling `ai.models.embedContent`, return `ragEmbeddingCache.get(cacheKey)` if found.
   - After `normalizeVector(values)`, if `cacheKey`, call `ragEmbeddingCache.set(cacheKey, normalized)`.

2. In `server/src/services/rag/knowledgeSearchService.js`:
   - Import `{ ragChunksCache } = require('../../utils/memoryCache');`
   - In `runLocalHybridSearch`:
     ```js
     const cacheKey = `local-chunks:${topic && ALLOWED_TOPICS.includes(topic) ? topic : 'all'}`;
     let preparedDocs = ragChunksCache.get(cacheKey);
     if (!preparedDocs) {
       const filter = topic && ALLOWED_TOPICS.includes(topic) ? { topic } : {};
       const docs = await db.collection(KNOWLEDGE_COLLECTION).find(filter).toArray();
       preparedDocs = docs.map((doc) => ({
         doc,
         vector: fromFloat32Binary(doc.embedding),
       }));
       ragChunksCache.set(cacheKey, preparedDocs);
     }
     if (preparedDocs.length === 0) return [];
     ```
     Update `vectorScored` and `lexicalScored` to iterate over `preparedDocs` (`({ doc, vector }) => ...`).
   - Add `function clearKnowledgeCache() { ragChunksCache.clear(); }` and export it.

3. In `server/src/scripts/ingestKnowledge.js`:
   - Import `clearKnowledgeCache` from `../services/rag/knowledgeSearchService` and call `clearKnowledgeCache()` inside `ingestKnowledgeDirectory` when `embeddedCount > 0 || deletedCount > 0` so any in-process caller never reads stale chunks.

- [ ] **Step 4: Run RAG unit & integration tests**

Run (in `server/`): `npx jest tests/unit/ragCaching.test.js tests/unit/embeddingClient.test.js tests/unit/knowledgeSearchService.test.js tests/integration/ragMcpAndChat.test.js`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/rag/embeddingClient.js server/src/services/rag/knowledgeSearchService.js server/tests/unit/ragCaching.test.js
git commit -m "feat(rag): cache query embeddings and decoded local knowledge chunks"
```

---

### Task 4: Frontend React Query Foundation, Query Keys, API Helpers & Auth Isolation

**Files:**
- Modify: `client/package.json`
- Create: `client/src/lib/queryClient.js`
- Create: `client/src/test-utils/queryTestUtils.js`
- Modify: `client/src/api/index.js`
- Modify: `client/src/App.js`
- Modify: `client/src/context/AuthContext.jsx`
- Test: `client/src/lib/queryClient.test.js`

**Interfaces:**
- Produces:
  - `queryClient` (singleton `QueryClient` with `staleTime: 60 * 1000`, `gcTime: 10 * 60 * 1000`, `retry: 1`, `refetchOnWindowFocus: false`)
  - `queryKeys`:
    - `siteConfig: ['site-config']`
    - `muscleGroups: ['muscle-groups']`
    - `exercises: { all: ['exercises'], byCategory: (slug) => ['exercises', 'category', slug] }`
    - `userProgress: ['user-progress']`
    - `workoutSessions: { all: ['workout-sessions'], detail: (id) => ['workout-sessions', id] }`
    - `weeklyPlans: { all: ['weekly-plans'], detail: (id) => ['weekly-plans', id] }`
    - `weeklySchedule: { current: ['weekly-schedule', 'current'] }`
    - `analytics: { userExercises: ['analytics', 'user-exercises'], workoutStats: ['analytics', 'workout-stats'], weeklyProgress: ['analytics', 'weekly-progress'], strengthProgression: (name) => ['analytics', 'strength-progression', name] }`
    - `ai: { conversations: ['ai', 'conversations'], conversation: (id) => ['ai', 'conversations', id], memories: ['ai', 'memories'], mcpKey: ['ai', 'mcp-key'] }`
  - `invalidateWorkoutAndAnalytics(qc)`: invalidates `workoutSessions.all`, `weeklySchedule.current`, `['analytics']`, `userProgress`
  - `renderWithQueryClient(ui)` in `client/src/test-utils/queryTestUtils.js`

- [ ] **Step 1: Install `@tanstack/react-query`**

Run (in `client/`): `npm install @tanstack/react-query@^5`

- [ ] **Step 2: Write failing tests for `queryClient`, `invalidateWorkoutAndAnalytics`, and Auth cache clearing**

Create `client/src/lib/queryClient.test.js`:

```js
import { createTestQueryClient } from '../test-utils/queryTestUtils';
import { queryKeys, invalidateWorkoutAndAnalytics } from './queryClient';

describe('queryClient helpers', () => {
  test('queryKeys produce stable deterministic arrays', () => {
    expect(queryKeys.exercises.byCategory('chest')).toEqual(['exercises', 'category', 'chest']);
    expect(queryKeys.workoutSessions.detail('s1')).toEqual(['workout-sessions', 's1']);
    expect(queryKeys.analytics.strengthProgression('Bench Press')).toEqual([
      'analytics',
      'strength-progression',
      'Bench Press',
    ]);
  });

  test('invalidateWorkoutAndAnalytics invalidates sessions, current schedule, analytics, and userProgress', async () => {
    const qc = createTestQueryClient();
    const spy = jest.spyOn(qc, 'invalidateQueries');

    await invalidateWorkoutAndAnalytics(qc);

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.workoutSessions.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.weeklySchedule.current });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['analytics'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.userProgress });
  });
});
```

- [ ] **Step 3: Create `client/src/lib/queryClient.js` and `client/src/test-utils/queryTestUtils.js`**

`client/src/lib/queryClient.js`:

```js
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 min default; public catalogs override to 5 min
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  siteConfig: ['site-config'],
  muscleGroups: ['muscle-groups'],
  exercises: {
    all: ['exercises'],
    byCategory: (slug) => ['exercises', 'category', slug],
  },
  userProgress: ['user-progress'],
  workoutSessions: {
    all: ['workout-sessions'],
    detail: (id) => ['workout-sessions', id],
  },
  weeklyPlans: {
    all: ['weekly-plans'],
    detail: (id) => ['weekly-plans', id],
  },
  weeklySchedule: {
    current: ['weekly-schedule', 'current'],
  },
  analytics: {
    userExercises: ['analytics', 'user-exercises'],
    workoutStats: ['analytics', 'workout-stats'],
    weeklyProgress: ['analytics', 'weekly-progress'],
    strengthProgression: (exerciseName) => ['analytics', 'strength-progression', exerciseName],
  },
  ai: {
    conversations: ['ai', 'conversations'],
    conversation: (id) => ['ai', 'conversations', id],
    memories: ['ai', 'memories'],
    mcpKey: ['ai', 'mcp-key'],
  },
};

export const invalidateWorkoutAndAnalytics = async (qc = queryClient) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.workoutSessions.all }),
    qc.invalidateQueries({ queryKey: queryKeys.weeklySchedule.current }),
    qc.invalidateQueries({ queryKey: ['analytics'] }),
    qc.invalidateQueries({ queryKey: queryKeys.userProgress }),
  ]);
};
```

`client/src/test-utils/queryTestUtils.js`:

```js
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

export const renderWithQueryClient = (ui, { client = createTestQueryClient() } = {}) => {
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    queryClient: client,
    ...render(ui, { wrapper }),
  };
};
```

- [ ] **Step 4: Expand `client/src/api/index.js`, wire `QueryClientProvider` in `App.js`, and clear cache in `AuthContext.jsx`**

1. Add to `client/src/api/index.js`:
   - `exerciseAPI`: `getAll()`, `getByCategory(slug)`
   - `workoutSessionAPI`: `getAll()`, `getById(id)`, `create(payload)`, `start(id)`, `update(id, payload)`, `complete(id)`, `remove(id)`
   - `weeklyPlanAPI`: `getAll()`, `getById(id)`, `create(payload)`, `update(id, payload)`, `remove(id)`
   - `weeklyScheduleAPI`: `getCurrent()`, `start(weeklyPlanId)`, `complete(id)`, `completeDay(id, payload)`, `updateDay(id, payload)`
   - `analyticsAPI`: `getUserExercises()`, `getWorkoutStats()`, `getWeeklyProgress()`, `getStrengthProgression(exerciseName)`

2. Modify `client/src/context/AuthContext.jsx`:
   - Import `{ queryClient } from '../lib/queryClient';`
   - Call `queryClient.clear();` inside `login`, `googleLogin` (before `setUser`), and `logout` (after `authAPI.logout()`).

3. Modify `client/src/App.js`:
   - Import `{ QueryClientProvider, useQuery } from '@tanstack/react-query';` and `{ queryClient, queryKeys } from './lib/queryClient';`
   - Wrap `<AuthProvider>` inside `<QueryClientProvider client={queryClient}>`.
   - Extract `SiteConfigLoader` or call `useQuery({ queryKey: queryKeys.siteConfig, queryFn: siteConfigAPI.get, staleTime: 5 * 60 * 1000, retry: false })` inside a child component under `QueryClientProvider` (note: `App` itself renders `QueryClientProvider`, so `useQuery` must run in a child like `<AppContent />`).

- [ ] **Step 5: Run tests to verify they pass**

Run (in `client/`): `CI=true npm test -- --watchAll=false src/lib/queryClient.test.js src/context/AuthContext.test.jsx`
Expected: PASS. (Also verify CRA 5 Jest 27 resolves `@tanstack/react-query` cleanly; if Jest complains about ESM in `@tanstack/*`, add `@tanstack` to `jest.transformIgnorePatterns` in `client/package.json`. Add an assertion in `AuthContext.test.jsx` verifying `queryClient.clear()` is called on `login` and `logout`.)

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/src/lib/queryClient.js client/src/lib/queryClient.test.js client/src/test-utils/queryTestUtils.js client/src/api/index.js client/src/App.js client/src/context/AuthContext.jsx
git commit -m "feat(client): configure React Query client, queryKeys, API wrappers, and auth cache clear"
```

---

### Task 5: Migrate Catalog Queries (`WorkoutPlanning`, `WeeklyPlanBuilder`, `ActiveWorkout`)

**Files:**
- Modify: `client/src/pages/WorkoutPlanning.jsx`
- Modify: `client/src/pages/WorkoutPlanning.test.jsx`
- Modify: `client/src/pages/WeeklyPlanBuilder.jsx`
- Modify: `client/src/pages/ActiveWorkout.jsx`
- Modify: `client/src/pages/ActiveWorkout.test.jsx`

**Interfaces:**
- Consumes: `queryKeys.muscleGroups`, `queryKeys.exercises.all`, `queryKeys.exercises.byCategory(slug)`, `queryKeys.weeklyPlans.detail(id)`, `invalidateWorkoutAndAnalytics`, `renderWithQueryClient`

- [ ] **Step 1: Update `WorkoutPlanning.test.jsx` & `ActiveWorkout.test.jsx` to use `renderWithQueryClient`**

Replace `render(<WorkoutPlanning />)` with `renderWithQueryClient(<WorkoutPlanning />)` and `render(<ActiveWorkout />)` with `renderWithQueryClient(<ActiveWorkout />)`. Add a test in `WorkoutPlanning.test.jsx` verifying that `axiosClient.get('/muscle-groups')` is called only once across two mounts sharing the same `QueryClient`.

- [ ] **Step 2: Run tests to confirm current failures / baseline before page edits**

Run (in `client/`): `CI=true npm test -- --watchAll=false src/pages/WorkoutPlanning.test.jsx src/pages/ActiveWorkout.test.jsx`

- [ ] **Step 3: Migrate `WorkoutPlanning.jsx`, `WeeklyPlanBuilder.jsx`, `ActiveWorkout.jsx`**

1. `WorkoutPlanning.jsx`:
   - `useQuery({ queryKey: queryKeys.muscleGroups, queryFn: muscleGroupAPI.getAll, staleTime: 5 * 60 * 1000 })` replacing the `useEffect` on mount; derive `muscleGroupData` (falling back to `DEFAULT_MUSCLE_GROUPS`).
   - `useQueries` (enabled when `step === 2 && selectedMuscleGroups.length > 0`) for `/exercises/category/${group.id}` with `staleTime: 5 * 60 * 1000`, so toggling between Step 1/Step 2 or re-selecting Chest reuses cached exercises without refetching!
   - `useMutation` for `POST /workout-sessions`, calling `invalidateWorkoutAndAnalytics(queryClient)` on success.

2. `WeeklyPlanBuilder.jsx`:
   - `useQuery` for `queryKeys.muscleGroups` (`staleTime: 5 * 60 * 1000`).
   - `useQuery` for `id ? queryKeys.weeklyPlans.detail(id) : ...` (`enabled: Boolean(id)`).
   - `useQuery` for exercises (`selectedMuscleGroup === 'all' ? queryKeys.exercises.all : queryKeys.exercises.byCategory(selectedMuscleGroup)`, `enabled: showExerciseModal`, `staleTime: 5 * 60 * 1000`).
   - `useMutation` for create/update/delete weekly plan, invalidating `queryKeys.weeklyPlans.all` and `queryKeys.weeklyPlans.detail(id)`.

3. `ActiveWorkout.jsx`:
   - Keep `fetchSession` or use `useQuery({ queryKey: queryKeys.workoutSessions.detail(id), queryFn: () => workoutSessionAPI.getById(id) })` + `useQuery` for `queryKeys.exercises.all` (`enabled: showExerciseModal` or triggered on click with `staleTime: 5 * 60 * 1000`).
   - On `completeWorkoutSession` and `handleSaveMetrics` / `handleToggleSet`, call `invalidateWorkoutAndAnalytics(queryClient)` and `queryClient.invalidateQueries({ queryKey: queryKeys.workoutSessions.detail(id) })`.

- [ ] **Step 4: Run tests to verify they pass**

Run (in `client/`): `CI=true npm test -- --watchAll=false src/pages/WorkoutPlanning.test.jsx src/pages/ActiveWorkout.test.jsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/WorkoutPlanning.jsx client/src/pages/WorkoutPlanning.test.jsx client/src/pages/WeeklyPlanBuilder.jsx client/src/pages/ActiveWorkout.jsx client/src/pages/ActiveWorkout.test.jsx
git commit -m "feat(client): migrate catalog and workout planning/active queries to React Query"
```

---

### Task 6: Migrate User Dashboard, Schedule, History, Progress & Profile Pages

**Files:**
- Modify: `client/src/pages/Dashboard.jsx`
- Modify: `client/src/pages/WeeklyCalendar.jsx`
- Modify: `client/src/pages/WeeklyPlanLibrary.jsx`
- Modify: `client/src/pages/WorkoutHistory.jsx`
- Modify: `client/src/pages/ProgressTracking.jsx`
- Modify: `client/src/pages/Profile.jsx`

**Interfaces:**
- Consumes: `queryKeys`, `invalidateWorkoutAndAnalytics`, `weeklyScheduleAPI`, `weeklyPlanAPI`, `workoutSessionAPI`, `analyticsAPI`, `userAPI`

- [ ] **Step 1: Migrate `Dashboard.jsx` and `Profile.jsx`**
  - `Dashboard.jsx`: replace `Promise.allSettled` in `useEffect` with 3 `useQuery` calls (`queryKeys.weeklySchedule.current` with `retry: false`, `queryKeys.userProgress`, `queryKeys.workoutSessions.all`); compute `stats` and `plannedWorkouts` via `useMemo`.
  - `Profile.jsx`: `useQuery({ queryKey: queryKeys.userProgress, queryFn: userAPI.getProgress, enabled: Boolean(user) })` + `useMutation({ mutationFn: userAPI.updateProgress, onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.userProgress }) })`.

- [ ] **Step 2: Migrate `WeeklyCalendar.jsx`, `WeeklyPlanLibrary.jsx`, and `WorkoutHistory.jsx`**
  - `WeeklyCalendar.jsx`: `useQuery` on `queryKeys.weeklySchedule.current` (`retry: false` so 404 when no active schedule exists renders the empty state immediately); mutations for `startWorkout`, `completeWeek`, `markComplete`, `swapDays`, `editDay` calling `invalidateWorkoutAndAnalytics(queryClient)`.
  - `WeeklyPlanLibrary.jsx`: `useQuery` on `queryKeys.weeklyPlans.all`; `useMutation` on `/weekly-schedules/start` invalidating `queryKeys.weeklySchedule.current`.
  - `WorkoutHistory.jsx`: `useQuery` on `queryKeys.workoutSessions.all`; `useMutation` on `complete` & `delete` calling `invalidateWorkoutAndAnalytics(queryClient)`.

- [ ] **Step 3: Migrate `ProgressTracking.jsx`**
  - 4 `useQuery` calls (`userExercises`, `workoutStats`, `weeklyProgress`, `userProgress`) + 1 dependent `useQuery` for `strengthProgression(selectedExercise)` (`enabled: Boolean(selectedExercise)`). Switching back and forth between exercises in the dropdown serves cached progression data instantly!

- [ ] **Step 4: Run client test suite & production build check**

Run (in `client/`): `CI=true npm test -- --watchAll=false && npm run build`
Expected: All existing tests PASS and `react-scripts build` succeeds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Dashboard.jsx client/src/pages/Profile.jsx client/src/pages/WeeklyCalendar.jsx client/src/pages/WeeklyPlanLibrary.jsx client/src/pages/WorkoutHistory.jsx client/src/pages/ProgressTracking.jsx
git commit -m "feat(client): migrate dashboard, calendar, library, history, progress, and profile to React Query"
```

---

### Task 7: Migrate `AiCoachWidget` & End-to-End Verification

**Files:**
- Modify: `client/src/components/AiCoachWidget.jsx`
- Modify: `client/src/components/AiCoachWidget.test.jsx`

**Interfaces:**
- Consumes: `queryKeys.ai.*`, `queryKeys.weeklyPlans.all`, `queryKeys.weeklySchedule.current`, `aiAPI`, `renderWithQueryClient`

- [ ] **Step 1: Inspect & update `AiCoachWidget.test.jsx` to wrap with `renderWithQueryClient`**
- [ ] **Step 2: Migrate `AiCoachWidget.jsx` queries & mutations**
  - `useQuery` (`enabled: isOpen && isAuthenticated`) for `queryKeys.ai.conversations`, `queryKeys.ai.memories`, `queryKeys.ai.mcpKey`.
  - `useMutation` for `chat`, `deleteConversation`, `deleteMemory`, `generateMcpKey`, `revokeMcpKey` invalidating corresponding `queryKeys.ai.*` keys (in `chat` `onSuccess`, also invalidate `queryKeys.ai.memories` when `res.memoriesUpdated` is true).
  - `useMutation` for `applyPlan`: on success, invalidate `queryKeys.weeklyPlans.all` AND `queryKeys.weeklySchedule.current` so Dashboard / Weekly Calendar / Plan Library reflect the AI-applied plan without a page reload.
- [ ] **Step 3: Run full test suites on BOTH `server` and `client`**
  - In `server/`: `npm test`
  - In `client/`: `CI=true npm test -- --watchAll=false && npm run build`
  - Verify `git status` and `git diff --stat` on both repos.
- [ ] **Step 4: Commit**

```bash
git add client/src/components/AiCoachWidget.jsx client/src/components/AiCoachWidget.test.jsx
git commit -m "feat(client): migrate AiCoachWidget to React Query and invalidate schedule/plans on applyPlan"
```
