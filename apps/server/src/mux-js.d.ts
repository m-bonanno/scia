// What the engine uses of mux.js (docs/adr/0010), which ships no types of its own.
declare module 'mux.js' {
  interface TransmuxedSegment {
    readonly initSegment: Uint8Array;
    readonly data: Uint8Array;
  }
  interface Transmuxer {
    on(event: 'data', listener: (segment: TransmuxedSegment) => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
  const muxjs: {
    readonly mp4: {
      readonly Transmuxer: new (options: {
        readonly keepOriginalTimestamps: boolean;
        readonly remux: boolean;
      }) => Transmuxer;
    };
  };
  export default muxjs;
}
