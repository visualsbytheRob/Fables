/**
 * Mermaid diagram rendering (F137), behind the preview `mermaid` setting.
 * The mermaid library is ~500KB gzip, so it loads lazily on first diagram;
 * theme follows the app theme (document data-theme set by ThemeProvider) and
 * invalid diagrams fall back to an error note plus the source.
 */
import { useEffect, useId, useState } from 'react';

type RenderState =
  | { status: 'loading' }
  | { status: 'ok'; svg: string }
  | { status: 'error'; message: string };

/** Reads the resolved app theme without requiring the ThemeProvider context. */
function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme !== 'light';
}

export function MermaidDiagram({ code }: { code: string }) {
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  // Mermaid render ids must be valid CSS selectors; useId emits colons.
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const dark = isDarkTheme();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        });
        const { svg } = await mermaid.render(id, code);
        if (alive) setState({ status: 'ok', svg });
      } catch (error) {
        if (alive) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, dark, id]);

  if (state.status === 'error') {
    return (
      <div className="md-mermaid md-mermaid--error">
        <p role="alert">Mermaid diagram failed to render: {state.message}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (state.status === 'loading') {
    return <div className="md-mermaid md-mermaid--loading">Rendering diagram…</div>;
  }
  // Mermaid's own sanitizer runs under securityLevel: 'strict'; the input is
  // the user's note text rendered locally, same trust as the rest of the note.
  return (
    <div
      className="md-mermaid"
      data-testid="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
