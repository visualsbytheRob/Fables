/**
 * Cmd/Ctrl-click on a `[[wikilink]]` in the editor navigates to the target
 * note (F204, editor half). Hit-testing reuses the shared parser, so escapes
 * and code spans behave exactly like the preview and the server.
 */
import { EditorView } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import { wikilinkAt, type Wikilink } from '../links/wikilinks.js';

export function wikilinkClickExtension(onWikilinkClick: (link: Wikilink) => void): Extension {
  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const link = wikilinkAt(view.state.doc.toString(), pos);
        if (!link) return false;
        event.preventDefault();
        onWikilinkClick(link);
        return true;
      },
    }),
    // Affordance: links look clickable while the modifier is held.
    EditorView.contentAttributes.of({ 'data-wikilink-nav': 'true' }),
  ];
}
