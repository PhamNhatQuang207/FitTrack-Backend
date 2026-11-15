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
