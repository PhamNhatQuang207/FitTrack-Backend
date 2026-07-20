// Verifies the SECURITY FIX #1 helper: user input used in a $regex query must be
// escaped so it is matched literally (no regex injection / ReDoS).
const { escapeRegex } = require('../../src/controllers/exerciseController');

describe('escapeRegex (unit)', () => {
  test('escapes all regex metacharacters', () => {
    expect(escapeRegex('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  test('leaves plain alphanumeric text unchanged', () => {
    expect(escapeRegex('Bench Press 123')).toBe('Bench Press 123');
  });

  test('neutralises a catastrophic-backtracking pattern into a literal', () => {
    const malicious = '(a+)+$';
    const escaped = escapeRegex(malicious);
    // The escaped form contains no active grouping/quantifier metacharacters.
    expect(escaped).toBe('\\(a\\+\\)\\+\\$');
    // And it only matches the literal string, not via backtracking.
    expect(new RegExp(escaped).test('(a+)+$')).toBe(true);
    expect(new RegExp(escaped).test('aaaaaaaaaa')).toBe(false);
  });
});
