import { describe, expect, it } from 'vitest';
import { checkDrift, extractFunction, normalise } from '../../scripts/drift.mjs';

describe('drift between n8n workflows and shared/email', () => {
  it('no drift (same check as npm run test:drift)', () => {
    const { problems, checked } = checkDrift();
    expect(checked.length).toBeGreaterThanOrEqual(12);
    expect(problems).toEqual([]);
  });

  it('extractFunction finds a top-level function up to its closing brace', () => {
    const src = 'return x;\n\n// c\nfunction f(a) {\n  if (a) { return "}"; }\n  return 1;\n}\n\nfunction g() {\n}\n';
    expect(extractFunction(src, 'f')).toBe('function f(a) {\n  if (a) { return "}"; }\n  return 1;\n}');
    expect(extractFunction(src, 'g')).toBe('function g() {\n}');
    expect(extractFunction(src, 'h')).toBeNull();
  });

  it('normalise only collapses whitespace', () => {
    expect(normalise('  a\n\t b  ')).toBe('a b');
    expect(normalise('a b')).not.toBe(normalise('ab'));
  });
});
