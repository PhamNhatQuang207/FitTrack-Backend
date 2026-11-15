# FitTrack AI Coach RAG & Vector Search Design

**Date:** 2026-11-15
**Status:** Proposed
**Branch:** `feat/ai-rag-vector-search` (branched from `master`)

---

## 1. Goals & Scope

Upgrade the FitTrack AI Coaching Assistant (`src/services/ai/`, `src/mcp/`) with **Agentic RAG + Hybrid Vector Search** over a curated, English-only evidence-based fitness and nutrition knowledge base so the coach answers training, nutrition, supplement, hydration, and recovery questions with **verifiable inline citations** grounded in peer-reviewed sports science literature.

### Scope
1. **Curated English Knowledge Base (`src/data/knowledge/*.md`)**: Markdown documents with structured YAML frontmatter (`sourceId`, `title`, `topic`, `authors`, `year`, `references`).
2. **Embedding & Chunking Pipeline (`src/services/rag/`)**:
   - Heading-aware Markdown parser & chunker (`chunker.js`, ~280 max words/chunk with 45-word overlap, preserving section context and citation metadata).
   - Gemini embedding service (`embeddingClient.js`) wrapping `@google/genai` (`gemini-embedding-2`, `outputDimensionality: 768`) with `taskType` support (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`) and normalized unit vectors.
   - Idempotent ingestion CLI script (`src/scripts/ingestKnowledge.js` + `npm run ingest:knowledge`) upserting into MongoDB collection `knowledge-chunks` with `Binary` (`float32`) embedding storage to stay comfortably inside MongoDB Atlas M0's 512 MB limit.
3. **Hybrid Retrieval Engine (`knowledgeSearchService.js`)**:
   - **Atlas mode** (`RAG_SEARCH_MODE=atlas` or auto-detected): Runs MongoDB Atlas `$vectorSearch` (Index 1: `knowledge_vector_index`) and Atlas Search `$search` BM25 (Index 2: `knowledge_text_index`) in parallel, merging results with Reciprocal Rank Fusion (RRF), topic filtering, and a minimum confidence threshold.
   - **Local / Test Fallback mode** (`RAG_SEARCH_MODE=local`, used automatically in `mongodb-memory-server` tests and local Docker `mongo:8.0` dev): Computes cosine similarity over stored `Float32Array` embeddings combined with BM25-style token scoring and RRF so unit/integration tests and local development work identically without Atlas.
4. **Shared MCP Tool (`search_fitness_knowledge`)**:
   - Exposed via `createFitTrackMcpServer({ db, userId })` so both the in-app Gemini Coach (`InMemoryTransport`) and external MCP clients (`/mcp`) can retrieve cited evidence chunks.
5. **Grounded Citation Pipeline & Guard Updates**:
   - Collect `citations` returned by `search_fitness_knowledge` during `runAiChatTurn`, deduplicate by source/section, persist `citations` on `assistantMessage` in `ai-conversations`, and return `citations` in `POST /api/ai/chat`.
   - Update `systemPrompt.js` to enforce strict citation grounding (inline `[1]`, `[2]` markers, refuse to invent studies/DOIs/URLs, apply medical disclaimers for pain/injury).
   - Adjust `executionLoopGuard.js` (`DEFAULT_MAX_STEPS = 7`, `DEFAULT_TIMEOUT_MS = 35000`) to accommodate multi-step `profile + knowledge + exercise search + draft plan` turns.
6. **RAG Evaluation Harness**:
   - Offline eval script (`src/scripts/evalRag.js`) measuring Retrieval Recall@K on an English golden question set in `tests/fixtures/ragEvalDataset.json`.

### Non-Goals (YAGNI for v1)
- Multi-language (Vietnamese) knowledge corpus or cross-lingual translation layer (English-only corpus & English queries).
- Semantic vector search on `exercises` collection (kept as future Phase 2 using M0's 3rd Atlas index slot).
- Frontend React UI rendering changes (backend returns structured `citations[]` ready for UI consumption in a follow-up client PR).

---

## 2. MongoDB Atlas M0 Free Tier Budget & Index Design

- **Storage Optimization:**
  - `gemini-embedding-2` with `outputDimensionality: 768` stored as BSON `Binary` (`Float32Array`, 3,072 bytes/chunk) instead of BSON double array (~6,144+ bytes/chunk).
  - Estimated ~8–10 KB per chunk including HNSW index overhead; well within M0's 512 MB cap.
- **Atlas Indexes (uses 2 of M0's 3 Search/Vector Search index limit):**
  1. `knowledge_vector_index` (Vector Search on `knowledge-chunks`):
     - `embedding`: `type: "vector"`, `numDimensions: 768`, `similarity: "cosine"`
     - `topic`: `type: "filter"`
  2. `knowledge_text_index` (Atlas Search on `knowledge-chunks`):
     - `content`, `section`, `title`: `lucene.english`
     - `topic`: `token`

---

## 3. Data Models

### `knowledge-chunks` Collection
```js
{
  _id: ObjectId,
  chunkId: String,          // deterministic "<sourceId>#<index>"
  sourceId: String,         // e.g. "issn-protein-and-exercise-2017"
  title: String,
  topic: String,            // "training" | "nutrition" | "supplements" | "recovery"
  authors: String,
  year: Number,
  section: String,          // nearest Markdown ## heading
  references: [             // authoritative citations from document frontmatter
    { label: String, doi: String, url: String }
  ],
  content: String,          // chunk body text (with heading context prefix)
  contentHash: String,      // SHA-256 of content + metadata to skip unchanged re-embedding
  embedding: Binary,        // BSON Binary storing Float32Array (768 dims)
  updatedAt: Date
}
```

### `ai-conversations.messages[]` Addition
```js
{
  id: String,
  role: 'assistant',
  text: String,
  toolTrace: [{ name: String, status: 'ok' | 'error' }],
  draftPlan: Object | null,
  citations: [
    {
      citationNumber: Number, // 1-based index matching [1], [2]
      chunkId: String,
      sourceId: String,
      title: String,
      section: String,
      authors: String,
      year: Number,
      excerpt: String,
      references: [{ label: String, doi: String, url: String }],
      score: Number
    }
  ],
  createdAt: Date
}
```
