/**
 * MarkdownPreview (F131–F137): sanitized remark/rehype pipeline with GFM,
 * highlighted code blocks, interactive task lists, footnotes, optional KaTeX
 * math, mermaid diagrams, live ```fql query embeds (F283–F289), and heading
 * anchor links.
 */
import { isValidElement, useEffect, useMemo, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components, ExtraProps, Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import {
  decodeWikilinkHref,
  preprocessWikilinks,
  WIKILINK_HREF_PREFIX,
  type Wikilink,
} from '../links/wikilinks.js';
import { MermaidDiagram } from './Mermaid.js';
import { QueryEmbed, type QueryEmbedHandlers } from './QueryEmbed.js';
import { previewSchema } from './sanitize.js';
import { slugify } from './toc.js';
import './preview.css';

/** Wikilink rendering + navigation hooks (F204/F206). */
export interface WikilinkHandlers {
  /** Resolve a link target title to a note id, or null when broken. */
  resolve: (target: string) => string | null;
  onNavigate: (noteId: string, link: Wikilink) => void;
  /** Broken-link click: create the note with that title, then open it. */
  onCreate: (target: string) => void;
}

export interface PreviewSettings {
  /** Render $…$ / $$…$$ via KaTeX (F136). */
  math: boolean;
  /** Render ```mermaid fences as diagrams (F137); the library loads lazily. */
  mermaid: boolean;
}

export const defaultPreviewSettings: PreviewSettings = { math: false, mermaid: false };

export interface MarkdownPreviewProps {
  source: string;
  settings?: PreviewSettings;
  /** Called with the 1-based source line of a clicked task checkbox (F134). */
  onToggleTask?: (line: number) => void;
  className?: string;
  /** Open a lightbox when an image is clicked (F166). */
  onImageClick?: (src: string, alt: string) => void;
  /** Render attachment links as inline PDF/audio players (F167/F168). */
  richMedia?: boolean;
  /** Enable `[[wikilink]]` rendering + click-through (F204/F206). */
  wikilinks?: WikilinkHandlers;
  /** Enable live ```fql query embed blocks (F283–F285). */
  fqlEmbeds?: QueryEmbedHandlers;
  /**
   * Recursion guard (F289): embeds render only at depth 0 (the note itself).
   * Result-body excerpts re-enter the preview at depth 1, where any nested
   * fql fence renders as plain code instead of running another query.
   */
  embedDepth?: number;
}

/** Embeds never render past this depth — see `embedDepth` (F289). */
export const MAX_EMBED_DEPTH = 1;

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|oga|flac|aac)$/i;

/** True for links pointing at the attachments endpoint. */
const isAttachmentHref = (href: string): boolean => href.startsWith('/api/v1/attachments/');

function textOf(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(children)) return textOf(children.props.children);
  return '';
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type HeadingProps = HTMLAttributes<HTMLHeadingElement> & ExtraProps;

/** Heading renderer adding a slug id + anchor link (F138). */
function heading(Tag: HeadingTag) {
  return function Heading({ node: _node, children, ...rest }: HeadingProps) {
    const text = textOf(children);
    const slug = slugify(text);
    return (
      <Tag id={slug} {...rest}>
        {children}
        <a className="md-heading-anchor" href={`#${slug}`} aria-label={`Link to “${text}”`}>
          #
        </a>
      </Tag>
    );
  };
}

/** Language of a fenced code block's <code> child, when tagged. */
function codeChildLanguage(child: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(child)) return null;
  const className = typeof child.props.className === 'string' ? child.props.className : '';
  const lang = className.split(' ').find((c) => c.startsWith('language-'));
  return lang ? lang.slice('language-'.length) : null;
}

/** Raw text content of a fenced code block's <code> child. */
function codeChildText(child: ReactNode): string {
  if (!isValidElement<{ children?: ReactNode }>(child)) return '';
  return textOf(child.props.children);
}

type RehypePlugin = NonNullable<Options['rehypePlugins']>[number];

export function MarkdownPreview({
  source,
  settings = defaultPreviewSettings,
  onToggleTask,
  className,
  onImageClick,
  richMedia = false,
  wikilinks,
  fqlEmbeds,
  embedDepth = 0,
}: MarkdownPreviewProps) {
  // highlight.js and KaTeX dominate the bundle, so both rehype plugins are
  // loaded lazily; the preview renders unhighlighted/plain until they arrive
  // (F133/F136 + the 350KB gzip budget).
  const [highlightPlugin, setHighlightPlugin] = useState<RehypePlugin | null>(null);
  const [katexPlugin, setKatexPlugin] = useState<RehypePlugin | null>(null);

  useEffect(() => {
    let alive = true;
    void import('rehype-highlight').then((mod) => {
      if (alive) setHighlightPlugin(() => mod.default);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!settings.math) return;
    let alive = true;
    void Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')]).then(([mod]) => {
      if (alive) setKatexPlugin(() => mod.default);
    });
    return () => {
      alive = false;
    };
  }, [settings.math]);

  const remarkPlugins = useMemo(
    () => [remarkGfm, ...(settings.math ? [remarkMath] : [])],
    [settings.math],
  );
  const rehypePlugins = useMemo(() => {
    // Sanitize first (mandatory, F131); KaTeX/highlight output below is
    // generated from already-sanitized text.
    const sanitize: [typeof rehypeSanitize, typeof previewSchema] = [rehypeSanitize, previewSchema];
    return [
      sanitize,
      ...(settings.math && katexPlugin ? [katexPlugin] : []),
      ...(highlightPlugin ? [highlightPlugin] : []),
    ];
  }, [settings.math, katexPlugin, highlightPlugin]);

  const components = useMemo<Components>(
    () => ({
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      h5: heading('h5'),
      h6: heading('h6'),
      // Task checkboxes: remark-gfm renders them disabled; we re-enable and
      // delegate the change event to the parent <li>, which knows its source line.
      input({ node: _node, ...props }) {
        if (props.type !== 'checkbox') return <input {...props} />;
        const { checked, disabled: _disabled, ...rest } = props;
        return (
          <input
            {...rest}
            type="checkbox"
            checked={Boolean(checked)}
            disabled={!onToggleTask}
            onChange={() => {}}
          />
        );
      },
      li({ node, children, ...rest }) {
        const line = node?.position?.start.line;
        const isTask =
          typeof rest.className === 'string' && rest.className.includes('task-list-item');
        if (!isTask || !onToggleTask || line === undefined) {
          return <li {...rest}>{children}</li>;
        }
        return (
          <li {...rest} onChange={() => onToggleTask(line)}>
            {children}
          </li>
        );
      },
      // Image lightbox hook (F166).
      img({ node: _node, ...props }) {
        if (!onImageClick) return <img {...props} />;
        return (
          <img
            {...props}
            className="md-preview__img--clickable"
            onClick={() => onImageClick(String(props.src ?? ''), String(props.alt ?? ''))}
          />
        );
      },
      // Attachment-aware links (F167/F168): PDFs embed inline, audio gets a player.
      a({ node: _node, children, ...props }) {
        const href = String(props.href ?? '');
        const label = textOf(children);
        // Wikilinks (F204/F206): resolved links navigate; broken links are
        // styled distinctly and create-then-open the missing note on click.
        if (wikilinks && href.startsWith(WIKILINK_HREF_PREFIX)) {
          const link = decodeWikilinkHref(href);
          if (!link) return <a {...props}>{children}</a>;
          const targetId = wikilinks.resolve(link.target);
          const broken = targetId === null;
          return (
            <a
              {...props}
              className={broken ? 'wikilink wikilink--broken' : 'wikilink'}
              title={broken ? `Create “${link.target}”` : `Open “${link.target}”`}
              onClick={(e) => {
                e.preventDefault();
                if (broken) wikilinks.onCreate(link.target);
                else wikilinks.onNavigate(targetId, link);
              }}
            >
              {children}
            </a>
          );
        }
        if (richMedia && isAttachmentHref(href)) {
          if (AUDIO_EXT_RE.test(label)) {
            return (
              <span className="md-audio">
                <audio controls src={href} aria-label={label} />
                <a {...props}>{children}</a>
              </span>
            );
          }
          if (/\.pdf$/i.test(label)) {
            return (
              <span className="md-pdf">
                <object data={href} type="application/pdf" aria-label={label}>
                  <a {...props}>{children}</a>
                </object>
                <a {...props}>{children}</a>
              </span>
            );
          }
        }
        return <a {...props}>{children}</a>;
      },
      // Special code fences: ```mermaid diagrams (F137) and live ```fql query
      // embeds (F283–F285) with the depth/recursion guard (F289).
      pre({ node: _node, children, ...rest }) {
        const first = Array.isArray(children) ? children[0] : children;
        const lang = codeChildLanguage(first);
        if (lang === 'mermaid' && settings.mermaid) {
          return <MermaidDiagram code={codeChildText(first).trim()} />;
        }
        if (lang === 'fql' && fqlEmbeds) {
          if (embedDepth >= MAX_EMBED_DEPTH) {
            return (
              <div className="fql-embed fql-embed--guard">
                <p role="note">Nested query embeds are not rendered (depth limit).</p>
                <pre {...rest}>{children}</pre>
              </div>
            );
          }
          return (
            <QueryEmbed
              content={codeChildText(first)}
              handlers={fqlEmbeds}
              renderNoteBody={(body) => (
                <MarkdownPreview
                  source={body}
                  settings={settings}
                  fqlEmbeds={fqlEmbeds}
                  embedDepth={embedDepth + 1}
                />
              )}
            />
          );
        }
        return <pre {...rest}>{children}</pre>;
      },
    }),
    [onToggleTask, settings, onImageClick, richMedia, wikilinks, fqlEmbeds, embedDepth],
  );

  // Rewrite [[wikilinks]] into markdown links the pipeline understands; the
  // rewrite never adds/removes lines, so task-checkbox line numbers stay valid.
  const effectiveSource = useMemo(
    () => (wikilinks ? preprocessWikilinks(source) : source),
    [source, wikilinks],
  );

  return (
    <div className={className ? `md-preview ${className}` : 'md-preview'}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {effectiveSource}
      </Markdown>
    </div>
  );
}
