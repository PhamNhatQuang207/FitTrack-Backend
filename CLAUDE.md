# CLAUDE.md — FitTrack Backend (`server/`)

Engineering rules and architecture invariants for AI agents working in `FitTrack-Backend`.

## Stack & Commands

- **Runtime:** Node.js 24, CommonJS (`require` / `module.exports`), Express 5 (`src/app.js`).
- **Database:** Native `mongodb` driver (`getDb().collection(...)` in `src/config/db.js`) — **never introduce an ODM/ORM**.

```bash
npm run dev              # Local dev server (nodemon, port 5000)
npm start                # Production entrypoint (node src/app.js)
npm test                 # Full unit + integration + E2E suite (jest --runInBand)
npm run test:unit        # Unit tests
npm run test:integration # Integration tests (mongodb-memory-server)
npm run test:e2e         # End-to-end tests
npm run seed             # Seed exercises from src/seeds/exercises.seed.js
npm run ingest:knowledge # Embed & ingest src/data/knowledge/*.md into knowledge-chunks
```

- `src/app.js` calls `startServer()` **only** when `require.main === module` so Supertest can drive `app` without binding a port. Keep that guard intact.
- Always run `npm test` before marking backend work complete.

## MongoDB & Data Rules

Exact collection names (note hyphens vs underscores):
- `users`, `refresh-tokens`, `exercises`, `muscle_groups`, `workouts`, `workout-sessions`, `weekly-plans`, `weekly-schedules`, `ai-conversations`, `ai-memories`, `knowledge-chunks`, `site_configs`.

Rules:
- Convert string IDs with `new ObjectId(id)` and validate route `:id` params with `ObjectId.isValid(...)` first, returning `400` on invalid IDs (never `500`).
- User body metrics (`weightHistory`, `bodyFatHistory`) live inside `users` documents (`progressController.js`).
- `src/data/exercise.json` is reference data only — `npm run seed` reads `src/seeds/exercises.seed.js`.

## Security & Auth Invariants

1. **IDOR & Mass Assignment Prevention:**
   - User-facing routes must scope every read/update/delete filter by `req.userId` from `authMiddleware.js` — never trust `userId` from `req.body`, `req.query`, or `req.params`.
   - Explicitly pick/whitelist allowed fields on `POST`/`PUT`/`PATCH` handlers; never spread raw `req.body` into `$set` or `insertOne`.
2. **Dual-Client Auth (`src/utils/refreshToken.js`, `src/controllers/authController.js`):**
   - Access JWTs are HS256 (`15m` default); refresh tokens are 7-day single-use rotating tokens stored as SHA-256 hashes in `refresh-tokens`.
   - **Web:** `HttpOnly` cookie `fittrack_refresh` (`Path=/api/auth`) protected by `verifyCookieCsrfOrigin`.
   - **Mobile (`X-Client-Type: mobile`):** returns `refreshToken` in JSON body and sets **no** cookies; `/refresh` and `/logout` must read `req.body.refreshToken` only and never fall back to `Cookie` headers when `X-Client-Type: mobile` is set.
3. **Anti-Enumeration:**
   - Duplicate `POST /api/auth/register` on a verified user must return the exact same `201` response, leave DB state untouched, and email the stored `existingUser.email` / `existingUser.name` (never `req.body.name`) via `buildAccountExistsEmail` with **zero tokens**.
   - `POST /api/auth/request-password-reset` on a Google-only account (`!user.password`) must return the same generic `200`, write no reset token, and email `buildGoogleResetNoticeEmail` with **zero tokens**; non-existent emails remain silent.
4. **Defensive Helpers:**
   - Always use `safeServerError(res, context, error)` (`src/utils/security.js`) — never return raw error stacks or DB internals.
   - Validate admin/user-supplied URLs with `isSafeHttpUrl(...)`.
   - Escape user input before building Mongo `$regex` queries (`escapeRegex`).
   - Keep `rateLimiter.js` fail-closed (skipped **only** when `NODE_ENV === 'development'`), and keep `mcpLimiter` before `mcpAuthMiddleware` on `/mcp`.
   - Add new frontend origins to `ALLOWED_ORIGINS` in `src/utils/security.js` (used by both CORS and cookie CSRF checks).

## Email Templates (`src/utils/emailTemplates.js`)

- All email builders (`buildVerificationEmail`, `buildResetPasswordEmail`, `buildAccountExistsEmail`, `buildGoogleResetNoticeEmail`) must remain bilingual (`en` / `vi`), escape user-controlled strings with `escapeHtml(...)`, and output both `html` and plain-text `text` (forwarded by `src/utils/sendEmailResend.js`).
- Preserve the email-client-safe table layout matching FitTrack's dark sporty UI (`#050505`, `#0A0A0A`, `#111111`, `#CCFF00`, `#FF5C00`, `2px` radii, table-based `F` badge — **no `<svg>` tags**).

## AI Coach, RAG, MCP & Caching

- Keep AI Coach tool calls silent and preserve all guards in `src/services/ai/guards/` (`inputGuard`, `executionLoopGuard`, `groundingAndSchemaGuard`). Never fabricate exercise IDs or citations.
- When updating Admin mutations (`exercises`, `muscle_groups`, `site_configs`), invalidate `publicDataCache` (`src/utils/memoryCache.js`).

## Deployment & Git Hygiene

- Deployed on **Northflank** (`api.fittrack.io.vn`) from `/Dockerfile` (`node:24-alpine` + `tini`, port `5000`, `/api/health` readiness probe). Keep `app.set('trust proxy', 1)` aligned with Northflank's single Envoy edge hop.
- Always run `git fetch origin` and branch new work from `origin/master`. Never commit `.env` or credentials.
