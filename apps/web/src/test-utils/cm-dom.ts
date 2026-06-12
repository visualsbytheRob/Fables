/**
 * jsdom lacks the layout APIs CodeMirror probes while measuring (Range
 * client rects). Install inert stubs so editor component tests run quietly.
 */
export function installCodeMirrorDomStubs(): void {
  if (typeof Range === 'undefined') return;
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
  const rectList = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
  } as unknown as DOMRectList;
  Range.prototype.getClientRects = () => rectList;
  Range.prototype.getBoundingClientRect = () => rect;
}
