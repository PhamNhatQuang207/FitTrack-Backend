const { GoogleGenAI } = require('@google/genai');

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

async function generateAgentTurn({ systemInstruction, contents, tools }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      tools: tools && tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
      temperature: 0.3
    }
  });

  const finishReason = response.candidates?.[0]?.finishReason || null;

  return {
    functionCalls: response.functionCalls || [],
    text: response.text || '',
    finishReason,
    rawCandidates: response.candidates || []
  };
}

module.exports = {
  isGeminiConfigured,
  generateAgentTurn
};
