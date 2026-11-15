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

  test('reciprocalRankFusion merges additional properties from subsequent lists while summing rrfScore', () => {
    const vectorList = [
      { chunkId: 'a', vectorScore: 0.91 }
    ];
    const lexicalList = [
      { chunkId: 'a', lexicalScore: 4.25, extraTag: 'bm25-hit' }
    ];

    const fused = reciprocalRankFusion([vectorList, lexicalList], 60);
    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      chunkId: 'a',
      vectorScore: 0.91,
      lexicalScore: 4.25,
      extraTag: 'bm25-hit'
    });
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61, 8);
  });
});

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

