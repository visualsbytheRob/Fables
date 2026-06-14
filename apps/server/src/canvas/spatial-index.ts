/**
 * Spatial index for canvas hit-testing at scale (F1503).
 *
 * A bulk-loaded bounding-volume R-tree: entries are recursively partitioned by
 * their centre along alternating axes (x, then y, …) at the median, and every
 * node stores the union bbox of its subtree. Region/point queries prune whole
 * subtrees whose bbox can't intersect, giving ~O(log n + k) lookups instead of a
 * full scan — the difference between a smooth 10k-object canvas and a janky one.
 *
 * It's rebuilt from the current object set rather than mutated in place: for a
 * canvas (a few thousand objects, changing in bursts) a fast rebuild is simpler
 * and just as quick as dynamic R-tree splits, with zero balance bugs.
 */

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialEntry<T> {
  bbox: BBox;
  item: T;
}

interface Leaf<T> {
  bbox: BBox;
  entries: SpatialEntry<T>[];
}
interface Branch<T> {
  bbox: BBox;
  left: Node<T>;
  right: Node<T>;
}
type Node<T> = Leaf<T> | Branch<T>;

const LEAF_SIZE = 8;

function isLeaf<T>(n: Node<T>): n is Leaf<T> {
  return (n as Leaf<T>).entries !== undefined;
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function union(boxes: BBox[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export class SpatialIndex<T> {
  private root: Node<T> | null = null;
  private count = 0;

  /** (Re)build the index from a set of entries. */
  load(entries: SpatialEntry<T>[]): this {
    this.count = entries.length;
    this.root = entries.length === 0 ? null : build([...entries], 0);
    return this;
  }

  get size(): number {
    return this.count;
  }

  /** All items whose bbox intersects the query region. */
  search(query: BBox): T[] {
    const out: T[] = [];
    if (this.root) collect(this.root, query, out);
    return out;
  }

  /** All items whose bbox contains the point (top hit-test). */
  hitTest(x: number, y: number): T[] {
    return this.search({ minX: x, minY: y, maxX: x, maxY: y });
  }
}

function build<T>(entries: SpatialEntry<T>[], depth: number): Node<T> {
  if (entries.length <= LEAF_SIZE) {
    return { bbox: union(entries.map((e) => e.bbox)), entries };
  }
  // Partition by centre along the alternating axis at the median.
  const axis = depth % 2 === 0 ? 'x' : 'y';
  const centre = (b: BBox) => (axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2);
  entries.sort((a, b) => centre(a.bbox) - centre(b.bbox));
  const mid = entries.length >> 1;
  const left = build(entries.slice(0, mid), depth + 1);
  const right = build(entries.slice(mid), depth + 1);
  return { bbox: union([left.bbox, right.bbox]), left, right };
}

function collect<T>(node: Node<T>, query: BBox, out: T[]): void {
  if (!intersects(node.bbox, query)) return;
  if (isLeaf(node)) {
    for (const e of node.entries) {
      if (intersects(e.bbox, query)) out.push(e.item);
    }
  } else {
    collect(node.left, query, out);
    collect(node.right, query, out);
  }
}
