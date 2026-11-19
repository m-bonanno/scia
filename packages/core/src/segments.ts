// A byte range of the file, [start, end), and how many of its bytes are on disk from `start`.
export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly downloaded: number;
}

export function remainingBytes(segment: Segment): number {
  return segment.end - segment.start - segment.downloaded;
}

// The offset of the next byte the segment needs.
export function positionOf(segment: Segment): number {
  return segment.start + segment.downloaded;
}

export function downloadedBytes(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + segment.downloaded, 0);
}

export function isComplete(segments: readonly Segment[]): boolean {
  return segments.every((segment) => remainingBytes(segment) === 0);
}

// One segment per connection, none smaller than `minSegmentBytes`: a small file is not worth
// eight handshakes.
export function planSegments(
  totalBytes: number,
  connections: number,
  minSegmentBytes: number,
): Segment[] {
  if (totalBytes <= 0) return [];
  const count = Math.max(
    1,
    Math.min(Math.floor(connections), Math.floor(totalBytes / minSegmentBytes)),
  );
  const base = Math.floor(totalBytes / count);
  const extra = totalBytes % count;
  const segments: Segment[] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const end = start + base + (index < extra ? 1 : 0);
    segments.push({ start, end, downloaded: 0 });
    start = end;
  }
  return segments;
}

// The same bytes in as few ranges as say it: a finished range joins the one that follows it.
// What is on disk of a range is counted from its start, so the union is still one range.
export function compactSegments(segments: readonly Segment[]): Segment[] {
  const compact: Segment[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const previous = compact.at(-1);
    if (previous?.end === segment.start && remainingBytes(previous) === 0) {
      compact[compact.length - 1] = {
        start: previous.start,
        end: segment.end,
        downloaded: previous.downloaded + segment.downloaded,
      };
    } else {
      compact.push(segment);
    }
  }
  return compact;
}

export interface SegmentSplit {
  readonly index: number;
  // The segment at `index`, ending where the new one starts.
  readonly shrunk: Segment;
  readonly added: Segment;
}

// Dynamic segmentation: a connection that finished its range takes the second half of the range
// with the most left, so every connection stays busy until the file ends.
export function splitLargest(
  segments: readonly Segment[],
  minSplitBytes: number,
): SegmentSplit | undefined {
  let index = -1;
  let largest = 0;
  for (const [candidate, segment] of segments.entries()) {
    const remaining = remainingBytes(segment);
    if (remaining > largest) {
      largest = remaining;
      index = candidate;
    }
  }
  const segment = segments[index];
  if (segment === undefined || largest < minSplitBytes * 2) return undefined;
  const middle = positionOf(segment) + Math.ceil(largest / 2);
  return {
    index,
    shrunk: { ...segment, end: middle },
    added: { start: middle, end: segment.end, downloaded: 0 },
  };
}
