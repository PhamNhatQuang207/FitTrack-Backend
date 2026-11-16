const { buildSystemPrompt } = require('../../src/services/ai/systemPrompt');

describe('buildSystemPrompt', () => {
  test('uses English response policy by default', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('Communicate in clear, professional English');
  });

  test('instructs Vietnamese responses while keeping English RAG and canonical category queries when lang=vi', () => {
    const prompt = buildSystemPrompt([], 'vi');
    expect(prompt).toContain('Respond to the user in natural, clear Vietnamese');
    expect(prompt).toContain('call search_fitness_knowledge with a focused English query');
    expect(prompt).toContain('canonical English category names');
  });
});
