import { describe, expect, it } from 'vitest';
import { checkFormatted, format, formatRange } from './formatter.js';
import { loadFixtures } from './test-helpers.js';

describe('format basics (F371)', () => {
  it('canonicalises spacing and markers', () => {
    const messy = [
      '===   woods',
      'The   trail. ', // trailing spaces trimmed, inner prose kept
      '*    [Go]',
      '-> END',
      '',
    ].join('\n');
    const { formatted } = format(messy);
    // Note: the trailing divert belongs to the choice (weave rules), so it indents.
    expect(formatted).toBe(['=== woods ===', 'The   trail.', '* [Go]', '  -> END', ''].join('\n'));
  });

  it('returns source untouched when there are syntax errors', () => {
    const broken = '=== \nVAR x\n';
    const result = format(broken);
    expect(result.formatted).toBe(broken);
    expect(result.changed).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('indentation of nested weave (F372)', () => {
  it('indents choice bodies and nested choices by depth', () => {
    const source = [
      '=== k ===',
      '* one',
      'inside one',
      '* * deep',
      'deeper text',
      '- - inner gather',
      '- top gather',
      '-> END',
      '',
    ].join('\n');
    const { formatted } = format(source);
    expect(formatted).toBe(
      [
        '=== k ===',
        '* one',
        '  inside one',
        '  * * deep',
        '    deeper text',
        '  - - inner gather',
        '- top gather',
        '-> END',
        '',
      ].join('\n'),
    );
  });
});

describe('logic spacing conventions (F373)', () => {
  it('normalises operators, declarations, and calls', () => {
    const source = 'VAR x=1+2*3\n=== k ===\n~temp y=MIN( x,4 )\n~ x  =  y\n{x}\n-> END\n';
    const { formatted } = format(source);
    expect(formatted).toContain('VAR x = 1 + 2 * 3');
    expect(formatted).toContain('~ temp y = MIN(x, 4)');
    expect(formatted).toContain('~ x = y');
  });
});

describe('comment preservation (F374)', () => {
  it('keeps leading, trailing, and standalone comments', () => {
    const source = [
      '// top of file',
      'VAR x = 1 // why not',
      '',
      '// about the knot',
      '=== k ===',
      'text // inline note',
      '/* block */',
      '~ x = 2 // bump',
      '{x}',
      '-> END',
      '',
    ].join('\n');
    const { formatted } = format(source);
    for (const piece of ['// top of file', '// why not', '// about the knot', '// inline note', '/* block */', '// bump']) {
      expect(formatted).toContain(piece);
    }
    // And formatting again keeps them in place.
    expect(format(formatted).formatted).toBe(formatted);
  });
});

describe('idempotency (F375)', () => {
  for (const fixture of loadFixtures('corpus')) {
    it(`format(format(x)) === format(x): ${fixture.name}`, () => {
      const once = format(fixture.source);
      const twice = format(once.formatted);
      expect(twice.formatted).toBe(once.formatted);
    });
  }
});

describe('range formatting (F376)', () => {
  const source = [
    'VAR x   =   1',
    '-> a',
    '',
    '=== a ===',
    'messy   knot a. ',
    '*    choice',
    '-> b',
    '',
    '=== b ===',
    'messy   knot b too ',
    '-> END',
    '',
  ].join('\n');

  it('reformats only sections overlapping the range', () => {
    const bStart = source.split('\n').findIndex((l) => l.startsWith('=== b')) + 1;
    const result = formatRange(source, { startLine: bStart, endLine: bStart + 2 });
    expect(result.formatted).toContain('VAR x   =   1'); // untouched header
    expect(result.formatted).toContain('messy   knot a. '); // untouched knot a
    expect(result.formatted).toContain('messy   knot b too\n'); // formatted (trailing space gone)
  });

  it('full-file range equals full format', () => {
    const whole = formatRange(source, { startLine: 1, endLine: source.split('\n').length });
    expect(whole.formatted).toBe(format(source).formatted);
  });

  it('leaves erroring sources untouched', () => {
    const broken = 'VAR x\n';
    expect(formatRange(broken, { startLine: 1, endLine: 1 }).formatted).toBe(broken);
  });
});

describe('check mode (F377)', () => {
  it('answers cleanly for CI', () => {
    expect(checkFormatted('=== k ===\ntext\n-> END\n')).toBe(true);
    expect(checkFormatted('===  k\ntext\n-> END\n')).toBe(false);
  });
});

describe('formatter config (F379)', () => {
  it('supports indent size and compact choice markers', () => {
    const source = '=== k ===\n* one\n* * two\nbody\n-> END\n';
    const compact = format(source, { choiceMarkerStyle: 'compact', indentSize: 4 }).formatted;
    expect(compact).toContain('\n    ** two');
    expect(compact).toContain('\n        body');
    // Config is itself idempotent.
    expect(format(compact, { choiceMarkerStyle: 'compact', indentSize: 4 }).formatted).toBe(compact);
  });

  it('accepts maxWidth without wrapping prose', () => {
    const long = `=== k ===\n${'word '.repeat(40)}and stop.\n-> END\n`;
    const { formatted } = format(long, { maxWidth: 40 });
    expect(formatted).toContain('word word'); // prose untouched, never hard-wrapped
  });
});

describe('formatter golden corpus (F380)', () => {
  for (const fixture of loadFixtures('corpus')) {
    it(`golden format: ${fixture.name}`, () => {
      expect(format(fixture.source).formatted).toMatchSnapshot();
    });
  }
});
