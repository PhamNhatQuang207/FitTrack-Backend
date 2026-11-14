const MAX_INPUT_LENGTH = 1500;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /reveal\s+(your\s+)?(hidden\s+)?(system\s+)?(prompt|instructions)/i,
  /output\s+(the\s+)?system\s+prompt/i,
  /you\s+are\s+now\s+(in\s+)?(dan|developer\s+mode|jailbreak)/i,
  /system\s*override/i
];

function validateUserInput(rawMessage) {
  if (typeof rawMessage !== 'string') {
    return {
      ok: false,
      code: 'AI_INPUT_BLOCKED',
      message: 'Message must be a non-empty string.'
    };
  }

  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: 'AI_INPUT_BLOCKED',
      message: 'Message cannot be empty.'
    };
  }

  if (trimmed.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      code: 'AI_INPUT_BLOCKED',
      message: `Message exceeds maximum length of ${MAX_INPUT_LENGTH} characters.`
    };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        code: 'AI_INPUT_BLOCKED',
        message: 'Message was blocked by safety guard due to restricted instruction-override patterns.'
      };
    }
  }

  return {
    ok: true,
    sanitizedMessage: trimmed
  };
}

module.exports = {
  MAX_INPUT_LENGTH,
  validateUserInput
};
