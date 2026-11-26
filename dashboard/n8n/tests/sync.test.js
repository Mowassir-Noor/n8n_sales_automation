import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripExports, expandCode, buildAll } from '../../scripts/sync-n8n.mjs';

const dashboardDir = resolve(__dirname, '..', '..');

describe('sync-n8n', () => {
  it('strips the export line and refuses imports', () => {
    expect(stripExports('function a() {}\n\nexport { a };\n', 'x')).toBe('function a() {}\n');
    expect(() => stripExports("import x from './y.js';\n", 'x')).toThrow(/import/);
    expect(() => stripExports('export function a() {}\n', 'x')).toThrow(/export/);
  });

  it('fills marker regions from a (stub) shared folder and fails clearly when a file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-n8n-'));
    mkdirSync(join(dir, 'email'));
    writeFileSync(join(dir, 'email', 'hash.js'), 'function hashText(s) { return "h"; }\nexport { hashText };\n');
    const src = 'const a = 1;\n  // <shared:hash>\n  // stale\n  // </shared:hash>\nreturn a;\n';
    const out = expandCode(src, 'test.js', { sharedDir: join(dir, 'email') });
    expect(out).toBe('const a = 1;\n  // <shared:hash>\nfunction hashText(s) { return "h"; }\n  // </shared:hash>\nreturn a;\n');
    expect(() => expandCode('// <shared:checkDraft>\n// </shared:checkDraft>\n', 'test.js', { sharedDir: join(dir, 'email') }))
      .toThrow(/checkDraft\.js, which does not exist/);
    expect(() => expandCode('// <lib:common>\nno close\n', 'test.js')).toThrow(/no matching closing marker/);
  });

  it('build/ is up to date with templates, code and shared files', () => {
    const built = buildAll({ dashboardDir });
    expect([...built.keys()].sort()).toEqual(['lead-action.workflow.js', 'lists.workflow.js', 'read.workflow.js', 'settings.workflow.js', 'status.workflow.js']);
    for (const [name, text] of built) {
      const file = join(dashboardDir, 'n8n', 'build', name);
      expect(existsSync(file), name).toBe(true);
      expect(readFileSync(file, 'utf8') === text, `${name} is out of date; run npm run sync:n8n`).toBe(true);
      expect(text).not.toMatch(/__CODE__\(/);
    }
  });
});
