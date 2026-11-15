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
