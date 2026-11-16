# FitTrack i18n (English & Vietnamese) Design Specification

**Date:** 2026-11-16  
**Scope:** `client/` (React 19) & `server/` (Express 5 + MongoDB + MCP + Admin UI + AI Coach)

---

## 1. Goals & Decisions

| Area | Decision |
| :--- | :--- |
| **Supported Locales** | `en` (default & fallback), `vi` (`load: 'languageOnly'` normalizes `vi-VN` → `vi`, `en-US` → `en`) |
| **URL Strategy** | Keep existing routes (`/workouts`, `/dashboard`, ...). No `/en` or `/vi` URL prefixes. |
| **Persistence** | `localStorage` (`i18nextLng`) on client + `users.preferredLanguage` (`'en' \| 'vi'`) in MongoDB |
| **Units** | Fixed to `kg` (no `kg` ↔ `lbs` conversion; only labels are translated) |
| **API Errors** | Server returns `{ code, message }` (backward-compatible, including `validate.js`); client maps `code` via `getApiErrorMessage(err, t)` using `locales/<lang>/errors.json` |
| **Catalog Schema (DB)** | Non-breaking: keep English fields (`name`, `category`, `instructions`, ...); add optional `translations.vi.<field>` |
| **Catalog Seeding** | Seed default `translations.vi.name` on the 14 default `muscle_groups` (`DEFAULT_MUSCLE_GROUPS`) and backfill existing muscle groups missing `translations.vi.name` |
| **DB & Snapshot Fallback** | If `translations?.vi?.<field>` is missing/empty, fall back to English root field; for embedded workout/schedule snapshots (`{ exerciseId, exerciseName, category }`), resolve localized names against the cached `exercises` and `muscle_groups` catalogs |
| **Email & AI** | Rich HTML + plain-text emails (`emailTemplates.js`) use `user.preferredLanguage || req.lang || 'en'` with HTML escaping and preserved 24h/1h TTL notices; AI Coach (`@google/genai`) and MCP `search_exercises` support Vietnamese conversation while querying the English RAG corpus |

---

## 2. Data Model Changes (Non-Breaking)

### 2.1 `users` Collection
Add optional field:
```json
{
  "preferredLanguage": "en"
}
```
- Allowed values: `'en' | 'vi'`.
- Missing field on legacy documents defaults to `'en'`.

### 2.2 `exercises` Collection
Keep all existing English fields intact (`name`, `category`, `muscleGroup`, `equipment`, `difficulty`, `instructions`, `isActive`). Add optional `translations`:
```json
{
  "name": "Barbell Bench Press",
  "category": "Chest",
  "instructions": ["Lie flat on a bench...", "Lower the bar..."],
  "translations": {
    "vi": {
      "name": "Đẩy ngực ngang với thanh đòn",
      "instructions": ["Nằm ngửa trên ghế phẳng...", "Hạ thanh đòn..."]
    }
  }
}
```
- `category` and `muscleGroup` remain canonical English keys so `cascadeCategoryRewrite` and stored `workouts` / `weekly-plans` / `weekly-schedules` continue working unchanged.

### 2.3 `muscle_groups` Collection
Keep `name` (English) and `slug`. Add optional `translations` and seed default Vietnamese names for all 14 built-in groups:
```json
{
  "name": "Chest",
  "slug": "chest",
  "order": 1,
  "isActive": true,
  "translations": {
    "vi": {
      "name": "Ngực"
    }
  }
}
```

---

## 3. Architecture

### 3.1 Backend (`server/`)
1. **CORS (`server/src/app.js`)**: Add `'Accept-Language'` to `allowedHeaders`.
2. **Locale Middleware (`server/src/middleware/localeMiddleware.js`)**:
   - Parse `req.headers['accept-language']`.
   - Set `req.lang = header.toLowerCase().startsWith('vi') ? 'vi' : 'en'`.
3. **User Language API & Session Sync**:
   - `PATCH /api/users/language` (authenticated via `authMiddleware`): validates `{ preferredLanguage: 'en' | 'vi' }`, updates `users.preferredLanguage`, returns `{ preferredLanguage }`.
   - `authController`:
     - `register`: persist `preferredLanguage: req.lang || existingUser?.preferredLanguage || 'en'` on both insert and unverified-reclaim branches.
     - `googleLogin`: initialize `preferredLanguage: req.lang || 'en'` on new user creation.
     - `login`, `googleLogin`, and `refresh` (which projects `{ name: 1, email: 1, preferredLanguage: 1 }`): include `preferredLanguage: user.preferredLanguage || 'en'` in the response body.
4. **Standardized Error Codes**:
   - `server/src/middleware/validate.js` and controllers return `{ code: 'ERROR_CODE', message: '...' }` on error responses (`4xx`/`5xx`) while keeping `message` in English for logs and backward compatibility.
5. **Bilingual Emails (`server/src/utils/emailTemplates.js` + `authController.js`)**:
   - Verification (`24h` TTL) and password-reset (`1h` TTL) emails accept `lang` (`existingUser?.preferredLanguage || req.lang || 'en'` in `register`; `user.preferredLanguage || req.lang || 'en'` in `requestPasswordReset`), escape `name` against HTML injection, and return `{ subject, html, text }` preserving the existing styled FitTrack email layout.
6. **Bilingual Exercise Search (`exerciseController.js` & `createFitTrackMcpServer.js`)**:
   - Both `exerciseController.searchExercises` and the MCP `search_exercises` tool match `$regex` via `$or` against `name` and `translations.vi.name`.
7. **Admin Catalog Management (`adminExerciseController.js`, `muscleGroupController.js`, `server/src/public/admin/`)**:
   - Accept optional `translations.vi.name` (and `translations.vi.instructions` for exercises) on create/update; allow clearing translations by submitting empty strings.
   - `ensureSeeded` in `muscleGroupController.js` seeds and backfills default `translations.vi.name` for the 14 built-in muscle groups.
   - Admin UI (`#ex-name-vi`, `#ex-instructions-vi`, `#grp-name-vi`) displays `VI ✓` / `VI —` status badges, supports searching by Vietnamese name, and resets VI inputs in `resetGroupForm()`.
8. **AI Coach (`systemPrompt.js`, `aiAgentService.js`, `aiController.js`)**:
   - Pass `lang` (`req.lang || 'en'`) into `runAiChatTurn` → `buildSystemPrompt(memories, lang)` and localize fallback assistant strings in `aiAgentService.js`.
   - When `lang === 'vi'`, instruct Gemini to respond in natural Vietnamese, pass canonical English `category` names to `search_exercises`, and call `search_fitness_knowledge` with focused English queries against the English RAG corpus.

### 3.2 Frontend (`client/`)
1. **i18n Setup (`client/src/i18n/index.js` & `client/src/setupTests.js`)**:
   - `i18next` + `react-i18next` + `i18next-browser-languagedetector`.
   - `fallbackLng: 'en'`, `supportedLngs: ['en', 'vi']`, `load: 'languageOnly'`, `detection: { order: ['localStorage'], caches: ['localStorage'] }`.
   - Namespaces: `common`, `auth`, `dashboard`, `workout`, `plan`, `progress`, `profile`, `ai`, `errors`.
   - Import `'./i18n'` in `client/src/index.js` and `client/src/setupTests.js` so existing React Testing Library suites run cleanly with English defaults.
2. **Axios Interceptor & Error Helper (`client/src/api/axiosClient.js` & `client/src/utils/localize.js`)**:
   - Attach `Accept-Language: i18n.resolvedLanguage || 'en'` on every request.
   - `getApiErrorMessage(err, t)` reads `err.response?.data?.code` and maps via `t(\`errors:\${code}\`)` with fallback to `err.response?.data?.message`.
3. **Auth Synchronization (`client/src/api/index.js` & `client/src/context/AuthContext.jsx`)**:
   - `buildUser(data)` in `client/src/api/index.js` preserves `preferredLanguage: data.preferredLanguage || 'en'`; expose `userAPI.updateLanguage(preferredLanguage)`.
   - On login / `refreshSession` / stored-user bootstrap, `AuthContext` syncs `i18n.changeLanguage(user.preferredLanguage)` if present.
   - `LanguageSwitcher` component updates `i18n.changeLanguage(lang)`, calls `userAPI.updateLanguage(lang)` when authenticated, and updates `AuthContext` user state.
4. **Localization & Formatting Utilities**:
   - `client/src/utils/localize.js`:
     - `getLocalizedField(item, field, lang)` with automatic fallback to English.
     - `getLocalizedExerciseName(item, exercisesCatalog, lang)` & `getLocalizedMuscleGroupName(categoryName, muscleGroupsCatalog, lang)` to resolve embedded workout/plan/schedule snapshots (`{ exerciseId, exerciseName, category }`) against cached catalogs.
     - `getApiErrorMessage(error, t)` for standardized API error translation.
   - `client/src/utils/formatters.js`: `formatDate` and `formatNumber` via `Intl.DateTimeFormat` / `Intl.NumberFormat`.

---

## 4. Verification Strategy

- **Server unit & integration tests (`npm test` in `server/`)**:
  - `localeMiddleware` header parsing (`vi`, `vi-VN`, `en`, missing, unsupported).
  - `PATCH /api/users/language` validation & persistence, plus `preferredLanguage` returned in `login`, `googleLogin`, and `refresh`.
  - `adminExerciseController` & `muscleGroupController` saving/clearing `translations.vi`, default muscle group VI seeding, and `exerciseController.searchExercises` + MCP `search_exercises` matching Vietnamese names.
  - `emailTemplates` rendering `en` & `vi` with HTML escaping, `text` fallback, and 24h/1h expiry copy.
  - `buildSystemPrompt(memories, 'vi')` retaining English RAG query rule + Vietnamese response rule.
- **Client tests (`npm test -- --watchAll=false` in `client/`)**:
  - `getLocalizedField`, `getLocalizedExerciseName`, `getLocalizedMuscleGroupName`, and `getApiErrorMessage` unit tests.
  - `axiosClient` attaching `Accept-Language` header.
  - Existing page/component tests passing with `i18n` initialized in `setupTests.js`.
