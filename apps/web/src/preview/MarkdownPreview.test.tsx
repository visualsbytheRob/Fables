// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownPreview, defaultPreviewSettings } from './MarkdownPreview.js';
import { TableOfContents } from './TableOfContents.js';
import { extractHeadings, slugify } from './toc.js';
import { toggleTaskAtLine } from './tasks.js';

afterEach(cleanup);

describe('GFM rendering (F132)', () => {
  it('renders tables, strikethrough and autolinks', () => {
    const md = [
      '| Fable | Moral |',
      '| --- | --- |',
      '| Fox | Patience |',
      '',
      '~~scratched~~ and https://fables.local',
    ].join('\n');
    const { container } = render(<MarkdownPreview source={md} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('del')?.textContent).toBe('scratched');
    expect(container.querySelector('a[href="https://fables.local"]')).not.toBeNull();
  });

  it('renders task lists with checkbox state', () => {
    const md = '- [x] done\n- [ ] todo';
    const { container } = render(<MarkdownPreview source={md} />);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
  });
});

describe('sanitization (F131)', () => {
  it('neutralizes script tags and event-handler injection', () => {
    const md =
      'before\n\n<script>window.pwned = true;</script>\n\n<img src="x" onerror="window.pwned = true" />\n\nafter';
    const { container } = render(<MarkdownPreview source={md} />);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
    expect(container.querySelector('img')?.getAttribute('onerror') ?? null).toBeNull();
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
  });

  it('strips javascript: link targets', () => {
    const md = '[click me](javascript:alert(1))';
    const { container } = render(<MarkdownPreview source={md} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });
});

describe('code highlighting (F133)', () => {
  it('adds hljs token spans inside fenced code blocks (lazily loaded)', async () => {
    const md = '```js\nconst answer = 42;\n```';
    const { container } = render(<MarkdownPreview source={md} />);
    await waitFor(() => expect(container.querySelector('code.hljs')).not.toBeNull());
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });
});

describe('task toggling (F134)', () => {
  it('reports the 1-based source line of the clicked checkbox', () => {
    const md = '# Plan\n\n- [ ] feed the fox\n- [x] write the fable';
    const onToggleTask = vi.fn();
    const { container } = render(<MarkdownPreview source={md} onToggleTask={onToggleTask} />);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(boxes[1]!);
    expect(onToggleTask).toHaveBeenCalledWith(4);
  });

  it('toggleTaskAtLine flips markers in the source', () => {
    const md = '- [ ] feed the fox\n- [x] write the fable';
    expect(toggleTaskAtLine(md, 1)).toBe('- [x] feed the fox\n- [x] write the fable');
    expect(toggleTaskAtLine(md, 2)).toBe('- [ ] feed the fox\n- [ ] write the fable');
    expect(toggleTaskAtLine(md, 99)).toBe(md); // out of range: no-op
    expect(toggleTaskAtLine('plain line', 1)).toBe('plain line'); // not a task: no-op
  });
});

describe('footnotes (F135)', () => {
  it('renders footnotes with working back-references', () => {
    const md = 'A claim.[^1]\n\n[^1]: The evidence.';
    const { container } = render(<MarkdownPreview source={md} />);
    const ref = container.querySelector('a[data-footnote-ref]');
    expect(ref).not.toBeNull();
    const target = ref?.getAttribute('href')?.slice(1);
    expect(target).toBeTruthy();
    // sanitize must not double-prefix the id, or the link breaks
    expect(container.querySelector(`[id="${target}"]`)).not.toBeNull();
    expect(container.querySelector('section[data-footnotes]')?.textContent).toContain(
      'The evidence.',
    );
  });
});

describe('math behind a setting (F136)', () => {
  const md = 'Euler: $e^{i\\pi} + 1 = 0$';

  it('does not render math when disabled', () => {
    const { container } = render(<MarkdownPreview source={md} />);
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('renders KaTeX when enabled (lazily loaded)', async () => {
    const { container } = render(
      <MarkdownPreview source={md} settings={{ ...defaultPreviewSettings, math: true }} />,
    );
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
  });
});

describe('mermaid stub (F137 — deferred)', () => {
  it('renders a clear note instead of a diagram when enabled', () => {
    const md = '```mermaid\ngraph TD; A-->B;\n```';
    const { container } = render(
      <MarkdownPreview source={md} settings={{ ...defaultPreviewSettings, mermaid: true }} />,
    );
    expect(container.querySelector('.md-mermaid-stub')?.textContent).toContain('F137 deferred');
    expect(container.textContent).toContain('graph TD');
  });
});

describe('heading anchors + TOC (F138)', () => {
  it('gives headings slug ids and anchor links', () => {
    const { container } = render(<MarkdownPreview source={'## The Fox & the Crow'} />);
    const h2 = container.querySelector('h2');
    expect(h2?.id).toBe('the-fox-the-crow');
    expect(h2?.querySelector('a.md-heading-anchor')?.getAttribute('href')).toBe(
      '#the-fox-the-crow',
    );
  });

  it('extractHeadings skips fenced code and strips inline markdown', () => {
    const md = ['# One', '```', '# not a heading', '```', '## *Two* [linked](x)'].join('\n');
    expect(extractHeadings(md)).toEqual([
      { depth: 1, text: 'One', slug: 'one' },
      { depth: 2, text: 'Two linked', slug: 'two-linked' },
    ]);
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('TableOfContents renders nested links matching heading ids', () => {
    const md = '# Top\n\n## Sub';
    const { container } = render(<TableOfContents source={md} />);
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#top', '#sub']);
  });
});

describe('pipeline snapshot (F140)', () => {
  it('renders the kitchen sink consistently', async () => {
    const md = [
      '# The Fox and the Compiler',
      '',
      'A **bold** fox met an *italic* crow.[^why]',
      '',
      '- [ ] flatter the crow',
      '- [x] steal the `cheese`',
      '',
      '| Animal | Role |',
      '| ------ | ---- |',
      '| Fox    | Trickster |',
      '',
      '> Moral: never trust a flatterer.',
      '',
      '```js',
      'const moral = "earned";',
      '```',
      '',
      '[^why]: Crows hold grudges.',
    ].join('\n');
    const { container } = render(<MarkdownPreview source={md} />);
    await waitFor(() => expect(container.querySelector('code.hljs')).not.toBeNull());
    expect(container.innerHTML).toMatchSnapshot();
  });
});
