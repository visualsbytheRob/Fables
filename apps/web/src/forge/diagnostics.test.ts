import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { diagnosticsByLine, mapDiagnostics } from './diagnostics.js';

describe('forge diagnostics mapping (F383)', () => {
  it('maps compiler spans to from/to offsets with severity and code', () => {
    const source = '-> nowhere\n';
    const result = compile(source);
    const mapped = mapDiagnostics(result, source.length);
    const unknown = mapped.find((d) => d.code === 'FORGE202');
    expect(unknown).toBeDefined();
    expect(unknown?.severity).toBe('error');
    expect(unknown?.line).toBe(1);
    expect(source.slice(unknown?.from, unknown?.to)).toBe('-> nowhere');
  });

  it('keeps warnings distinct from errors', () => {
    const source = 'VAR unused = 1\n\nHello.\n-> END\n';
    const mapped = mapDiagnostics(compile(source), source.length);
    const unused = mapped.find((d) => d.code === 'FORGE209');
    expect(unused?.severity).toBe('warning');
    expect(source.slice(unused?.from, unused?.to)).toBe('unused');
  });

  it('clamps stale spans to the (shorter) current document', () => {
    const source = 'Text.\n-> nowhere\n';
    const result = compile(source);
    const mapped = mapDiagnostics(result, 8); // doc shrank under the diagnostic
    for (const d of mapped) {
      expect(d.from).toBeLessThanOrEqual(8);
      expect(d.to).toBeLessThanOrEqual(8);
      expect(d.to).toBeGreaterThan(d.from);
    }
  });

  it('widens zero-width spans so the squiggle is visible', () => {
    const source = '~ x ='; // the missing expression is reported at zero-width EOF
    const mapped = mapDiagnostics(compile(source), source.length);
    expect(mapped.length).toBeGreaterThan(0);
    for (const d of mapped) expect(d.to).toBeGreaterThan(d.from);
  });

  it('drops diagnostics entirely on an empty document', () => {
    const result = compile('-> nowhere\n');
    expect(mapDiagnostics(result, 0)).toEqual([]);
  });

  it('groups diagnostics per line with the worst severity winning', () => {
    const source = 'VAR dead = 1\n\n-> nowhere\n';
    const result = compile(source);
    const byLine = diagnosticsByLine(result, source.length);
    expect(byLine.get(1)?.severity).toBe('warning'); // unused var
    expect(byLine.get(3)?.severity).toBe('error'); // unknown divert
    expect(byLine.get(3)?.messages.some((m) => m.startsWith('FORGE202'))).toBe(true);
  });
});
