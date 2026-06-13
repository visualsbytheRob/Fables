/**
 * OCR provider interface (F763).
 *
 * Design: graceful-degradation, matching the EmbeddingProvider pattern.
 *
 * The stub implementation (returned by default) reports available()=false,
 * so callers can check before attempting OCR and record a clear "OCR unavailable"
 * message in the job log instead of crashing.
 *
 * To enable real OCR:
 *   1. Install tesseract binary: `brew install tesseract` or `apt install tesseract-ocr`
 *   2. Install node-tesseract-ocr: `pnpm add node-tesseract-ocr`
 *   3. Replace this module's `createOcrProvider()` factory to instantiate the
 *      real tesseract wrapper, checking `shutil.which('tesseract')` or
 *      dynamic-importing `node-tesseract-ocr` with the same guard pattern.
 *
 * Scanned-PDF path (F763):
 *   When ingesting a PDF, the PDF extractor checks whether pdfjs returns empty
 *   text for a page — if so and OCR is available(), it calls ocrProvider.recognise().
 *   If OCR is unavailable, the job note records "page N: OCR unavailable — install
 *   tesseract to extract text from scanned pages."
 */

export interface OcrProvider {
  /** Whether tesseract (or equivalent) is installed and ready. */
  available(): boolean;
  /**
   * Recognise text in an image buffer.
   * Returns the extracted text, or throws on error.
   * Only call when available()=true.
   */
  recognise(imageBuffer: Buffer, mimeType: string): Promise<string>;
}

/** Default stub — always unavailable. Zero deps, never crashes. */
export const unavailableOcrProvider: OcrProvider = {
  available(): boolean {
    return false;
  },
  async recognise(_imageBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error(
      'OCR is unavailable — install tesseract and the node-tesseract-ocr package to enable it',
    );
  },
};

/**
 * Factory that tries to load tesseract dynamically.
 * Returns unavailableOcrProvider if the binary or npm package is missing.
 *
 * Usage: const ocr = await createOcrProvider();
 *        if (ocr.available()) { const text = await ocr.recognise(buf, 'image/png'); }
 */
export async function createOcrProvider(): Promise<OcrProvider> {
  try {
    // Dynamically check for node-tesseract-ocr without crashing if absent.
    const dynamicImport = new Function('m', 'return import(m)') as (
      m: string,
    ) => Promise<unknown>;
    const mod = await dynamicImport('node-tesseract-ocr').catch(() => null);
    if (!mod) return unavailableOcrProvider;

    const { recognize } = mod as { recognize: (buf: Buffer, opts?: object) => Promise<string> };
    if (typeof recognize !== 'function') return unavailableOcrProvider;

    // Quick smoke-test: call with an empty buffer to see if tesseract binary is present.
    // We catch any error — if it throws "tesseract not found" we stay unavailable.
    try {
      await recognize(Buffer.from(''), { lang: 'eng', oem: 1, psm: 3 });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not found') || msg.includes('No such file') || msg.includes('ENOENT')) {
        return unavailableOcrProvider;
      }
      // Any other error (e.g. "empty image") means tesseract IS present — continue.
    }

    return {
      available(): boolean {
        return true;
      },
      async recognise(imageBuffer: Buffer, _mimeType: string): Promise<string> {
        return recognize(imageBuffer, { lang: 'eng', oem: 1, psm: 3 });
      },
    };
  } catch {
    return unavailableOcrProvider;
  }
}
