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
