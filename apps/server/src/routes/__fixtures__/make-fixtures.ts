/**
 * Generates minimal valid test fixtures for ingest tests.
 * All fixtures are constructed in-memory — no files on disk.
 */

import { zipSync, strToU8 } from 'fflate';

/** Minimal valid HTML page. */
export const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article</title>
  <meta property="og:site_name" content="Test Site">
  <link rel="icon" href="/favicon.ico">
</head>
<body>
  <article>
    <h1>Hello World</h1>
    <p>This is the article body. It has enough text to pass Readability.</p>
    <p>A second paragraph with more content to make Readability happy.</p>
    <p>And a third paragraph to ensure we have enough text.</p>
    <img src="https://example.com/image.jpg" alt="test image">
  </article>
</body>
</html>`;

/** Minimal valid EPUB as a Uint8Array. */
export function makeMinimalEpub(): Buffer {
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1>Chapter One</h1>
  <p>This is the first chapter of the test book.</p>
  <p>It has multiple paragraphs to test extraction.</p>
</body>
</html>`;

  const mimetypeContent = strToU8('application/epub+zip');

  const files: Record<string, Uint8Array> = {
    'mimetype': mimetypeContent,
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(opfXml),
    'OEBPS/chapter1.xhtml': strToU8(chapter1),
  };

  const zipped = zipSync(files, {
    // mimetype must be uncompressed per EPUB spec
    level: 6,
  });
  return Buffer.from(zipped);
}
