import { describe, expect, it } from 'vitest';
import { HlsRefusal, ivOfSegment, parsePlaylist } from './hls.ts';

// A playlist a site serves (#383). Read again from each character of the run, it takes seconds;
// read once, a few milliseconds. The bound is the spec's own time limit, which Vitest holds also of a
// spec that never yields.
const LONG_RUN = 100_000;
const BOUND_MS = 1000;

const vod = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:7',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4.000000,',
  'segment0.ts',
  '#EXTINF:3.5,title',
  'https://cdn.example/segment1.ts',
  '#EXT-X-ENDLIST',
].join('\n');

describe('parsePlaylist', () => {
  it('reads the pieces of a stream that ends, with how long each lasts and its number', () => {
    const playlist = parsePlaylist(vod);

    expect(playlist.kind).toBe('media');
    if (playlist.kind !== 'media') return;
    expect(playlist.ends).toBe(true);
    expect(playlist.segments).toEqual([
      {
        uri: 'segment0.ts',
        duration: 4,
        sequence: 7,
        key: null,
        map: null,
        byteRange: null,
        discontinuity: false,
      },
      {
        uri: 'https://cdn.example/segment1.ts',
        duration: 3.5,
        sequence: 8,
        key: null,
        map: null,
        byteRange: null,
        discontinuity: false,
      },
    ]);
  });

  it('reads Windows line ends, blank lines and tags it does not know as nothing', () => {
    const playlist = parsePlaylist(
      vod
        .replace('#EXT-X-ENDLIST', '#EXT-X-SOMETHING-NEW:1\n\n#EXT-X-ENDLIST')
        .replace(/\n/g, '\r\n'),
    );

    expect(playlist.kind === 'media' && playlist.segments.length).toBe(2);
  });

  it('says a stream with no end is live', () => {
    const playlist = parsePlaylist(vod.replace('#EXT-X-ENDLIST', ''));

    expect(playlist.kind === 'media' && playlist.ends).toBe(false);
  });

  it('carries each key to the pieces after it, until another', () => {
    const playlist = parsePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000102030405060708090a0b0c0d0e0f',
        '#EXTINF:1,',
        'a.ts',
        '#EXT-X-KEY:METHOD=NONE',
        '#EXTINF:1,',
        'b.ts',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k?id=1,2"',
        '#EXTINF:1,',
        'c.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    );

    if (playlist.kind !== 'media') throw new Error('not media');
    expect(playlist.segments.map((segment) => segment.key)).toEqual([
      {
        method: 'AES-128',
        uri: 'key.bin',
        iv: '000102030405060708090a0b0c0d0e0f',
        keyFormat: 'identity',
      },
      null,
      { method: 'AES-128', uri: 'https://keys.example/k?id=1,2', iv: null, keyFormat: 'identity' },
    ]);
  });

  it('carries the init segment of fragmented pieces, and the byte ranges of pieces in one file', () => {
    const playlist = parsePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
        '#EXTINF:1,',
        '#EXT-X-BYTERANGE:1000@720',
        'all.mp4',
        '#EXTINF:1,',
        '#EXT-X-BYTERANGE:500',
        'all.mp4',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    );

    if (playlist.kind !== 'media') throw new Error('not media');
    expect(playlist.segments.map((segment) => [segment.map, segment.byteRange])).toEqual([
      [
        { uri: 'init.mp4', byteRange: { offset: 0, length: 720 }, keyed: false },
        { offset: 720, length: 1000 },
      ],
      // With no offset, a range starts where the one before ended.
      [
        { uri: 'init.mp4', byteRange: { offset: 0, length: 720 }, keyed: false },
        { offset: 1720, length: 500 },
      ],
    ]);
  });

  it('says whether an init segment was named under a key, which the standard encrypts with it', () => {
    const mapOf = (text: string) => {
      const playlist = parsePlaylist(text);
      return playlist.kind === 'media' ? playlist.segments[0]?.map : undefined;
    };

    expect(
      mapOf(
        '#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST',
      ),
    ).toEqual({ uri: 'i.mp4', byteRange: null, keyed: false });
    expect(
      mapOf(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXT-X-MAP:URI="i.mp4"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST',
      ),
    ).toEqual({ uri: 'i.mp4', byteRange: null, keyed: true });
  });

  it('tells a playlist of qualities from a playlist of pieces', () => {
    const playlist = parsePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"',
        'low/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
        'high/index.m3u8',
      ].join('\n'),
    );

    expect(playlist).toEqual({
      kind: 'master',
      variants: [
        { uri: 'low/index.m3u8', bandwidth: 800000, height: 360 },
        { uri: 'high/index.m3u8', bandwidth: 2800000, height: 720 },
      ],
    });
  });

  it('refuses a piece whose length no stream has: below zero, not a number, longer than a day', () => {
    for (const length of ['-1', '1e300', 'NaN', '90000']) {
      expect(
        () => parsePlaylist(vod.replace('#EXTINF:3.5,title', `#EXTINF:${length},`)),
        length,
      ).toThrow(HlsRefusal.NotAPlaylist);
    }
  });

  it('marks the piece after a discontinuity', () => {
    const playlist = parsePlaylist(
      vod.replace('#EXTINF:3.5,title', '#EXT-X-DISCONTINUITY\n#EXTINF:3.5,'),
    );

    expect(
      playlist.kind === 'media' && playlist.segments.map((segment) => segment.discontinuity),
    ).toEqual([false, true]);
  });

  it('says why a stream cannot be fetched: protected, or not a playlist at all', () => {
    expect(() => parsePlaylist('<!doctype html>')).toThrow(HlsRefusal.NotAPlaylist);
    expect(() =>
      parsePlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',
      ),
    ).toThrow(HlsRefusal.Protected);
    expect(() =>
      parsePlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',
      ),
    ).toThrow(HlsRefusal.Protected);
    expect(() =>
      parsePlaylist(
        '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="data:x"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',
      ),
    ).toThrow(HlsRefusal.Protected);
  });

  it(
    'reads a long attribute name that never gets its value once, not again from each character',
    () => {
      expect(parsePlaylist(`#EXTM3U\n#EXT-X-KEY:${'-'.repeat(LONG_RUN)}`)).toEqual({
        kind: 'media',
        ends: false,
        segments: [],
      });
    },
    BOUND_MS,
  );
});

describe('ivOfSegment', () => {
  it('takes the key’s own IV, or the piece’s number as sixteen bytes, as the standard says', () => {
    expect(ivOfSegment({ iv: '000102030405060708090a0b0c0d0e0f' }, 5)).toEqual(
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    );
    expect(ivOfSegment({ iv: null }, 258)).toEqual(
      Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]),
    );
  });
});
