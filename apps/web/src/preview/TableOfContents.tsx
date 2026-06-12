/** In-note table of contents (F138), built from the extracted heading list. */
import { useMemo } from 'react';
import { extractHeadings } from './toc.js';

export function TableOfContents({ source }: { source: string }) {
  const entries = useMemo(() => extractHeadings(source), [source]);
  if (entries.length === 0) return null;
  const minDepth = Math.min(...entries.map((e) => e.depth));
  return (
    <nav className="md-toc" aria-label="Table of contents">
      <ul>
        {entries.map((entry, i) => (
          <li
            key={`${entry.slug}-${i}`}
            style={{ paddingLeft: `${(entry.depth - minDepth) * 14}px` }}
          >
            <a href={`#${entry.slug}`}>{entry.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
