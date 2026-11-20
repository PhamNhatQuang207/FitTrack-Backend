# FitTrack Backend API

RESTful API, AI Coach & Hybrid RAG engine, Streamable HTTP MCP server, and Admin Control Center for the **FitTrack** platform.

- **Live API:** https://api.fittrack.io.vn
- **Live Web App:** https://fittrack.io.vn (and https://www.fittrack.io.vn)
- **Admin Control Center:** https://api.fittrack.io.vn/admin
- **Hosted On:** Northflank (`/Dockerfile`, port `5000`) + MongoDB Atlas

---

## Key Features

- **Authentication & Dual-Client Sessions**
  - Email/password signup with SHA-256 hashed 24-hour verification tokens (`isVerified` required before login).
  - Google OAuth (`google-auth-library`) supporting Web, Android, and iOS client IDs (`GOOGLE_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_CLIENT_IDS`).
  - Short-lived HS256 access JWT (`15m` default) + single-use 7-day rotating refresh tokens stored hashed (`sha256`) in MongoDB (`refresh-tokens` TTL index):
    - **Web:** `HttpOnly` `fittrack_refresh` cookie (`Path=/api/auth`) protected by `verifyCookieCsrfOrigin`.
    - **Mobile (`X-Client-Type: mobile`):** JSON body `refreshToken` without setting cookies.
  - **OWASP Anti-Enumeration Owner Notices:** Duplicate verified signups and password-reset requests on Google-only accounts preserve identical HTTP responses and leave the database untouched while sending token-free guidance emails (`en` / `vi`).
- **Bilingual Transactional Emails (`src/utils/emailTemplates.js`)**
  - Dark sporty HTML templates (`#050505`, `#0A0A0A`, `#CCFF00`, `#FF5C00`) + plain-text fallbacks via **Resend** (production) or **Nodemailer SMTP** (development) through `sendEmailSmart.js`.
- **Training, Plans, Schedules & Analytics**
  - Workout sessions (`workout-sessions`), logged workouts (`workouts`), reusable 7-day plans (`weekly-plans`), active weekly schedule execution (`weekly-schedules`), body metrics (`users` progress), and strength progression analytics (`analytics`).
- **AI Coach & Hybrid RAG (`src/services/ai/`, `src/services/rag/`)**
  - Powered by `@google/genai` (default `gemini-2.5-flash`, configurable via `GEMINI_MODEL`) with hybrid semantic + keyword search (`knowledge-chunks`, `gemini-embedding-2`) over curated sports-science documents in `src/data/knowledge/`.
  - Persistent conversations (`ai-conversations`), user memories (`ai-memories`), draft weekly plan generation with one-click apply, and multi-stage safety guards (`inputGuard`, `executionLoopGuard`, `groundingAndSchemaGuard`).
- **MCP Streamable HTTP Server (`/mcp`)**
  - `@modelcontextprotocol/sdk` transport authenticated per user via `X-Mcp-Api-Key` (`users.mcpApiKeyHash`), rate-limited before authentication and database lookup.
- **Admin Control Center (`/admin` & `/api/admin/*`)**
  - Isolated admin JWT auth (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) to manage bilingual muscle groups (including merge tooling), bilingual exercises, and `site_configs` (`heroBackgroundUrl`, `announcementBanner`, `featuredNote`), with in-memory LRU cache invalidation.
- **Localization & Caching**
  - `Accept-Language` (`en` / `vi`) middleware (`localeMiddleware.js`) and in-memory LRU TTL caches (`src/utils/memoryCache.js`).

---

## Tech Stack

| Component | Package / Version | Purpose |
|---|---|---|
| **Runtime** | Node.js 24 (`node:24-alpine`) | CommonJS runtime (`tini` entrypoint in Docker) |
| **Web Framework** | `express` ^5.2.1 | HTTP API & static `/admin` serving |
| **Database** | `mongodb` ^7.0.0 | Native MongoDB driver (no ODM) |
| **Auth & Security** | `jsonwebtoken` ^9.0.3, `bcryptjs` ^3.0.3, `helmet` ^8.1.0, `express-rate-limit` ^8.2.1, `cors` ^2.8.5 | HS256 JWTs, bcrypt hashing, security headers, rate limiting, CORS |
| **Validation** | `express-validator` ^7.3.1, `zod` ^4.6.7 | Request validation & AI/MCP schema guards |
| **Google OAuth** | `google-auth-library` ^11.3.4 | Multi-audience ID token verification |
| **AI & MCP** | `@google/genai` ^3.3.0, `@modelcontextprotocol/sdk` ^1.32.2 | Gemini AI Coach, embeddings RAG, MCP HTTP server |
| **Email** | `resend` ^6.6.0, `nodemailer` ^10.6.0 | Resend (prod) / SMTP (dev) email delivery |
| **API Docs** | `swagger-jsdoc` ^6.2.8, `swagger-ui-express` ^5.0.1 | OpenAPI UI at `/api-docs` (non-prod or `ENABLE_SWAGGER=true`) |
| **Testing** | `jest` ^29.7.0, `supertest` ^7.2.2, `mongodb-memory-server` ^10.4.3 | Unit, integration, and E2E tests |

---

## Project Structure

```text
server/
├── .github/workflows/pipeline.yaml   # CI: Jest suite (Node 24 + Ubuntu 22.04) & Docker build check
├── Dockerfile                        # Production container (node:24-alpine + tini, port 5000)
├── docker-compose.yml                # Local MongoDB 8.0 container (port 27017)
├── jest.config.js
├── scripts/verify-security.js        # Security smoke-check script
├── src/
│   ├── app.js                        # Express setup, middleware, routes, /api/health, /mcp
│   ├── seed.js                       # Seeds exercises from src/seeds/exercises.seed.js
│   ├── config/
│   │   ├── db.js                     # Native MongoClient + index creation (refresh-tokens, users)
│   │   └── swagger.js                # OpenAPI 3.0 spec
│   ├── controllers/                  # Route handlers (auth, user, workout, workoutSession, weeklyPlan,
│   │                                 # weeklySchedule, exercise, muscleGroup, progress, analytics,
│   │                                 # ai, siteConfig, adminAuth, adminExercise)
│   ├── data/
│   │   ├── exercise.json             # Reference exercise dataset
│   │   └── knowledge/*.md            # Sports-science markdown sources for RAG
│   ├── mcp/                          # Streamable HTTP MCP transport & tool server
│   ├── middleware/                   # authMiddleware, adminMiddleware, mcpAuthMiddleware,
│   │                                 # localeMiddleware, rateLimiter, validate
│   ├── public/admin/                 # Static Admin Control Center UI (/admin)
│   ├── routes/                       # Express routers mounted in src/app.js
│   ├── scripts/                      # ingestKnowledge.js, evalRag.js, migrateUsers.js,
│   │                                 # cleanupTestUsers.js, mergeMiddleBackIntoTraps.js
│   ├── seeds/exercises.seed.js       # Canonical exercise seed data
│   ├── services/
│   │   ├── ai/                       # aiAgentService, geminiClient, systemPrompt, guards/
│   │   └── rag/                      # chunker, embeddingClient, knowledgeSearchService, vectorMath
│   └── utils/                        # refreshToken, security, memoryCache, emailTemplates,
│                                     # sendEmailSmart, sendEmailResend, sendEmail, verifyGoogleToken
└── tests/
    ├── unit/                         # Guard, middleware, cache, template, RAG unit tests
    ├── integration/                  # Supertest + mongodb-memory-server route tests
    ├── e2e/                          # End-to-end auth, training, AI/RAG, MCP, security flows
    ├── fixtures/ragEvalDataset.json
    └── setup/                        # testDb.js, env.js, helpers.js
```

---

## Local Development Setup

### Prerequisites
- Node.js **24+** (`24.18.0` in CI) and `npm`
- Docker (or a local MongoDB 7+/8 instance / MongoDB Atlas URI)

### Steps

```bash
# 1. Install dependencies
npm ci

# 2. Start local MongoDB 8.0 (optional if using MongoDB Atlas)
docker compose up -d

# 3. Configure environment variables
cp .env.example .env
# Edit .env with MONGO_URI, DB_NAME, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, etc.

# 4. Seed exercises and ingest RAG knowledge chunks (optional)
npm run seed
npm run ingest:knowledge   # requires GEMINI_API_KEY for embeddings

# 5. Start dev server (auto-reload via nodemon)
npm run dev
```

Local server defaults to `http://localhost:5000` (Swagger UI at `http://localhost:5000/api-docs`).

---

## Environment Variables

| Variable | Default / Required | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP listen port |
| `NODE_ENV` | `development` / `production` | Controls rate limiting (off only when `development`), Swagger, secure cookies |
| `MONGO_URI` | Required | MongoDB connection string |
| `DB_NAME` | `FitTrackDB` | Target MongoDB database |
| `JWT_SECRET` | Required | HS256 signing secret for user & admin JWTs |
| `ACCESS_TOKEN_EXPIRES_IN` | `15m` | Short-lived access token lifetime |
| `FRONTEND_URL` | `http://localhost:3000` | Base URL used in verification, reset, and login email links |
| `COOKIE_SAME_SITE` | `none` (prod) / `lax` (dev) | Override refresh cookie `SameSite` policy |
| `COOKIE_DOMAIN` | Unset | Optional cookie domain attribute |
| `ENABLE_SWAGGER` | Unset | Set `true` to expose `/api-docs` in production |
| `EMAIL_SERVICE` | Auto (`resend` in prod, `smtp` in dev) | Force `resend` or `smtp` |
| `RESEND_API_KEY` | Required for Resend | Resend API key |
| `EMAIL_FROM` | `FitTrack <noreply@mail.fittrack.io.vn>` | Verified sender address |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD` | SMTP fallback | Gmail/SMTP credentials (`EMAIL_PORT` defaults to `587`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_CLIENT_IDS` | Optional | Allowed Google OAuth client IDs (`GOOGLE_CLIENT_IDS` comma-separated) |
| `GEMINI_API_KEY` | Required for AI/RAG | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model ID for AI Coach |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | Gemini model ID for RAG embeddings |
| `RAG_SEARCH_MODE` | `auto` | RAG search mode override |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Required for `/admin` | Credentials for `/api/admin/login` |

> **Note:** Allowed CORS origins (`ALLOWED_ORIGINS`) are configured in `src/utils/security.js`, and rate limits are configured in `src/middleware/rateLimiter.js`.

---

## API Endpoints Overview

| Prefix / Path | Auth | Highlights |
|---|---|---|
| `GET /api/health` | Public | Liveness / readiness probe |
| `/api/auth/*` | Mixed + CSRF on cookie endpoints | `POST /register`, `POST /login`, `GET /verify-email/:token`, `POST /request-password-reset`, `POST /reset-password/:token`, `POST /google`, `POST /refresh`, `POST /logout` |
| `/api/users/*` | Bearer JWT | `GET /progress`, `POST /progress`, `PATCH /language` |
| `/api/workouts` | Bearer JWT | `GET /`, `POST /` |
| `/api/workout-sessions/*` | Bearer JWT | `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `PATCH /:id/start`, `PATCH /:id/complete`, `POST /:id/log-set` |
| `/api/weekly-plans/*` | Bearer JWT | `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id` |
| `/api/weekly-schedules/*` | Bearer JWT | `POST /start`, `GET /`, `GET /current`, `GET /:id`, `PATCH /:id/complete-day`, `PATCH /:id/complete`, `PATCH /:id/update-day` |
| `/api/exercises/*` | Public / Localized | `GET /`, `GET /search`, `GET /category/:category`, `GET /:id` |
| `GET /api/muscle-groups` | Public (cached) | Active localized muscle groups |
| `GET /api/site-config` | Public (cached) | Hero background, announcement banner, featured note |
| `/api/analytics/*` | Bearer JWT | `GET /strength-progression/:exerciseName`, `GET /user-exercises`, `GET /workout-stats`, `GET /weekly-progress` |
| `/api/ai/*` | Bearer JWT + `aiChatLimiter` on `/chat` | `POST /chat`, conversations CRUD, `POST /conversations/:id/messages/:messageId/apply-plan`, memories (`GET`, `DELETE`), MCP key (`GET`, `POST`, `DELETE /mcp-key`) |
| `/api/admin/*` | Admin JWT (`POST /login` public) | CRUD muscle groups (+ merge), CRUD exercises + active toggle, `PUT /site-config` |
| `ALL /mcp` | `X-Mcp-Api-Key` + `mcpLimiter` | Streamable HTTP MCP transport |
| `/admin`, `/api-docs` | Static / Non-prod Swagger | Admin UI and OpenAPI documentation |

---

## MongoDB Collections

All database operations go directly through `getDb().collection(...)` in `src/config/db.js`:

- `users` (sparse index on `mcpApiKeyHash`)
- `refresh-tokens` (unique index on `tokenHash`, TTL index on `expiresAt`)
- `exercises`
- `muscle_groups`
- `workouts`
- `workout-sessions`
- `weekly-plans`
- `weekly-schedules`
- `ai-conversations`
- `ai-memories`
- `knowledge-chunks`
- `site_configs`

---

## Scripts, Testing & CI/CD

### Available Scripts

```bash
npm run dev              # Start with nodemon
npm start                # Start production server (node src/app.js)
npm test                 # Run full Jest suite (--runInBand)
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests (--runInBand)
npm run test:e2e         # Run E2E tests (--runInBand)
npm run test:coverage    # Run full suite with coverage
npm run seed             # Seed exercises collection
npm run ingest:knowledge # Chunk & embed src/data/knowledge/*.md into knowledge-chunks
npm run eval:rag         # Evaluate RAG retrieval against tests/fixtures/ragEvalDataset.json
```

### CI/CD & Production Deployment
- **GitHub Actions (`.github/workflows/pipeline.yaml`):** Runs on pushes and PRs to `master` — installs deps on Node `24.18.0` (`ubuntu-22.04`, `MONGOMS_VERSION=7.0.14`), executes `npm test`, and validates the production `Dockerfile` build.
- **Northflank:** Deploys directly from `master` using `/Dockerfile` (`node:24-alpine` + `tini`, non-root `node` user, port `5000`) behind `api.fittrack.io.vn` with an HTTP readiness probe on `/api/health`.
