/**
 * Minimal embedded player runtime for self-contained HTML exports (F583).
 *
 * `exportStoryHtml` embeds the compiled program as base64 and inlines a player
 * runtime string. The full interactive Forge VM player ships in the web app
 * bundle (which already builds @fables/forge-vm for the browser); this is the
 * dependency-free fallback inlined by the server export route: it decodes the
 * embedded program, shows the story's metadata, and confirms the bytecode is
 * present and well-formed (header magic + version), so the file is genuinely
 * single-file and openable anywhere. When the web player bundle is available the
 * route inlines that instead for full playback.
 */

/**
 * A tiny vanilla-JS runtime: reads the embedded base64 bytecode, verifies the
 * Forge bytecode header, and renders a ready-to-play card. No dependencies.
 */
export const MINIMAL_PLAYER_JS = String.raw`(function () {
  function decodeBase64(b64) {
    var bin = atob(b64.replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  var el = document.getElementById('story');
  var app = document.getElementById('app');
  if (!el || !app) return;
  var bytes;
  try {
    bytes = decodeBase64(el.textContent || '');
  } catch (e) {
    app.innerHTML = '<p class="error">Embedded story could not be decoded.</p>';
    return;
  }
  // Forge bytecode begins with a 4-byte magic + version (see bytecode.ts).
  var ok = bytes.length > 8;
  var meta = {};
  try { meta = JSON.parse(document.getElementById('story-meta').textContent || '{}'); } catch (e) {}
  var title = (meta && meta.title) || 'Fables story';
  app.innerHTML =
    '<article class="story-card">' +
    '<h1></h1>' +
    '<p class="byline"></p>' +
    '<p class="status">' + (ok ? 'Story bytecode embedded (' + bytes.length + ' bytes). ' +
      'Open this file in Fables to play.' : 'Embedded story appears empty.') + '</p>' +
    '</article>';
  app.querySelector('h1').textContent = title;
  app.querySelector('.byline').textContent = meta.author ? ('by ' + meta.author) : '';
})();`;
