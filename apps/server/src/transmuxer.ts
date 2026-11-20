// @ts-expect-error -- mux.js ships no types of its own: what the engine uses of it is typed here.
import muxjs from 'mux.js';

export interface TransmuxedSegment {
  readonly initSegment: Uint8Array;
  readonly data: Uint8Array;
}

// MPEG-TS in, fragmented mp4 out: a fragment of picture and one of sound for every flush, each
// given with the init segment the file begins with (docs/adr/0010).
export interface Transmuxer {
  on(event: 'data', listener: (segment: TransmuxedSegment) => void): void;
  push(bytes: Uint8Array): void;
  flush(): void;
}

type TransmuxerOf = new (options: {
  readonly keepOriginalTimestamps: boolean;
  readonly remux: boolean;
}) => Transmuxer;

// Timestamps from zero: a stream's first piece need not start there.
export function createTransmuxer(): Transmuxer {
  const { Transmuxer } = (muxjs as { readonly mp4: { readonly Transmuxer: TransmuxerOf } }).mp4;
  return new Transmuxer({ keepOriginalTimestamps: false, remux: true });
}
