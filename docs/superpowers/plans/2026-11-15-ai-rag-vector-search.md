# FitTrack AI Coach RAG & Vector Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the FitTrack AI Coaching Assistant with English-only Agentic RAG + Hybrid Vector Search over curated sports-science & nutrition literature, returning structured verifiable citations from a shared MCP tool.

**Architecture:** Curated Markdown knowledge documents (`src/data/knowledge/*.md`) are parsed, heading-chunked, embedded via `@google/genai` (`gemini-embedding-2`, 768 dimensions), and stored in MongoDB (`knowledge-chunks`) using BSON `Binary` `Float32Array` vectors to fit comfortably in MongoDB Atlas M0 Free Tier (512 MB, max 3 search indexes). A retrieval service runs Hybrid Search (Atlas `$vectorSearch` + `$search` BM25 merged via Reciprocal Rank Fusion, with an automatic in-process local cosine + BM25 fallback for `mongodb-memory-server` tests and local Docker MongoDB), exposed as `search_fitness_knowledge` in `createFitTrackMcpServer` and wired into `runAiChatTurn` + `aiController` to persist grounded `citations[]`.

**Tech Stack:** Node.js (CommonJS), Express 5, MongoDB Node Driver `^7.0.0`, `@google/genai` `^3.3.0`, `@modelcontextprotocol/sdk` `^1.32.2`, `zod` `^4.6.7`, Jest `^29.7.0`, `mongodb-memory-server` `^10.4.3`.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-rag-vector-search-design.md`

## Global Constraints

- CommonJS modules (`require` / `module.exports`) throughout `server/src` and `server/tests` — no ESM `import`/`export`.
- English-only application, knowledge corpus (`src/data/knowledge/*.md`), search queries, and AI Coach responses; no cross-lingual translation dependencies.
- Zero new npm runtime dependencies (reuse `@google/genai`, `mongodb`, `zod`, Node `crypto`/`fs`/`path`).
- MongoDB Atlas M0 budget: `gemini-embedding-2` with `outputDimensionality: 768` stored as BSON `Binary` (`Float32Array`), using at most 2 Atlas Search/Vector Search indexes (`knowledge_vector_index`, `knowledge_text_index`).
- `mongodb-memory-server` in Jest does not support `$vectorSearch` or `$search`; retrieval must support `RAG_SEARCH_MODE=local` fallback (auto-selected when Atlas indexes are unavailable or explicitly configured) so all unit/integration tests pass offline without hitting Atlas or Gemini API.
- Existing tests (`npm test`) must remain green after every task.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/data/knowledge/*.md` | 6 curated, peer-reviewed English fitness & nutrition documents with YAML frontmatter | Already created |
| `src/services/rag/vectorMath.js` | Float32 BSON `Binary` encode/decode (4-byte alignment safe), L2 normalization, cosine similarity, and Reciprocal Rank Fusion (RRF) | Create |
| `src/services/rag/chunker.js` | Parse YAML frontmatter + Markdown sections into overlapping chunks with deterministic `chunkId`, `contentHash`, and citation metadata | Create |
| `src/services/rag/embeddingClient.js` | Wrap `@google/genai` `embedContent` (`gemini-embedding-2`, 768 dims) with `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types & unit normalization | Create |
| `src/services/rag/knowledgeSearchService.js` | Hybrid search (`atlas` via `$vectorSearch` + `$search`, `local` via JS cosine + BM25, fused via RRF), topic filter, score threshold, and citation formatter | Create |
| `src/scripts/ingestKnowledge.js` | CLI script to chunk `src/data/knowledge/*.md`, skip unchanged hashes, embed changed chunks, upsert into `knowledge-chunks`, and prune stale chunks | Create |
| `package.json` | Add `"ingest:knowledge"` and `"eval:rag"` npm scripts | Modify |
| `src/mcp/createFitTrackMcpServer.js` | Register 10th MCP tool `search_fitness_knowledge` calling `knowledgeSearchService` | Modify |
| `src/services/ai/guards/executionLoopGuard.js` | Bump `DEFAULT_MAX_STEPS` (`5 -> 7`) and `DEFAULT_TIMEOUT_MS` (`25000 -> 35000`) for multi-step RAG + plan turns | Modify |
| `src/services/ai/systemPrompt.js` | Add English-only & `EVIDENCE-BASED RAG & CITATIONS` rules enforcing inline `[1]` citations, zero hallucinated studies, and injury safety disclaimer | Modify |
| `src/services/ai/aiAgentService.js` | Collect and deduplicate `citations` from `search_fitness_knowledge` MCP results into `runAiChatTurn` return object + English default fallback text | Modify |
| `src/controllers/aiController.js` | Persist `citations` on `assistantMessage` in `ai-conversations` | Modify |
| `tests/integration/mcpEndpoint.test.js` | Update expected MCP tool list to include `search_fitness_knowledge` (10 tools) | Modify |
| `tests/fixtures/ragEvalDataset.json` | Golden English evaluation queries mapped to expected `sourceId`s for Recall@K verification | Create |
| `src/scripts/evalRag.js` | Offline RAG retrieval evaluation runner computing Recall@K against `knowledge-chunks` | Create |
| `tests/unit/ragChunkerAndMath.test.js` | Unit tests for frontmatter parsing, heading-aware chunking, Binary Float32 round-trip (including unaligned Buffer slice), cosine similarity, and RRF | Create |
| `tests/unit/embeddingClient.test.js` | Unit tests for `gemini-embedding-2` 768-dim embedding wrapper | Create |
| `tests/unit/knowledgeSearchService.test.js` | Unit tests for local hybrid search, topic filtering, score threshold, and Atlas `$vectorSearch`/`$search` pipeline construction | Create |
| `tests/unit/ingestKnowledge.test.js` | Unit tests for idempotent ingestion and stale chunk pruning | Create |
| `tests/integration/ragMcpAndChat.test.js` | Integration tests verifying `/mcp` `search_fitness_knowledge` tool & `/api/ai/chat` grounded `citations` persistence | Create |

---

### Task 1: Vector Math & Binary Float32 Utilities

**Files:**
- Create: `src/services/rag/vectorMath.js`
- Test: `tests/unit/ragChunkerAndMath.test.js`

**Interfaces:**
- Produces in `src/services/rag/vectorMath.js`:
  - `normalizeVector(values: number[]): number[]`
  - `toFloat32Binary(values: number[]): Binary` (from `mongodb`)
  - `fromFloat32Binary(bin: Binary | Buffer | number[]): number[]`
  - `cosineSimilarity(vecA: number[], vecB: number[]): number`
  - `reciprocalRankFusion(rankedLists: Array<Array<{ chunkId: string, [key: string]: any }>>, k?: number): Array<{ chunkId: string, rrfScore: number, [key: string]: any }>`

- [ ] **Step 1: Write the failing unit tests for vectorMath**

Create `tests/unit/ragChunkerAndMath.test.js`:

```javascript
const { Binary } = require('mongodb');
const {
  normalizeVector,
  toFloat32Binary,
  fromFloat32Binary,
  cosineSimilarity,
  reciprocalRankFusion
} = require('../../src/services/rag/vectorMath');

describe('vectorMath (unit)', () => {
  test('normalizeVector scales vector to unit L2 norm', () => {
    const norm = normalizeVector([3, 4]);
    expect(norm[0]).toBeCloseTo(0.6, 5);
    expect(norm[1]).toBeCloseTo(0.8, 5);
  });

  test('normalizeVector handles zero vector without NaN', () => {
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test('toFloat32Binary and fromFloat32Binary round-trip 768-dim vector accurately (including unaligned Buffer slice)', () => {
    const input = Array.from({ length: 768 }, (_, i) => ((i % 10) - 5) * 0.1);
    const bin = toFloat32Binary(input);
    expect(bin).toBeInstanceOf(Binary);
    expect(bin.buffer.byteLength).toBe(768 * 4);

    const decoded = fromFloat32Binary(bin);
    expect(decoded).toHaveLength(768);
    expect(decoded[0]).toBeCloseTo(input[0], 5);
    expect(decoded[767]).toBeCloseTo(input[767], 5);

    // Simulate unaligned Buffer slice (byteOffset % 4 !== 0)
    const padded = Buffer.alloc(768 * 4 + 1);
    Buffer.from(bin.buffer).copy(padded, 1);
    const unalignedSlice = padded.subarray(1);
    const unalignedDecoded = fromFloat32Binary(unalignedSlice);
    expect(unalignedDecoded).toHaveLength(768);
    expect(unalignedDecoded[0]).toBeCloseTo(input[0], 5);
  });

  test('cosineSimilarity computes exact similarity for unit and orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  test('reciprocalRankFusion merges multiple ranked lists and boosts items in both', () => {
    const denseList = [
      { chunkId: 'a', title: 'A' },
      { chunkId: 'b', title: 'B' },
      { chunkId: 'c', title: 'C' }
    ];
    const lexicalList = [
      { chunkId: 'b', title: 'B' },
      { chunkId: 'd', title: 'D' },
      { chunkId: 'a', title: 'A' }
    ];

    const fused = reciprocalRankFusion([denseList, lexicalList], 60);
    expect(fused.map((x) => x.chunkId).slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(fused[0].rrfScore).toBeGreaterThan(fused[2].rrfScore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/ragChunkerAndMath.test.js`
Expected: FAIL with `Cannot find module '../../src/services/rag/vectorMath'`.

- [ ] **Step 3: Implement `src/services/rag/vectorMath.js`**

```javascript
const { Binary } = require('mongodb');

function normalizeVector(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  let sumSq = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]) || 0;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    return values.map(() => 0);
  }
  return values.map((v) => (Number(v) || 0) / norm);
}

function toFloat32Binary(values) {
  const float32 = Float32Array.from(values.map((v) => Number(v) || 0));
  const buf = Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
  return new Binary(buf, Binary.SUBTYPE_BYTE_ARRAY);
}

function fromFloat32Binary(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((v) => Number(v) || 0);
  }
  const raw = input instanceof Binary ? input.buffer : input;
  const uint8 =
    raw instanceof Uint8Array
      ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength)
      : new Uint8Array(Buffer.from(raw));
  const aligned = uint8.byteOffset % 4 === 0 ? uint8 : new Uint8Array(uint8);
  const view = new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
  return Array.from(view);
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function reciprocalRankFusion(rankedLists, k = 60) {
  const merged = new Map();

  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (!item || !item.chunkId) return;
      const rank = index + 1;
      const contribution = 1 / (k + rank);
      const existing = merged.get(item.chunkId);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        merged.set(item.chunkId, {
          ...item,
          rrfScore: contribution
        });
      }
    });
  }

  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

module.exports = {
  normalizeVector,
  toFloat32Binary,
  fromFloat32Binary,
  cosineSimilarity,
  reciprocalRankFusion
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/ragChunkerAndMath.test.js`
Expected: PASS (5/5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/rag/vectorMath.js tests/unit/ragChunkerAndMath.test.js
git commit -m "feat(rag): add Float32 binary vector utilities and RRF helper"
```

---

### Task 2: Markdown Frontmatter Parser & Heading-Aware Chunker

**Files:**
- Create: `src/services/rag/chunker.js`
- Modify: `tests/unit/ragChunkerAndMath.test.js`

**Interfaces:**
- Produces in `src/services/rag/chunker.js`:
  - `parseKnowledgeDocument(markdownText: string): { metadata: { sourceId, title, topic, authors, year, references }, body: string }`
  - `chunkKnowledgeDocument(markdownText: string, options?: { maxWords?: number, overlapWords?: number }): Array<{ chunkId, sourceId, title, topic, authors, year, section, references, content, contentHash }>`
  - `loadAndChunkKnowledgeDir(dirPath: string, options?: { maxWords?: number, overlapWords?: number }): Array<Chunk>`

- [ ] **Step 1: Add failing chunker tests to `tests/unit/ragChunkerAndMath.test.js`**

Append to `tests/unit/ragChunkerAndMath.test.js`:

```javascript
const path = require('path');
const {
  parseKnowledgeDocument,
  chunkKnowledgeDocument,
  loadAndChunkKnowledgeDir
} = require('../../src/services/rag/chunker');

describe('chunker (unit)', () => {
  const sampleDoc = `---
sourceId: sample-doc
title: Sample Resistance Guide
topic: training
authors: Sample Author
year: 2024
references:
  - label: Sample Study (2024)
    doi: 10.1000/sample
    url: https://doi.org/10.1000/sample
---

# Sample Resistance Guide

## Section One
${Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ')}

## Section Two
Short section text about rest intervals of 3 to 5 minutes.
`;

  test('parseKnowledgeDocument extracts YAML frontmatter and references', () => {
    const parsed = parseKnowledgeDocument(sampleDoc);
    expect(parsed.metadata).toEqual({
      sourceId: 'sample-doc',
      title: 'Sample Resistance Guide',
      topic: 'training',
      authors: 'Sample Author',
      year: 2024,
      references: [
        {
          label: 'Sample Study (2024)',
          doi: '10.1000/sample',
          url: 'https://doi.org/10.1000/sample'
        }
      ]
    });
    expect(parsed.body).toContain('## Section One');
  });

  test('chunkKnowledgeDocument splits by section and enforces maxWords with overlap', () => {
    const chunks = chunkKnowledgeDocument(sampleDoc, { maxWords: 70, overlapWords: 15 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].chunkId).toBe('sample-doc#0');
    expect(chunks[0].section).toBe('Section One');
    expect(chunks[0].content).toContain('Sample Resistance Guide — Section One');
    expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.section).toBe('Section Two');
    expect(lastChunk.references).toHaveLength(1);
  });

  test('loadAndChunkKnowledgeDir parses all 6 curated knowledge files in src/data/knowledge', () => {
    const knowledgeDir = path.resolve(__dirname, '../../src/data/knowledge');
    const chunks = loadAndChunkKnowledgeDir(knowledgeDir);
    expect(chunks.length).toBeGreaterThanOrEqual(12);
    const sourceIds = new Set(chunks.map((c) => c.sourceId));
    expect(sourceIds.size).toBe(6);
    for (const chunk of chunks) {
      expect(chunk.references.length).toBeGreaterThanOrEqual(1);
      expect(chunk.topic).toMatch(/^(training|nutrition|supplements|recovery)$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/ragChunkerAndMath.test.js`
Expected: FAIL with `Cannot find module '../../src/services/rag/chunker'`.

- [ ] **Step 3: Implement `src/services/rag/chunker.js`**

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseSimpleYamlFrontmatter(rawYaml) {
  const metadata = {
    sourceId: '',
    title: '',
    topic: '',
    authors: '',
    year: null,
    references: []
  };

  const lines = rawYaml.split(/\r?\n/);
  let inReferences = false;
  let currentRef = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    if (/^references:\s*$/.test(line)) {
      inReferences = true;
      continue;
    }

    if (inReferences) {
      const itemStart = line.match(/^\s*-\s+([a-zA-Z0-9_]+):\s*(.*)$/);
      if (itemStart) {
        if (currentRef) metadata.references.push(currentRef);
        currentRef = { label: '', doi: '', url: '' };
        currentRef[itemStart[1]] = itemStart[2].trim();
        continue;
      }
      const itemField = line.match(/^\s+([a-zA-Z0-9_]+):\s*(.*)$/);
      if (itemField && currentRef) {
        currentRef[itemField[1]] = itemField[2].trim();
        continue;
      }
      if (!/^\s/.test(line)) {
        if (currentRef) {
          metadata.references.push(currentRef);
          currentRef = null;
        }
        inReferences = false;
      }
    }

    const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (key === 'year') {
        const parsedYear = Number(val);
        metadata.year = Number.isFinite(parsedYear) ? parsedYear : null;
      } else if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        metadata[key] = val;
      }
    }
  }

  if (currentRef) {
    metadata.references.push(currentRef);
  }

  return metadata;
}

function parseKnowledgeDocument(markdownText) {
  const match = String(markdownText).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Knowledge document must begin with YAML frontmatter (--- ... ---)');
  }
  const metadata = parseSimpleYamlFrontmatter(match[1]);
  if (!metadata.sourceId || !metadata.title || !metadata.topic) {
    throw new Error('Knowledge document frontmatter requires sourceId, title, and topic');
  }
  return {
    metadata,
    body: match[2].trim()
  };
}

function splitSections(body, defaultSection) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let currentHeading = defaultSection;
  let buffer = [];

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (buffer.join('\n').trim()) {
        sections.push({ section: currentHeading, text: buffer.join('\n').trim() });
      }
      currentHeading = h2[1].trim();
      buffer = [];
      continue;
    }
    if (/^#\s+/.test(line)) {
      continue;
    }
    buffer.push(line);
  }

  if (buffer.join('\n').trim()) {
    sections.push({ section: currentHeading, text: buffer.join('\n').trim() });
  }

  return sections;
}

function splitWordsWithOverlap(text, maxWords, overlapWords) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return [words.join(' ')];
  }
  const step = Math.max(1, maxWords - overlapWords);
  const slices = [];
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(words.length, start + maxWords);
    slices.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
  }
  return slices;
}

function chunkKnowledgeDocument(markdownText, { maxWords = 280, overlapWords = 45 } = {}) {
  const { metadata, body } = parseKnowledgeDocument(markdownText);
  const sections = splitSections(body, metadata.title);
  const chunks = [];
  let idx = 0;

  for (const sec of sections) {
    const subChunks = splitWordsWithOverlap(sec.text, maxWords, overlapWords);
    for (const slice of subChunks) {
      const content = `${metadata.title} — ${sec.section}\n${slice}`;
      const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ sourceId: metadata.sourceId, section: sec.section, content, references: metadata.references }))
        .digest('hex');

      chunks.push({
        chunkId: `${metadata.sourceId}#${idx}`,
        sourceId: metadata.sourceId,
        title: metadata.title,
        topic: metadata.topic,
        authors: metadata.authors,
        year: metadata.year,
        section: sec.section,
        references: metadata.references,
        content,
        contentHash
      });
      idx += 1;
    }
  }

  return chunks;
}

function loadAndChunkKnowledgeDir(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Knowledge directory not found: ${dirPath}`);
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const allChunks = [];
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    allChunks.push(...chunkKnowledgeDocument(raw, options));
  }
  return allChunks;
}

module.exports = {
  parseKnowledgeDocument,
  chunkKnowledgeDocument,
  loadAndChunkKnowledgeDir
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/ragChunkerAndMath.test.js`
Expected: PASS (8/8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/rag/chunker.js tests/unit/ragChunkerAndMath.test.js
git commit -m "feat(rag): add YAML frontmatter parser and heading-aware chunker"
```

---

### Task 3: Gemini Embedding Client Wrapper

**Files:**
- Create: `src/services/rag/embeddingClient.js`
- Test: `tests/unit/embeddingClient.test.js`

**Interfaces:**
- Produces in `src/services/rag/embeddingClient.js`:
  - `EMBEDDING_MODEL = 'gemini-embedding-2'`
  - `EMBEDDING_DIMENSIONS = 768`
  - `embedText(text: string, options?: { taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', title?: string }): Promise<number[]>`
  - `embedDocuments(items: Array<{ text: string, title?: string }>): Promise<number[][]>`

- [ ] **Step 1: Write the failing unit test for `embeddingClient.js`**

Create `tests/unit/embeddingClient.test.js`:

```javascript
const mockEmbedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    models: {
      embedContent: mockEmbedContent
    }
  }))
}));

const {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedText,
  embedDocuments
} = require('../../src/services/rag/embeddingClient');

describe('embeddingClient (unit)', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-api-key';
    mockEmbedContent.mockReset();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  test('embedText requests 768-dim embedding and L2-normalizes the returned vector', async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [3, 4, ...Array(766).fill(0)] }]
    });

    const vec = await embedText('how much protein for fat loss', {
      taskType: 'RETRIEVAL_QUERY'
    });

    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      contents: 'how much protein for fat loss',
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    });
    expect(vec).toHaveLength(768);
    expect(vec[0]).toBeCloseTo(0.6, 5);
    expect(vec[1]).toBeCloseTo(0.8, 5);
  });

  test('embedDocuments embeds each document with RETRIEVAL_DOCUMENT and title', async () => {
    mockEmbedContent.mockResolvedValue({
      embedding: { values: [1, ...Array(767).fill(0)] }
    });

    const vectors = await embedDocuments([
      { text: 'Chunk 1', title: 'Doc 1' },
      { text: 'Chunk 2', title: 'Doc 2' }
    ]);

    expect(vectors).toHaveLength(2);
    expect(mockEmbedContent).toHaveBeenNthCalledWith(1, {
      model: EMBEDDING_MODEL,
      contents: 'Chunk 1',
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        title: 'Doc 1',
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    });
  });

  test('throws 503-tagged error when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(embedText('test')).rejects.toMatchObject({ statusCode: 503 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/embeddingClient.test.js`
Expected: FAIL with `Cannot find module '../../src/services/rag/embeddingClient'`.

- [ ] **Step 3: Implement `src/services/rag/embeddingClient.js`**

```javascript
const { GoogleGenAI } = require('@google/genai');
const { normalizeVector } = require('./vectorMath');

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 768;

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }
  return new GoogleGenAI({ apiKey });
}

async function embedText(text, { taskType = 'RETRIEVAL_QUERY', title } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Cannot embed empty text');
  }

  const ai = getAiClient();
  const config = {
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS
  };
  if (title && taskType === 'RETRIEVAL_DOCUMENT') {
    config.title = title;
  }

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: cleanText,
    config
  });

  const values = response?.embeddings?.[0]?.values || response?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedContent returned empty embedding vector');
  }
  return normalizeVector(values);
}

async function embedDocuments(items) {
  const vectors = [];
  for (const item of items) {
    const vec = await embedText(item.text, {
      taskType: 'RETRIEVAL_DOCUMENT',
      title: item.title
    });
    vectors.push(vec);
  }
  return vectors;
}

module.exports = {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedText,
  embedDocuments
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/embeddingClient.test.js`
Expected: PASS (3/3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/rag/embeddingClient.js tests/unit/embeddingClient.test.js
git commit -m "feat(rag): add Gemini 768-dim embedding client wrapper"
```

---

### Task 4: Hybrid Knowledge Search Service (Atlas + Local Fallback)

**Files:**
- Create: `src/services/rag/knowledgeSearchService.js`
- Test: `tests/unit/knowledgeSearchService.test.js`

**Interfaces:**
- Produces in `src/services/rag/knowledgeSearchService.js`:
  - `ALLOWED_TOPICS = ['training', 'nutrition', 'supplements', 'recovery']`
  - `KNOWLEDGE_COLLECTION = 'knowledge-chunks'`
  - `buildAtlasVectorPipeline({ queryVector, topic, limit, numCandidates })`
  - `buildAtlasTextPipeline({ query, topic, limit })`
  - `searchKnowledge({ db, query, topic, limit, minScore, mode }): Promise<{ query, modeUsed, results: Array<CitationResult> }>`

- [ ] **Step 1: Write the failing unit tests for `knowledgeSearchService.js`**

Create `tests/unit/knowledgeSearchService.test.js`:

```javascript
jest.mock('../../src/services/rag/embeddingClient', () => ({
  embedText: jest.fn()
}));

const { embedText } = require('../../src/services/rag/embeddingClient');
const { toFloat32Binary, normalizeVector } = require('../../src/services/rag/vectorMath');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const {
  KNOWLEDGE_COLLECTION,
  buildAtlasVectorPipeline,
  buildAtlasTextPipeline,
  searchKnowledge
} = require('../../src/services/rag/knowledgeSearchService');

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await clearDb();
  embedText.mockReset();
});

describe('knowledgeSearchService (unit)', () => {
  test('buildAtlasVectorPipeline targets knowledge_vector_index with optional topic filter', () => {
    const pipeline = buildAtlasVectorPipeline({
      queryVector: [0.1, 0.2],
      topic: 'nutrition',
      limit: 5,
      numCandidates: 50
    });

    expect(pipeline[0].$vectorSearch).toMatchObject({
      index: 'knowledge_vector_index',
      path: 'embedding',
      numCandidates: 50,
      limit: 5,
      filter: { topic: 'nutrition' }
    });
  });

  test('buildAtlasTextPipeline targets knowledge_text_index with lucene compound filter', () => {
    const pipeline = buildAtlasTextPipeline({
      query: 'creatine loading dosage',
      topic: 'supplements',
      limit: 5
    });

    expect(pipeline[0].$search.index).toBe('knowledge_text_index');
    expect(pipeline[0].$search.compound.filter).toEqual([
      { equals: { path: 'topic', value: 'supplements' } }
    ]);
  });

  test('searchKnowledge in local mode ranks matching chunks via hybrid vector + lexical RRF', async () => {
    const proteinVec = normalizeVector([1, 0, 0, 0]);
    const squatVec = normalizeVector([0, 1, 0, 0]);

    await db.collection(KNOWLEDGE_COLLECTION).insertMany([
      {
        chunkId: 'issn-protein#0',
        sourceId: 'issn-protein-and-exercise-2017',
        title: 'Protein and Macronutrient Guidelines',
        topic: 'nutrition',
        authors: 'Jäger et al.',
        year: 2017,
        section: 'Daily Protein Targets',
        references: [{ label: 'ISSN Protein (2017)', doi: '10.1186/s12970-017-0177-8', url: 'https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8' }],
        content: 'Protein and Macronutrient Guidelines — Daily Protein Targets\nAim for 1.4 to 2.0 g/kg/day for muscle building and 2.3 to 3.1 g/kg/day during fat loss.',
        embedding: toFloat32Binary(proteinVec)
      },
      {
        chunkId: 'acsm-training#0',
        sourceId: 'acsm-schoenfeld-resistance-training',
        title: 'Resistance Training Principles',
        topic: 'training',
        authors: 'ACSM',
        year: 2009,
        section: 'Rest Intervals',
        references: [{ label: 'ACSM (2009)', doi: '10.1249/MSS.0b013e3181915670', url: 'https://doi.org/10.1249/MSS.0b013e3181915670' }],
        content: 'Resistance Training Principles — Rest Intervals\nRest 3 to 5 minutes between heavy compound sets.',
        embedding: toFloat32Binary(squatVec)
      }
    ]);

    embedText.mockResolvedValueOnce(proteinVec);

    const out = await searchKnowledge({
      db,
      query: 'How much protein per day for fat loss?',
      topic: 'nutrition',
      limit: 3,
      mode: 'local'
    });

    expect(out.modeUsed).toBe('local');
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      chunkId: 'issn-protein#0',
      sourceId: 'issn-protein-and-exercise-2017',
      section: 'Daily Protein Targets',
      year: 2017
    });
    expect(out.results[0].references).toHaveLength(1);
  });

  test('searchKnowledge returns empty array when no chunk meets minVectorScore in local mode', async () => {
    const docVec = normalizeVector([0, 1, 0, 0]);
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'acsm#0',
      sourceId: 'acsm',
      title: 'Training',
      topic: 'training',
      authors: 'ACSM',
      year: 2009,
      section: 'Rest',
      references: [],
      content: 'Squat rest intervals',
      embedding: toFloat32Binary(docVec)
    });

    embedText.mockResolvedValueOnce(normalizeVector([1, 0, 0, 0]));

    const out = await searchKnowledge({
      db,
      query: 'quantum physics black holes',
      limit: 3,
      minScore: 0.4,
      mode: 'local'
    });

    expect(out.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/knowledgeSearchService.test.js`
Expected: FAIL with `Cannot find module '../../src/services/rag/knowledgeSearchService'`.

- [ ] **Step 3: Implement `src/services/rag/knowledgeSearchService.js`**

```javascript
const { embedText } = require('./embeddingClient');
const {
  fromFloat32Binary,
  cosineSimilarity,
  reciprocalRankFusion
} = require('./vectorMath');

const KNOWLEDGE_COLLECTION = 'knowledge-chunks';
const ALLOWED_TOPICS = ['training', 'nutrition', 'supplements', 'recovery'];
const DEFAULT_MIN_VECTOR_SCORE = 0.35;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function scoreLexicalMatch(queryTokens, docContent) {
  if (queryTokens.length === 0) return 0;
  const docTokens = tokenize(docContent);
  if (docTokens.length === 0) return 0;

  const tf = new Map();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  let score = 0;
  for (const qt of new Set(queryTokens)) {
    const freq = tf.get(qt) || 0;
    if (freq > 0) {
      // BM25-like saturated term weight
      score += (freq * 2.2) / (freq + 1.2 * (0.25 + 0.75 * (docTokens.length / 200)));
    }
  }
  return score;
}

function buildAtlasVectorPipeline({ queryVector, topic, limit = 5, numCandidates = 60 }) {
  const vectorStage = {
    index: 'knowledge_vector_index',
    path: 'embedding',
    queryVector,
    numCandidates,
    limit
  };
  if (topic && ALLOWED_TOPICS.includes(topic)) {
    vectorStage.filter = { topic };
  }

  return [
    { $vectorSearch: vectorStage },
    {
      $project: {
        _id: 0,
        chunkId: 1,
        sourceId: 1,
        title: 1,
        topic: 1,
        authors: 1,
        year: 1,
        section: 1,
        references: 1,
        content: 1,
        vectorScore: { $meta: 'vectorSearchScore' }
      }
    }
  ];
}

function buildAtlasTextPipeline({ query, topic, limit = 5 }) {
  const textClause = {
    text: {
      query,
      path: ['content', 'section', 'title']
    }
  };

  const searchStage = topic && ALLOWED_TOPICS.includes(topic)
    ? {
        index: 'knowledge_text_index',
        compound: {
          must: [textClause],
          filter: [{ equals: { path: 'topic', value: topic } }]
        }
      }
    : {
        index: 'knowledge_text_index',
        ...textClause
      };

  return [
    { $search: searchStage },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        chunkId: 1,
        sourceId: 1,
        title: 1,
        topic: 1,
        authors: 1,
        year: 1,
        section: 1,
        references: 1,
        content: 1,
        lexicalScore: { $meta: 'searchScore' }
      }
    }
  ];
}

function formatResult(doc, score) {
  return {
    chunkId: doc.chunkId,
    sourceId: doc.sourceId,
    title: doc.title,
    topic: doc.topic,
    authors: doc.authors,
    year: doc.year,
    section: doc.section,
    references: Array.isArray(doc.references) ? doc.references : [],
    excerpt: doc.content,
    score: Number((score || 0).toFixed(4))
  };
}

async function runLocalHybridSearch({ db, query, queryVector, topic, limit, minScore }) {
  const filter = topic && ALLOWED_TOPICS.includes(topic) ? { topic } : {};
  const docs = await db.collection(KNOWLEDGE_COLLECTION).find(filter).toArray();
  if (docs.length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);

  const vectorScored = docs
    .map((doc) => {
      const vec = fromFloat32Binary(doc.embedding);
      const sim = cosineSimilarity(queryVector, vec);
      return { ...doc, vectorScore: sim };
    })
    .filter((doc) => doc.vectorScore >= minScore)
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, limit * 3);

  const lexicalScored = docs
    .map((doc) => ({
      ...doc,
      lexicalScore: scoreLexicalMatch(queryTokens, doc.content)
    }))
    .filter((doc) => doc.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, limit * 3);

  if (vectorScored.length === 0 && lexicalScored.length === 0) {
    return [];
  }

  // Only keep chunks that passed vector threshold or strong lexical threshold
  const validVectorIds = new Set(vectorScored.map((d) => d.chunkId));
  const fused = reciprocalRankFusion([vectorScored, lexicalScored], 60)
    .filter((d) => validVectorIds.has(d.chunkId) || (d.lexicalScore || 0) >= 1.5)
    .slice(0, limit);

  return fused.map((doc) => formatResult(doc, doc.vectorScore ?? doc.rrfScore));
}

async function runAtlasHybridSearch({ db, query, queryVector, topic, limit, minScore }) {
  const candidateLimit = Math.min(20, limit * 3);
  const collection = db.collection(KNOWLEDGE_COLLECTION);

  const [vectorDocs, textDocs] = await Promise.all([
    collection
      .aggregate(
        buildAtlasVectorPipeline({
          queryVector,
          topic,
          limit: candidateLimit,
          numCandidates: Math.max(50, candidateLimit * 5)
        })
      )
      .toArray(),
    collection
      .aggregate(
        buildAtlasTextPipeline({
          query,
          topic,
          limit: candidateLimit
        })
      )
      .toArray()
      .catch(() => [])
  ]);

  const filteredVectorDocs = vectorDocs.filter((d) => (d.vectorScore || 0) >= minScore);
  if (filteredVectorDocs.length === 0 && textDocs.length === 0) {
    return [];
  }

  const validVectorIds = new Set(filteredVectorDocs.map((d) => d.chunkId));
  const fused = reciprocalRankFusion([filteredVectorDocs, textDocs], 60)
    .filter((d) => validVectorIds.has(d.chunkId) || (d.lexicalScore || 0) >= 1.5)
    .slice(0, limit);

  return fused.map((doc) => formatResult(doc, doc.vectorScore ?? doc.rrfScore));
}

async function searchKnowledge({
  db,
  query,
  topic,
  limit = 5,
  minScore = DEFAULT_MIN_VECTOR_SCORE,
  mode = process.env.RAG_SEARCH_MODE || 'auto'
}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { query: '', modeUsed: mode, results: [] };
  }

  const queryVector = await embedText(cleanQuery, { taskType: 'RETRIEVAL_QUERY' });

  if (mode === 'local') {
    const results = await runLocalHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'local', results };
  }

  if (mode === 'atlas') {
    const results = await runAtlasHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'atlas', results };
  }

  // 'auto': try Atlas hybrid search first, fall back cleanly to local mode if $vectorSearch is unsupported
  try {
    const results = await runAtlasHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'atlas', results };
  } catch (err) {
    const msg = String(err?.message || '');
    const isUnsupportedAtlasStage =
      err?.code === 40324 ||
      err?.code === 31082 ||
      err?.codeName === 'Location40324' ||
      /vectorSearch|SearchNotEnabled|Atlas Search/i.test(msg);

    if (!isUnsupportedAtlasStage) {
      throw err;
    }

    const results = await runLocalHybridSearch({ db, query: cleanQuery, queryVector, topic, limit, minScore });
    return { query: cleanQuery, modeUsed: 'local', results };
  }
}

module.exports = {
  KNOWLEDGE_COLLECTION,
  ALLOWED_TOPICS,
  DEFAULT_MIN_VECTOR_SCORE,
  buildAtlasVectorPipeline,
  buildAtlasTextPipeline,
  searchKnowledge
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/knowledgeSearchService.test.js`
Expected: PASS (4/4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/rag/knowledgeSearchService.js tests/unit/knowledgeSearchService.test.js
git commit -m "feat(rag): implement hybrid vector + lexical knowledge search service"
```

---

### Task 5: Idempotent Knowledge Ingestion Script (`ingestKnowledge.js`)

**Files:**
- Create: `src/scripts/ingestKnowledge.js`
- Modify: `package.json:6-15`
- Test: `tests/unit/ingestKnowledge.test.js`

**Interfaces:**
- Produces in `src/scripts/ingestKnowledge.js`:
  - `ingestKnowledgeDirectory({ db, knowledgeDir, embedFn }): Promise<{ totalChunks, embeddedCount, skippedCount, deletedCount }>`

- [ ] **Step 1: Write the failing unit test for idempotent ingestion**

Create `tests/unit/ingestKnowledge.test.js`:

```javascript
const path = require('path');
const { startTestDb, stopTestDb, clearDb } = require('../setup/testDb');
const { KNOWLEDGE_COLLECTION } = require('../../src/services/rag/knowledgeSearchService');
const { ingestKnowledgeDirectory } = require('../../src/scripts/ingestKnowledge');

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

describe('ingestKnowledge (unit)', () => {
  test('embeds all chunks on first run, skips unchanged chunks on second run, and stores Binary Float32', async () => {
    const knowledgeDir = path.resolve(__dirname, '../../src/data/knowledge');
    const mockEmbedFn = jest.fn(async (items) =>
      items.map(() => [1, ...Array(767).fill(0)])
    );

    const first = await ingestKnowledgeDirectory({ db, knowledgeDir, embedFn: mockEmbedFn });
    expect(first.totalChunks).toBeGreaterThanOrEqual(12);
    expect(first.embeddedCount).toBe(first.totalChunks);
    expect(first.skippedCount).toBe(0);

    const sampleDoc = await db.collection(KNOWLEDGE_COLLECTION).findOne({});
    expect(sampleDoc.embedding.buffer.byteLength).toBe(768 * 4);

    // Insert a stale chunk to confirm pruning works
    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'obsolete-source#0',
      sourceId: 'obsolete-source'
    });

    mockEmbedFn.mockClear();
    const second = await ingestKnowledgeDirectory({ db, knowledgeDir, embedFn: mockEmbedFn });
    expect(second.embeddedCount).toBe(0);
    expect(second.skippedCount).toBe(first.totalChunks);
    expect(second.deletedCount).toBe(1);
    expect(mockEmbedFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/ingestKnowledge.test.js`
Expected: FAIL with `Cannot find module '../../src/scripts/ingestKnowledge'`.

- [ ] **Step 3: Implement `src/scripts/ingestKnowledge.js` and add npm script in `package.json`**

Create `src/scripts/ingestKnowledge.js`:

```javascript
const path = require('path');
const dotenv = require('dotenv');
const { connectDB, closeDB } = require('../config/db');
const { loadAndChunkKnowledgeDir } = require('../services/rag/chunker');
const { embedDocuments } = require('../services/rag/embeddingClient');
const { toFloat32Binary } = require('../services/rag/vectorMath');
const { KNOWLEDGE_COLLECTION } = require('../services/rag/knowledgeSearchService');

dotenv.config();

async function ingestKnowledgeDirectory({
  db,
  knowledgeDir = path.resolve(__dirname, '../data/knowledge'),
  embedFn = embedDocuments
}) {
  const chunks = loadAndChunkKnowledgeDir(knowledgeDir);
  const collection = db.collection(KNOWLEDGE_COLLECTION);

  await collection.createIndex({ chunkId: 1 }, { unique: true });
  await collection.createIndex({ topic: 1 });

  const existingDocs = await collection
    .find({}, { projection: { chunkId: 1, contentHash: 1 } })
    .toArray();
  const existingHashes = new Map(existingDocs.map((d) => [d.chunkId, d.contentHash]));

  const chunksToEmbed = chunks.filter((c) => existingHashes.get(c.chunkId) !== c.contentHash);
  const skippedCount = chunks.length - chunksToEmbed.length;

  let embeddedCount = 0;
  if (chunksToEmbed.length > 0) {
    const vectors = await embedFn(
      chunksToEmbed.map((c) => ({ text: c.content, title: c.title }))
    );

    const now = new Date();
    const bulkOps = chunksToEmbed.map((chunk, i) => ({
      updateOne: {
        filter: { chunkId: chunk.chunkId },
        update: {
          $set: {
            ...chunk,
            embedding: toFloat32Binary(vectors[i]),
            updatedAt: now
          }
        },
        upsert: true
      }
    }));

    await collection.bulkWrite(bulkOps);
    embeddedCount = chunksToEmbed.length;
  }

  const validIds = chunks.map((c) => c.chunkId);
  const pruneRes = await collection.deleteMany({ chunkId: { $nin: validIds } });

  return {
    totalChunks: chunks.length,
    embeddedCount,
    skippedCount,
    deletedCount: pruneRes.deletedCount || 0
  };
}

if (require.main === module) {
  (async () => {
    try {
      const db = await connectDB();
      const summary = await ingestKnowledgeDirectory({ db });
      console.log('✅ Knowledge ingestion complete:', summary);
    } catch (err) {
      console.error('❌ Knowledge ingestion failed:', err);
      process.exitCode = 1;
    } finally {
      await closeDB();
    }
  })();
}

module.exports = { ingestKnowledgeDirectory };
```

Update `package.json` scripts block (`"seed"` line):

```json
    "seed": "node src/seed.js",
    "ingest:knowledge": "node src/scripts/ingestKnowledge.js",
    "eval:rag": "node src/scripts/evalRag.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/ingestKnowledge.test.js`
Expected: PASS (1/1 test).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/ingestKnowledge.js package.json tests/unit/ingestKnowledge.test.js
git commit -m "feat(rag): add idempotent knowledge ingestion script and npm command"
```

---

### Task 6: Register `search_fitness_knowledge` MCP Tool & Update Agent Guards/Citations

**Files:**
- Modify: `src/mcp/createFitTrackMcpServer.js:1-15,495-514`
- Modify: `src/services/ai/guards/executionLoopGuard.js:1-4`
- Modify: `src/services/ai/systemPrompt.js:1-36`
- Modify: `src/services/ai/aiAgentService.js:35-175`
- Modify: `src/controllers/aiController.js:80-105`
- Modify: `tests/integration/mcpEndpoint.test.js:53-70`
- Test: `tests/integration/ragMcpAndChat.test.js`

**Interfaces:**
- Consumes: `searchKnowledge`, `ALLOWED_TOPICS` from `src/services/rag/knowledgeSearchService.js`.
- Produces:
  - MCP tool `search_fitness_knowledge({ query: string, topic?: 'training'|'nutrition'|'supplements'|'recovery', limit?: number })` returning `{ count, citations: [...] }`.
  - `runAiChatTurn(...)` returns `{ text, toolTrace, draftPlan, citations, memoriesUpdated }`.
  - `assistantMessage` persisted in `ai-conversations` includes `citations: Array<Citation>`.

- [ ] **Step 1: Write the failing integration test for MCP tool and `/api/ai/chat` citations**

Create `tests/integration/ragMcpAndChat.test.js`:

```javascript
const request = require('supertest');

jest.mock('../../src/services/ai/geminiClient', () => ({
  isGeminiConfigured: jest.fn(() => true),
  generateAgentTurn: jest.fn()
}));

jest.mock('../../src/services/rag/embeddingClient', () => ({
  embedText: jest.fn()
}));

const { generateAgentTurn, isGeminiConfigured } = require('../../src/services/ai/geminiClient');
const { embedText } = require('../../src/services/rag/embeddingClient');
const { toFloat32Binary, normalizeVector } = require('../../src/services/rag/vectorMath');
const { KNOWLEDGE_COLLECTION } = require('../../src/services/rag/knowledgeSearchService');
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
  isGeminiConfigured.mockReturnValue(true);
  generateAgentTurn.mockReset();
  embedText.mockReset();
});

describe('RAG MCP Tool & Grounded Citations (integration)', () => {
  test('exposes search_fitness_knowledge over /mcp and persists deduplicated citations on /api/ai/chat', async () => {
    const { token, userId } = await createUserAndToken(db);
    const creatineVec = normalizeVector([1, 0, 0, 0]);

    await db.collection(KNOWLEDGE_COLLECTION).insertOne({
      chunkId: 'issn-creatine-supplementation-2017#1',
      sourceId: 'issn-creatine-supplementation-2017',
      title: 'Creatine Supplementation Safety, Dosage, and Efficacy',
      topic: 'supplements',
      authors: 'Kreider et al. (ISSN)',
      year: 2017,
      section: 'Dosing Protocols',
      references: [
        {
          label: 'ISSN Position Stand - Creatine (2017)',
          doi: '10.1186/s12970-017-0173-z',
          url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5469049/'
        }
      ],
      content: 'Taking 3 to 5 g/day of creatine monohydrate achieves full muscle saturation over 3 to 4 weeks.',
      embedding: toFloat32Binary(creatineVec)
    });

    embedText.mockResolvedValue(creatineVec);

    // 1. Verify external /mcp tool call
    const mcpRes = await request(app)
      .post('/mcp')
      .set(authHeader(token))
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_fitness_knowledge',
          arguments: { query: 'creatine daily dosage', topic: 'supplements', limit: 3 }
        }
      });

    expect(mcpRes.status).toBe(200);
    const mcpText = JSON.stringify(mcpRes.body);
    expect(mcpText).toContain('issn-creatine-supplementation-2017#1');

    // 2. Verify /api/ai/chat executes tool via InMemoryTransport and persists citations
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [
          {
            name: 'search_fitness_knowledge',
            args: { query: 'creatine daily dosage', topic: 'supplements', limit: 3 }
          }
        ],
        text: ''
      })
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Daily intake of 3-5 g creatine monohydrate saturates muscle stores over 3-4 weeks [1].'
      });

    const chatRes = await request(app)
      .post('/api/ai/chat')
      .set(authHeader(token))
      .send({ message: 'How much creatine should I take per day?' });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.assistantMessage.toolTrace).toEqual([
      { name: 'search_fitness_knowledge', status: 'ok' }
    ]);
    expect(chatRes.body.assistantMessage.citations).toHaveLength(1);
    expect(chatRes.body.assistantMessage.citations[0]).toMatchObject({
      citationNumber: 1,
      chunkId: 'issn-creatine-supplementation-2017#1',
      section: 'Dosing Protocols'
    });

    const savedConv = await db.collection('ai-conversations').findOne({ userId });
    expect(savedConv.messages[1].citations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/ragMcpAndChat.test.js`
Expected: FAIL because `search_fitness_knowledge` does not exist yet and `citations` is not attached to `assistantMessage`.

- [ ] **Step 3: Register `search_fitness_knowledge` in `src/mcp/createFitTrackMcpServer.js`**

Import `searchKnowledge` and `ALLOWED_TOPICS` near line 10 of `src/mcp/createFitTrackMcpServer.js`:

```javascript
const {
  searchKnowledge,
  ALLOWED_TOPICS
} = require('../services/rag/knowledgeSearchService');
```

Register tool #10 right before `return server;` in `src/mcp/createFitTrackMcpServer.js`:

```javascript
  // 10. search_fitness_knowledge
  server.tool(
    'search_fitness_knowledge',
    'Search evidence-based English sports science, resistance training, nutrition, supplement, hydration, and recovery knowledge base with peer-reviewed citations. Call this when answering factual training or nutrition questions.',
    {
      query: z.string().min(2).max(300),
      topic: z.enum(ALLOWED_TOPICS).optional(),
      limit: z.number().int().min(1).max(8).optional()
    },
    async ({ query, topic, limit = 4 }) => {
      const { modeUsed, results } = await searchKnowledge({
        db,
        query,
        topic,
        limit
      });

      if (results.length === 0) {
        return toMcpJson({
          count: 0,
          modeUsed,
          citations: [],
          message:
            'No sufficiently relevant peer-reviewed evidence chunks found for this query. Do not invent studies or citations.'
        });
      }

      return toMcpJson({
        count: results.length,
        modeUsed,
        citations: results
      });
    }
  );
```

- [ ] **Step 4: Update `executionLoopGuard.js`, `systemPrompt.js`, `aiAgentService.js`, `aiController.js`, and `mcpEndpoint.test.js`**

1. In `src/services/ai/guards/executionLoopGuard.js` lines 1–3:
```javascript
const DEFAULT_MAX_STEPS = 7;
const DEFAULT_MAX_DUPLICATE_CALLS = 2;
const DEFAULT_TIMEOUT_MS = 35000;
```

2. In `src/services/ai/systemPrompt.js`, enforce English communication and append section 4 to the prompt string:
```javascript
4. EVIDENCE-BASED KNOWLEDGE & CITATIONS (RAG) + ENGLISH POLICY:
   - Communicate in clear, professional English (FitTrack is an English-language application).
   - When the user asks factual questions about training science (volume, frequency, rep ranges, rest intervals, progressive overload, RPE/RIR), nutrition (protein, macros, caloric deficit/surplus, hydration), supplements (creatine), or recovery/deloading, call search_fitness_knowledge with a focused English query before answering.
   - Ground factual claims in the returned citation excerpts and reference them inline using [1], [2], etc. matching the citationNumber of each returned item, followed by a concise Sources list when citations are used.
   - NEVER fabricate study titles, authors, years, DOIs, or URLs not present in search_fitness_knowledge output. If search_fitness_knowledge returns 0 results, state clearly that the knowledge base lacks direct evidence on that specific point.
   - SAFETY BOUNDARY: Never diagnose injuries or medical conditions. For sharp joint pain, numbness, persistent swelling, or pre-existing medical conditions (e.g., renal disease), advise stopping aggravating movements and consulting a qualified healthcare professional.
```

3. In `src/services/ai/aiAgentService.js`, track and deduplicate `citations` by `chunkId` across tool rounds and update fallback strings to English:
```javascript
  const loopGuard = createExecutionLoopGuard();
  let latestDraftPlan = null;
  let memoriesUpdated = false;
  const collectedCitations = [];
  const citationsByChunkId = new Map();
```
Inside the `while (true)` loop in `src/services/ai/aiAgentService.js`:
```javascript
      const stepCheck = loopGuard.canStep();
      if (!stepCheck.ok) {
        if (!finalAssistantText) {
          finalAssistantText =
            'I have compiled the information from your training data. Please check the results below!';
        }
        break;
      }

      const turn = await generateAgentTurn({
        systemInstruction,
        contents,
        tools: geminiTools
      });

      const functionCalls = turn.functionCalls || [];
      if (functionCalls.length === 0) {
        finalAssistantText =
          (turn.text || '').trim() ||
          'I have processed your request. Please check the details below!';
        break;
      }
```
And after parsing `parsedPayload` from `mcpClient.callTool`:
```javascript
        if (!isError && parsedPayload.draftPlan) {
          latestDraftPlan = parsedPayload.draftPlan;
        }
        if (
          !isError &&
          callName === 'search_fitness_knowledge' &&
          Array.isArray(parsedPayload.citations)
        ) {
          parsedPayload.citations = parsedPayload.citations.map((item) => {
            if (!item || !item.chunkId) return item;
            let existing = citationsByChunkId.get(item.chunkId);
            if (!existing) {
              existing = {
                citationNumber: collectedCitations.length + 1,
                ...item
              };
              citationsByChunkId.set(item.chunkId, existing);
              collectedCitations.push(existing);
            }
            return existing;
          });
        }
        if (
          !isError &&
          (callName === 'save_user_memory' || callName === 'delete_user_memory')
        ) {
          memoriesUpdated = true;
        }
```
And in the return statement of `runAiChatTurn`:
```javascript
    return {
      text: finalAssistantText,
      toolTrace: loopGuard.getToolTrace(),
      draftPlan: latestDraftPlan,
      citations: collectedCitations,
      memoriesUpdated
    };
```

4. In `src/controllers/aiController.js` lines 92–99:
```javascript
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: agentResponse.text,
      toolTrace: agentResponse.toolTrace,
      draftPlan: agentResponse.draftPlan || null,
      citations: agentResponse.citations || [],
      createdAt: new Date(now.getTime() + 1)
    };
```

5. In `tests/integration/mcpEndpoint.test.js` lines 53–70, include `'search_fitness_knowledge'` in the expected tool list:
```javascript
    expect(names).toEqual([
      'delete_user_memory',
      'edit_weekly_schedule',
      'get_progress_analytics',
      'get_user_profile',
      'get_weekly_plans',
      'propose_weekly_plan',
      'save_user_memory',
      'search_exercises',
      'search_fitness_knowledge',
      'update_weekly_plan'
    ]);
```

- [ ] **Step 5: Run integration and full test suite**

Run: `npx jest tests/integration/ragMcpAndChat.test.js && npm test`
Expected: PASS across all unit and integration suites.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/createFitTrackMcpServer.js src/services/ai/guards/executionLoopGuard.js src/services/ai/systemPrompt.js src/services/ai/aiAgentService.js src/controllers/aiController.js tests/integration/mcpEndpoint.test.js tests/integration/ragMcpAndChat.test.js
git commit -m "feat(rag): wire search_fitness_knowledge MCP tool and persist grounded citations"
```

---

### Task 7: Golden Dataset & Offline RAG Evaluation Script (`evalRag.js`)

**Files:**
- Create: `tests/fixtures/ragEvalDataset.json`
- Create: `src/scripts/evalRag.js`

**Interfaces:**
- Produces in `src/scripts/evalRag.js`:
  - `evaluateRetrieval({ db, dataset, topK }): Promise<{ total, hits, recallAtK, misses }>`

- [ ] **Step 1: Create `tests/fixtures/ragEvalDataset.json`**

```json
[
  {
    "query": "How many weekly sets per muscle group maximize muscle hypertrophy?",
    "topic": "training",
    "expectedSourceId": "acsm-schoenfeld-resistance-training"
  },
  {
    "query": "How long should I rest between heavy strength squat sets?",
    "topic": "training",
    "expectedSourceId": "acsm-schoenfeld-resistance-training"
  },
  {
    "query": "How much protein per kg of body weight during a cutting caloric deficit?",
    "topic": "nutrition",
    "expectedSourceId": "issn-protein-and-exercise-2017"
  },
  {
    "query": "Should I take a caloric surplus to build muscle or can I recomp?",
    "topic": "nutrition",
    "expectedSourceId": "issn-diets-body-composition-2017"
  },
  {
    "query": "What is the daily maintenance dose for creatine monohydrate without loading?",
    "topic": "supplements",
    "expectedSourceId": "issn-creatine-supplementation-2017"
  },
  {
    "query": "How much fluid should I drink after a sweaty workout to rehydrate quickly?",
    "topic": "nutrition",
    "expectedSourceId": "acsm-hydration-fluid-replacement-2007"
  },
  {
    "query": "What does RPE 8 in RIR mean and how many hours of sleep do adults need?",
    "topic": "recovery",
    "expectedSourceId": "zourdos-rir-aasm-sleep-recovery"
  }
]
```

- [ ] **Step 2: Create `src/scripts/evalRag.js`**

```javascript
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { connectDB, closeDB } = require('../config/db');
const { searchKnowledge } = require('../services/rag/knowledgeSearchService');

dotenv.config();

async function evaluateRetrieval({ db, dataset, topK = 3 }) {
  let hits = 0;
  const misses = [];

  for (const item of dataset) {
    const { results } = await searchKnowledge({
      db,
      query: item.query,
      topic: item.topic,
      limit: topK
    });
    const matched = results.some((r) => r.sourceId === item.expectedSourceId);
    if (matched) {
      hits += 1;
    } else {
      misses.push({
        query: item.query,
        expectedSourceId: item.expectedSourceId,
        actualSourceIds: results.map((r) => r.sourceId)
      });
    }
  }

  return {
    total: dataset.length,
    hits,
    recallAtK: dataset.length > 0 ? Number((hits / dataset.length).toFixed(3)) : 0,
    misses
  };
}

if (require.main === module) {
  (async () => {
    try {
      const db = await connectDB();
      const datasetPath = path.resolve(__dirname, '../../tests/fixtures/ragEvalDataset.json');
      const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
      const report = await evaluateRetrieval({ db, dataset, topK: 3 });
      console.log('📊 RAG Retrieval Eval (Recall@3):', JSON.stringify(report, null, 2));
      if (report.recallAtK < 0.85) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error('❌ RAG eval failed:', err);
      process.exitCode = 1;
    } finally {
      await closeDB();
    }
  })();
}

module.exports = { evaluateRetrieval };
```

- [ ] **Step 3: Verify entire test suite passes**

Run: `npm test`
Expected: All existing and new Jest suites pass cleanly.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/ragEvalDataset.json src/scripts/evalRag.js
git commit -m "feat(rag): add golden eval dataset and Recall@K retrieval script"
```

---

## MongoDB Atlas M0 Index Setup (Manual One-Time Step in Atlas UI)

After deploying or pointing `MONGO_URI` to MongoDB Atlas M0 and running `npm run ingest:knowledge`:

1. Create **Vector Search Index** named `knowledge_vector_index` on collection `knowledge-chunks`:
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "topic"
    }
  ]
}
```

2. Create **Atlas Search Index** named `knowledge_text_index` on collection `knowledge-chunks`:
```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "content": { "type": "string", "analyzer": "lucene.english" },
      "section": { "type": "string", "analyzer": "lucene.english" },
      "title": { "type": "string", "analyzer": "lucene.english" },
      "topic": { "type": "token" }
    }
  }
}
```

3. Run `npm run eval:rag` against Atlas to verify `Recall@3 >= 0.85`.
