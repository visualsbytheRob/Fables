import { formatWikilink, notFound, validation, type LinkId, type NoteId } from '@fables/core';
import { withTransaction, type Db } from '../db/connection.js';
import { linksRepo, type Link } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';
import { applyServerEdit } from './notes.js';

/** Characters a wikilink target can never contain. */
const UNLINKABLE_TITLE_RE = /[[\]|#^\n]/;

/**
 * Converts unlinked mentions of a note into wikilinks (F224, F225): rewrites
 * each source body in place — `[[Title]]` when the text matches the title
 * exactly, `[[Title|original text]]` otherwise — one transactional server
 * edit per source note (rev bump + snapshot + link resync).
 */
export function convertMentions(
  db: Db,
  targetId: NoteId,
  opts: { mentionId?: LinkId; all?: boolean },
): { converted: number; sources: number } {
  return withTransaction(db, () => {
    const target = notesRepo(db).get(targetId);
    if (!target) throw notFound('Note', targetId);
    if (target.title === '' || UNLINKABLE_TITLE_RE.test(target.title)) {
      throw validation('note title cannot appear in a wikilink', { title: target.title });
    }

    const links = linksRepo(db);
    let rows: Link[];
    if (opts.all === true) {
      rows = links.incoming(targetId, 'mention');
    } else {
      const row = opts.mentionId === undefined ? null : links.get(opts.mentionId);
      if (!row || row.kind !== 'mention' || row.targetId !== targetId) {
        throw notFound('Mention', opts.mentionId);
      }
      rows = [row];
    }

    const bySource = new Map<string, Link[]>();
    for (const row of rows) {
      if (!bySource.has(row.sourceId)) bySource.set(row.sourceId, []);
      bySource.get(row.sourceId)!.push(row);
    }

    let converted = 0;
    let sources = 0;
    for (const [sourceId, sourceRows] of bySource) {
      const source = notesRepo(db).get(sourceId as NoteId);
      if (!source) continue;
      let body = source.body;
      // Splice back-to-front so earlier offsets stay valid.
      for (const row of [...sourceRows].sort((a, b) => b.position - a.position)) {
        const text = body.slice(row.position, row.position + row.length);
        if (text.toLowerCase() !== row.targetTitle) continue; // stale row — skip defensively
        const replacement =
          text === target.title
            ? formatWikilink({ target: target.title })
            : formatWikilink({ target: target.title, alias: text });
        body = body.slice(0, row.position) + replacement + body.slice(row.position + row.length);
        converted += 1;
      }
      if (body !== source.body) {
        applyServerEdit(db, sourceId as NoteId, { body });
        sources += 1;
      }
    }
    return { converted, sources };
  });
}
