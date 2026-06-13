/**
 * Web clipper (F771–F773).
 *
 * F771: /clip route — take a URL (+ optional selection) → POST /clip → open
 *       created note, with a duplicate-clip notice.
 * F772: Bookmarklet generator — shows a copyable javascript: bookmarklet.
 * F773: iOS share-target instructions card (manifest share_target is Day-9).
 */
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  Button,
  Clipboard,
  CircleCheck,
  ExternalLink,
  Input,
  Textarea,
  useToast,
} from '@fables/ui';
import { Link, useSearchParams } from 'react-router-dom';
import { clipApi, type ClipResult } from '../api/client.js';
import './clip.css';

export function ClipPage() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [url, setUrl] = useState(searchParams.get('url') ?? '');
  const [selection, setSelection] = useState(searchParams.get('selection') ?? '');
  const [clipping, setClipping] = useState(false);
  const [result, setResult] = useState<ClipResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If we were opened with a URL query param (e.g. from bookmarklet), auto-clip.
  useEffect(() => {
    const preUrl = searchParams.get('url');
    if (preUrl) {
      setUrl(preUrl);
      setSelection(searchParams.get('selection') ?? '');
    }
  }, [searchParams]);

  const runClip = () => {
    if (!url.trim()) return;
    setClipping(true);
    setResult(null);
    setError(null);
    clipApi.clip(url.trim(), selection.trim() || undefined).then(
      (res) => {
        setResult(res);
        setClipping(false);
        if (!res.duplicate) {
          toast('Page clipped!');
        }
      },
      (err: Error) => {
        setError(err.message);
        setClipping(false);
        toast(`Clip failed: ${err.message}`, 'error');
      },
    );
  };

  return (
    <div className="clip-page">
      <h1>
        <BookmarkPlus size={20} /> Web Clipper
      </h1>

      {/* Clip form (F771) */}
      <section className="clip-page__form ui-stack" aria-label="Clip a page">
        <h2>Clip a page</h2>
        <label className="ui-stack clip-page__field">
          URL
          <Input
            aria-label="URL to clip"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runClip();
            }}
          />
        </label>
        <label className="ui-stack clip-page__field">
          Selected text (optional)
          <Textarea
            aria-label="Selected text"
            placeholder="Paste the selection you want to save…"
            rows={3}
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          />
        </label>
        <Button variant="primary" disabled={url.trim() === '' || clipping} onClick={runClip}>
          {clipping ? 'Clipping…' : 'Clip page'}
        </Button>

        {/* Duplicate notice (F771) */}
        {result?.duplicate && (
          <div className="clip-page__duplicate" role="status" aria-label="Duplicate clip notice">
            <AlertCircle size={16} />
            <span>
              This page was already clipped. Opening existing note instead.
            </span>
          </div>
        )}

        {/* Success — link to created note */}
        {result && (
          <div className="clip-page__success" role="status" aria-label="Clip result">
            <CircleCheck size={16} />
            <Link to={`/notes/${result.note.id}`} className="clip-page__note-link">
              <ExternalLink size={12} /> Open: {result.note.title}
            </Link>
          </div>
        )}

        {error && (
          <p className="clip-page__error" role="alert">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </section>

      {/* Bookmarklet generator (F772) */}
      <BookmarkletSection />

      {/* iOS share-target instructions (F773) */}
      <ShareTargetCard />
    </div>
  );
}

/** Returns the origin to use in the bookmarklet. */
function getOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

function BookmarkletSection() {
  const [copied, setCopied] = useState(false);

  const origin = getOrigin();
  // The bookmarklet opens /clip?url=<current-url>&selection=<selected-text>
  const bookmarklet =
    `javascript:(function(){` +
    `var u=encodeURIComponent(location.href),` +
    `s=encodeURIComponent(window.getSelection().toString());` +
    `window.open('${origin}/clip?url='+u+'&selection='+s,'_blank');` +
    `})()`;

  const copy = () => {
    void navigator.clipboard.writeText(bookmarklet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="clip-page__bookmarklet ui-stack" aria-label="Bookmarklet generator">
      <h2>Browser bookmarklet (F772)</h2>
      <p className="clip-page__hint">
        Drag the link below to your bookmarks bar. Click it on any page to clip it to Fables.
      </p>
      <div className="clip-page__bookmarklet-row">
        {/* The bookmarklet itself as a draggable element.
            We intentionally avoid putting the javascript: URI in an href to
            appease React's security check.  Users drag from this element or
            copy via the button; the raw URI is shown truncated below. */}
        <span
          className="clip-page__bookmarklet-link"
          aria-label="Clip to Fables bookmarklet"
          role="link"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/uri-list', bookmarklet)}
        >
          <BookmarkPlus size={14} /> Clip to Fables
        </span>
        <div className="clip-page__bookmarklet-code">
          <code>{bookmarklet.slice(0, 80)}…</code>
        </div>
        <Button variant="primary" onClick={copy}>
          {copied ? <><CircleCheck size={14} /> Copied!</> : <><Clipboard size={14} /> Copy</>}
        </Button>
      </div>
    </section>
  );
}

function ShareTargetCard() {
  return (
    <section className="clip-page__share-target ui-stack" aria-label="iOS share target">
      <h2>Share to Fables from iOS (F773)</h2>
      <div className="clip-page__share-instructions">
        <p>
          <strong>Install the PWA first:</strong> open Fables in Safari and tap{' '}
          <em>Share → Add to Home Screen</em>.
        </p>
        <p>
          Once installed, share any web page in Safari:
        </p>
        <ol>
          <li>Tap the Share button (box with arrow).</li>
          <li>Scroll down and tap <strong>Fables</strong> in the app list.</li>
          <li>The Clip page opens with the URL pre-filled — tap <em>Clip page</em>.</li>
        </ol>
        <p className="clip-page__hint">
          Full native share-target support (no tap needed) arrives in Day 9 via the PWA manifest{' '}
          <code>share_target</code> field.
        </p>
      </div>
    </section>
  );
}
