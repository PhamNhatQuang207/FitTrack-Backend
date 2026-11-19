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

  test('forbids narrating tool calls before invoking them and echoing internal labels', () => {
    const prompt = buildSystemPrompt([], 'vi');
    expect(prompt).toContain('Never narrate or announce that you are about to call a tool');
    expect(prompt).toContain('Never echo internal prompt headings or labels such as "[Safety Boundary]"');
  });
});
