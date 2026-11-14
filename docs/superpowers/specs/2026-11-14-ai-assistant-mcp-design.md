# FitTrack AI Assistant & MCP Server Design

**Date:** 2026-11-14
**Status:** Approved
**Branch:** `feat/ai-assistant-mcp` (both `server` and `client`)

---

## 1. Goals & Scope

Build a learning-focused, production-structured AI Coaching Assistant in FitTrack that can:
1. **Analyze user progress** using real MongoDB training data (`workout-sessions`, `users` body metrics, active `weekly-schedules`).
2. **Schedule & update weekly workout plans** through natural multi-turn conversation, proactively asking follow-up questions (slot-filling) until sufficient scheduling constraints are collected.
3. **Expose a real MCP Server** (`@modelcontextprotocol/sdk`) mounted at `/mcp` via Streamable HTTP while sharing the exact same MCP server factory internally with the backend Gemini Chat Agent via `InMemoryTransport`.
4. **Enforce multi-layer Guards** across input, authentication, tool execution, slot-filling, exercise grounding, and human-in-the-loop confirmation before writing plans.
5. **Persist conversation history (`ai-conversations`) and long-term user fitness memory (`ai-memories`)**, surfaced via a **floating corner chat widget** across authenticated pages.

### Non-Goals (YAGNI for v1)
- No vector database / embedding RAG pipeline (structured MongoDB queries and capped per-user memory list are exact and cheaper for FitTrack's data size).
- No autonomous mutation of `weekly-plans` or `weekly-schedules` without explicit user confirmation in the FitTrack UI.
- No audio/voice input or image/form-check analysis.

---

## 2. Architecture Overview

Both internal chat requests and external MCP clients talk to **one shared MCP Server factory**:

```text
[React Floating Widget] ──JWT──▶ POST /api/ai/chat
                                        │
                                        ▼
                       [InputGuard + Conversation/Memory Loader]
                                        │
                                        ▼
                       [Gemini Agent Host (geminiService)]
                          ▲   │ (InMemoryTransport)
                          │   ▼
[External MCP Client] ──JWT──▶ ALL /mcp (StreamableHTTPServerTransport)
                                        │
                                        ▼
                        createFitTrackMcpServer({ db, userId })
                          │   (Zod + Auth + Grounding Guards)
                          ▼
                                    [MongoDB]
```

### Key Architectural Choices
- **Shared `McpServer` factory (`src/mcp/createFitTrackMcpServer.js`)**: Accepts `{ db, userId }` and registers all MCP tools with Zod schemas. `userId` is bound strictly in closure from verified JWT — never exposed as a tool parameter.
- **Internal Agent transport**: Uses `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk` so `/api/ai/chat` speaks real MCP (`client.listTools()`, `client.callTool()`) without HTTP loopback latency or Render self-call issues.
- **External `/mcp` transport**: Mounted on Express `app.all('/mcp', authMiddleware, aiLimiter, ...)` using stateless `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` so requests survive server restarts and horizontal scaling.
- **LLM Provider**: Google Gemini API via `@google/genai` (configured by `GEMINI_API_KEY`, optional `GEMINI_MODEL` defaulting to `gemini-2.5-flash`). Missing `GEMINI_API_KEY` returns `503` on `/api/ai/chat` without affecting core FitTrack features or `/mcp`.

---

## 3. MCP Tools Specification

All tools live under `src/mcp/tools/` and return MCP-compliant `{ content: [{ type: 'text', text }], isError?: boolean }` payloads (plus structured JSON serialized in text for the Gemini host and external clients).

| Tool Name | Purpose | Input Schema (Zod) | Side Effects / Guards |
|---|---|---|---|
| `get_user_profile` | Read body metrics & profile | `{}` | Read-only from `users` (`name`, `age`, `sex`, `height`, latest `weightHistory`, `bodyFatHistory`) |
| `get_progress_analytics` | Summarize sessions, adherence, volume & strength progression | `{ weeksBack?: int (1..12, default 6), exerciseName?: string }` | Read-only aggregation over `workout-sessions` (`date >= now - weeksBack`, case-insensitive escaped `exerciseName`) and adherence (`completedDays / totalWorkoutDays`) from `weekly-schedules` for `userId` |
| `search_exercises` | Look up real active exercises | `{ category?: string, query?: string, limit?: int (1..30, default 15) }` | Read-only from `exercises` (`isActive: { $ne: false }`) and `muscle-groups` |
| `get_weekly_plans` | Inspect saved templates & active schedule | `{ includeActiveSchedule?: boolean (default true) }` | Read-only from `weekly-plans` and current active `weekly-schedules` for `userId` |
| `propose_weekly_plan` | Build a validated 7-day **Draft Create** payload to create a new plan & start a new weekly schedule | `{ name, description?, days[7] }` | Validates all `exerciseId`s exist & active in DB (stored as 24-char hex string), normalizes `exerciseName`, `category`, non-empty `workout.name`, and `sets: [{ setNumber, targetReps, targetWeight }]`, enforces 7 days `0..6`. Does **not** insert into DB until confirmed |
| `edit_weekly_schedule` | Build a validated 7-day **Draft Schedule Update** payload to modify the user's currently active `weekly-schedules` | `{ scheduleId?, name?, days[7] }` | Verifies an active `weekly-schedules` record exists & belongs to `userId` (auto-resolves current week's active schedule if `scheduleId` omitted); runs same exercise/7-day grounding guard while preserving `isCompleted` / `actualSets` on already-completed days unless explicitly changed. Does **not** mutate DB until confirmed |
| `save_user_memory` | Upsert a concise long-term fitness fact | `{ category: 'goal' \| 'schedule' \| 'equipment' \| 'injury' \| 'preference', key, value }` | Memory Guard: max 25 facts/user, max 200 chars/value, rejects sensitive PII / prompt-override text |
| `delete_user_memory` | Remove an outdated user memory fact | `{ category, key }` | Scoped to `{ userId, category, key }` in `ai-memories` |

---

## 4. Multi-Layer Guards (`src/services/ai/guards/`)

1. **`inputGuard.js`**
   - Trims input, enforces non-empty string `<= 1500` chars.
   - Blocks explicit prompt-injection / jailbreak phrases (e.g., system prompt extraction, role override, `ignore previous instructions`, developer mode patterns).
   - Context-aware domain check: does **not** use brittle keyword filtering on follow-up turns or short slot-filling replies (e.g., `"4 buổi/tuần, 45p"`, `"thứ 2 4 6"`, `"ok lưu giúp mình"`). Nuanced off-topic refusal is handled by the Gemini System Instruction so multi-turn scheduling conversations never suffer false-positive `400` blocks.

2. **`authAndToolSchemaGuard.js`**
   - JWT verified by `authMiddleware` sets `req.userId` for both `/api/ai/*` and `/mcp`.
   - Every MCP tool binds `userId` from auth closure; Zod rejects invalid input types/ranges; `edit_weekly_schedule` checks active schedule ownership before returning a draft.

3. **`slotFillingPolicy` (System Instruction + Context Check)**
   - Before calling `propose_weekly_plan` (or major rescheduling via `edit_weekly_schedule`), the assistant must first check `ai-memories`, `get_user_profile`, `get_weekly_plans`, and `get_progress_analytics` so it does not re-ask known facts, then verify 4 required scheduling slots:
     1. Primary goal (hypertrophy / strength / fat loss / general fitness)
     2. Weekly frequency & available/rest days
     3. Session duration (e.g., 30 / 45 / 60 / 90 mins)
     4. Available equipment / setting & injuries or movement restrictions
   - If critical slots are missing, the model must ask 1–3 concise clarifying questions instead of guessing a schedule.

4. **`executionLoopGuard.js`**
   - Caps each chat turn at `MAX_AGENT_STEPS = 5` model-to-tool rounds and enforces a `25000ms` overall loop timeout.
   - Prevents infinite identical tool calls (blocks repeating the exact same `{ toolName, serializedArgs }` more than twice per turn, returning a clear MCP error hint to the model).
   - Tracks `toolTrace` (`[{ name, status }]`) for transparency and debugging.

5. **`groundingAndSchemaGuard.js`**
   - **Exercise Grounding**: Validates every `exerciseId` in `propose_weekly_plan` / `edit_weekly_schedule` against `exercises` (`isActive: { $ne: false }`), normalizing `exerciseId` to a 24-char hex string and overwriting `exerciseName` and `category` with authoritative DB values. Hallucinated IDs return `{ isError: true }` so the model retries via `search_exercises`.
   - **Weekly Plan & Schedule Structure**: Enforces exact 7-day layout (`dayOfWeek: 0..6`, `Monday..Sunday`, `isRestDay`, `workout: null | { name, exercises: [{ exerciseId, exerciseName, category, sets: [{ setNumber, targetReps, targetWeight }] }] }`) matching `src/controllers/weeklyPlanController.js`, `src/controllers/weeklyScheduleController.js`, and `WeeklyPlanBuilder.jsx`:
     - Any day with empty `exercises` (`[]`) is automatically normalized to `isRestDay: true, workout: null`.
     - Any non-rest day (`isRestDay: false`) must have a non-empty `workout.name.trim()`.
   - **Human-in-the-Loop Confirmation**: `propose_weekly_plan` and `edit_weekly_schedule` return a validated draft payload stored on the assistant message; DB writes happen only when the user explicitly clicks Confirm/Apply in the UI (`POST /api/ai/conversations/:id/messages/:messageId/apply-plan`).

---

## 5. Data Models (MongoDB)

### `ai-conversations`
```js
{
  _id: ObjectId,
  userId: ObjectId,
  title: String, // auto-derived from first user message
  createdAt: Date,
  updatedAt: Date,
  messages: [
    {
      id: String, // UUID / string ID
      role: 'user' | 'assistant',
      text: String,
      toolTrace: [{ name: String, status: 'ok' | 'error' }],
      draftPlan: {
        mode: 'create_schedule' | 'edit_schedule',
        targetScheduleId: String | null,
        targetPlanId: String | null,
        targetPlanName: String | null,
        plan: {
          name: String,
          description: String,
          days: Array // 7 days matching weekly-plans / weekly-schedules schema
        },
        appliedScheduleId: String | null,
        appliedPlanId: String | null,
        appliedAt: Date | null
      } | null,
      createdAt: Date
    }
  ]
}
```
- **Context Window & Indexing**: Indexed on `{ userId: 1, updatedAt: -1 }`. Only the latest **14 messages** from `messages` are sent to Gemini per turn; full history remains persisted for review (capped at 100 messages per conversation via `$slice: -100`).

### `ai-memories`
```js
{
  _id: ObjectId,
  userId: ObjectId,
  category: 'goal' | 'schedule' | 'equipment' | 'injury' | 'preference',
  key: String,   // normalized snake_case
  value: String, // <= 200 chars
  updatedAt: Date
}
```
- Unique index on `{ userId: 1, category: 1, key: 1 }`; max 25 records per user. All active user memories are formatted and injected into the system prompt at the start of every chat turn.

---

## 6. REST Endpoints & Error Handling

### Backend Routes (`src/routes/aiRoutes.js`, mounted at `/api/ai`)
All routes guarded by `authMiddleware`; `POST /api/ai/chat` is additionally guarded by `aiChatLimiter` (30 requests / 15 min in production, bypassed when `NODE_ENV === 'development'`):
- `POST /api/ai/chat` — `{ conversationId?, message }` → `{ conversationId, userMessage, assistantMessage, memoriesUpdated }`
- `GET /api/ai/conversations` — list user's conversations (`id`, `title`, `updatedAt`, `messageCount`)
- `GET /api/ai/conversations/:id` — full conversation with messages
- `DELETE /api/ai/conversations/:id` — delete conversation (scoped by `userId`)
- `GET /api/ai/memories` — list user's long-term memories
- `DELETE /api/ai/memories/:id` — delete a memory fact (scoped by `userId`)
- `POST /api/ai/conversations/:id/messages/:messageId/apply-plan` — re-validates `draftPlan` and executes according to `draftPlan.mode`:
  - **`mode === 'create_schedule'` (`propose_weekly_plan`)**: Inserts a new template into `weekly-plans` **and** starts a new active `weekly-schedules` for the current week (marking any existing active schedule for the current week as superseded/replaced so the new schedule takes effect immediately).
  - **`mode === 'edit_schedule'` (`edit_weekly_schedule`)**: Updates the user's currently active `weekly-schedules` document (recalculating `totalWorkoutDays` while preserving `isCompleted` / `actualSets` on already-completed days) and syncs its linked `weekly-plans` template if present.
  - Marks `appliedScheduleId`, `appliedPlanId`, and `appliedAt` on the message (returns `409` if already applied).

### MCP Endpoint (`src/app.js`)
- `ALL /mcp` (`authMiddleware`, `mcpLimiter` at 120 req / 15 min in production) → handles MCP Streamable HTTP requests for the authenticated `userId`.
- CORS `allowedHeaders` updated to include `'Mcp-Session-Id'` and `'Accept'`.

### Error Handling
- Missing `GEMINI_API_KEY`: `/api/ai/chat` returns `503 Service Unavailable` with actionable configuration message.
- Gemini `429` / upstream / timeout failures: return user-friendly `502`/`429` error without writing corrupted assistant messages into `ai-conversations`.
- Blocked `inputGuard` messages: return `400` with clear explanation (`error.code = 'AI_INPUT_BLOCKED'`), not saved to conversation history.

---

## 7. Frontend Architecture (`client/`)

- **`src/components/AiCoachWidget.jsx`** mounted inside `App.js` (`AuthProvider` + `Router`), visible only when `isAuthenticated === true`.
- **Corner Floating Trigger**: Bottom-right button matching FitTrack dark + `#CCFF00` aesthetic.
- **Expandable Chat Drawer/Panel**:
  - Header controls: **+ New Chat**, **History** selector (load/delete past chats), **Memory** drawer/popover (inspect & delete `ai-memories` items).
  - Empty-state quick prompts: *"Analyze my recent progress"*, *"Build a new weekly workout schedule"*, *"Edit my current week's schedule"*.
  - Assistant message extras: collapsible **Tool Trace** pills (`get_progress_analytics`, `search_exercises`, etc.) and **Draft Plan Preview Card** (7-day summary, **New Weekly Schedule** vs **Edit Active Schedule** badge, confirm button that calls `apply-plan` and links to `/weekly-schedule`).
- **`src/api/index.js`**: Add `aiAPI` client methods (`chat`, `getConversations`, `getConversation`, `deleteConversation`, `getMemories`, `deleteMemory`, `applyPlan`).

---

## 8. Testing Strategy

1. **Backend Unit Tests (`server/tests/unit/`)**:
   - `inputGuard.test.js`: length limits, prompt-injection rejections, allows short multi-turn slot-filling replies without false positives.
   - `executionLoopGuard.test.js`: `maxSteps` enforcement, duplicate tool-call loop breaker.
   - `groundingGuard.test.js`: DB exercise validation, active-only enforcement, 7-day plan/schedule schema normalization (empty exercises → `isRestDay: true`, required `workout.name`), `memoryGuard` limits & PII rejection.
2. **Backend Integration Tests (`server/tests/integration/`)** using `mongodb-memory-server` + mocked Gemini SDK:
   - `mcpEndpoint.test.js`: `InMemoryTransport` & HTTP `/mcp` auth (`401`), tool execution across `users`, `workout-sessions`, `exercises`, `weekly-plans`, `weekly-schedules`, ownership check on `edit_weekly_schedule`, hallucinated `exerciseId` rejection.
   - `aiChat.test.js`: slot-filling turn, tool-calling turn creating `draftPlan` (`create_schedule` and `edit_schedule`) + `ai-memories`, persistence in `ai-conversations`, and `apply-plan` creating/updating `weekly-schedules` + idempotency (`409` on double apply).
3. **Frontend Component Tests (`client/src/components/AiCoachWidget.test.jsx`)**:
   - Hidden when unauthenticated, renders floating trigger when authenticated, sends message, renders `toolTrace` + `draftPlan` card, triggers `applyPlan`, manages memories.
