import { PageFailure } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { chooseMedia, type PageFormat, PageError } from './media-choice.ts';

const file = (overrides: Partial<PageFormat> = {}): PageFormat => ({
  url: 'https://cdn.example/video.mp4',
  protocol: 'https',
  ext: 'mp4',
  vcodec: 'avc1',
  acodec: 'mp4a',
  height: 720,
  hasDrm: false,
  headers: {},
  bitrate: null,
  languagePreference: null,
  ...overrides,
});

// A picture with no sound, and a sound with no picture, as a site offers them apart.
const picture = (overrides: Partial<PageFormat> = {}) =>
  file({
    url: 'https://cdn.example/picture.mp4',
    vcodec: 'avc1.640028',
    acodec: 'none',
    ...overrides,
  });
const sound = (overrides: Partial<PageFormat> = {}) =>
  file({
    url: 'https://cdn.example/sound.m4a',
    ext: 'm4a',
    vcodec: 'none',
    acodec: 'mp4a.40.2',
    height: null,
    bitrate: 128,
    ...overrides,
  });

describe('chooseMedia', () => {
  it('takes the format with the most lines of picture, among those that are one file with sound', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/360.mp4', height: 360 }),
      file({ url: 'https://cdn.example/1080.mp4', height: 1080 }),
      file({ url: 'https://cdn.example/720.mp4', height: 720 }),
    ]);

    expect(chosen.url).toBe('https://cdn.example/1080.mp4');
    expect(chosen.info).toEqual({ ext: 'mp4', height: 1080 });
  });

  it('leaves aside a picture with no sound to go with it, a sound alone, and DASH', () => {
    const chosen = chooseMedia([
      picture({ url: 'https://cdn.example/video-only.mp4', height: 2160 }),
      sound({ url: 'https://cdn.example/opus.webm', ext: 'webm', acodec: 'opus' }),
      file({ url: 'https://cdn.example/dash', height: 1080, protocol: 'http_dash_segments' }),
      file({ url: 'https://cdn.example/480.mp4', height: 480 }),
    ]);

    expect(chosen.url).toBe('https://cdn.example/480.mp4');
  });

  it('takes a format whose codecs the site does not name as one with picture and sound', () => {
    const chosen = chooseMedia([file({ vcodec: undefined, acodec: undefined, height: 240 })]);

    expect(chosen.info).toEqual({ ext: 'mp4', height: 240 });
  });

  it('takes an mp4, which every player opens, over a format with more lines of picture in another container', () => {
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/a.webm', ext: 'webm', height: 1080 }),
        file({ url: 'https://cdn.example/b.mp4', ext: 'mp4', height: 240 }),
        file({ url: 'https://cdn.example/c.ogv', ext: 'ogv', height: 304 }),
      ]).url,
    ).toBe('https://cdn.example/b.mp4');
    // With no mp4 at all, the most lines of picture in whatever container.
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/a.webm', ext: 'webm', height: 480 }),
        file({ url: 'https://cdn.example/c.ogv', ext: 'ogv', height: 304 }),
      ]).url,
    ).toBe('https://cdn.example/a.webm');
  });

  it('takes the later one the site lists between equals', () => {
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/first.mp4' }),
        file({ url: 'https://cdn.example/second.mp4' }),
      ]).url,
    ).toBe('https://cdn.example/second.mp4');
  });

  it('takes an HLS stream, which it makes into an mp4, when it has more lines than any file', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/480.mp4', height: 480 }),
      file({ url: 'https://cdn.example/1080/index.m3u8', protocol: 'm3u8_native', height: 1080 }),
      file({ url: 'https://cdn.example/dash', protocol: 'http_dash_segments', height: 2160 }),
    ]);

    expect(chosen).toEqual({
      url: 'https://cdn.example/1080/index.m3u8',
      headers: {},
      kind: 'hls',
      info: { ext: 'mp4', height: 1080 },
    });
  });

  it('takes a file over a stream of as many lines: it is fetched as it stands', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/720.mp4' }),
      file({ url: 'https://cdn.example/720/index.m3u8', protocol: 'm3u8' }),
    ]);

    expect([chosen.url, chosen.kind]).toEqual(['https://cdn.example/720.mp4', 'file']);
  });

  it('puts a format of unknown height below every known one', () => {
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/unknown.mp4', height: null }),
        file({ url: 'https://cdn.example/144.mp4', height: 144 }),
      ]).url,
    ).toBe('https://cdn.example/144.mp4');
  });

  it('keeps the headers the site asks for with the format it chose', () => {
    const chosen = chooseMedia([
      file({ headers: { 'User-Agent': 'Agent/1', Referer: 'https://site.example/' } }),
    ]);

    expect(chosen.headers).toEqual({ 'User-Agent': 'Agent/1', Referer: 'https://site.example/' });
  });

  it('never takes a protected format, and says so when only protected ones are left', () => {
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/protected.mp4', height: 1080, hasDrm: true }),
        file({ url: 'https://cdn.example/open.mp4', height: 360 }),
      ]).url,
    ).toBe('https://cdn.example/open.mp4');

    expect(() => chooseMedia([file({ hasDrm: true })])).toThrow(
      expect.objectContaining({ failure: PageFailure.Drm }),
    );
  });

  it('says a video offered only as DASH, or apart in forms it does not join, is not one it can fetch yet, and not that the page is unreadable', () => {
    const streams = () =>
      chooseMedia([
        file({ protocol: 'http_dash_segments' }),
        file({ protocol: 'https', acodec: 'none' }),
      ]);
    const apart = () =>
      chooseMedia([
        picture({ ext: 'webm', vcodec: 'vp09.00.40.08', height: 2160 }),
        sound({ ext: 'webm', acodec: 'opus' }),
      ]);

    expect(streams).toThrow(PageError);
    expect(streams).toThrow(expect.objectContaining({ failure: PageFailure.FormatUnsupported }));
    expect(apart).toThrow(expect.objectContaining({ failure: PageFailure.FormatUnsupported }));
  });

  it('joins a picture and a sound offered apart when the picture has more lines than any one file', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/360.mp4', height: 360 }),
      picture({
        url: 'https://cdn.example/1080.mp4',
        height: 1080,
        headers: { Referer: 'https://site.example/' },
      }),
      picture({ url: 'https://cdn.example/720.mp4', height: 720 }),
      sound({ url: 'https://cdn.example/48k.m4a', bitrate: 48 }),
      sound({
        url: 'https://cdn.example/128k.m4a',
        bitrate: 128,
        headers: { 'User-Agent': 'Agent/1' },
      }),
    ]);

    expect(chosen).toEqual({
      url: 'https://cdn.example/1080.mp4',
      headers: { Referer: 'https://site.example/' },
      kind: 'pair',
      info: { ext: 'mp4', height: 1080 },
      sound: { url: 'https://cdn.example/128k.m4a', headers: { 'User-Agent': 'Agent/1' } },
    });
  });

  it('takes one file over a picture and sound of as many lines: nothing to join', () => {
    const chosen = chooseMedia([
      picture({ height: 720 }),
      sound(),
      file({ url: 'https://cdn.example/720.mp4', height: 720 }),
    ]);

    expect([chosen.url, chosen.kind]).toEqual(['https://cdn.example/720.mp4', 'file']);
  });

  it('takes a picture and sound over a stream of as many lines: two files over several connections', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/1080/index.m3u8', protocol: 'm3u8_native', height: 1080 }),
      picture({ height: 1080 }),
      sound(),
    ]);

    expect(chosen.kind).toBe('pair');
  });

  it('takes H.264, which every player opens, over AV1 of as many lines, and AV1 when it has more (the owner, #99)', () => {
    const h264 = picture({
      url: 'https://cdn.example/h264.mp4',
      height: 1080,
      vcodec: 'avc1.640028',
    });
    const av1 = (height: number) =>
      picture({
        url: 'https://cdn.example/av1-' + String(height) + '.mp4',
        height,
        vcodec: 'av01.0.08M.08',
      });

    expect(chooseMedia([h264, av1(1080), sound()]).url).toBe('https://cdn.example/h264.mp4');
    expect(chooseMedia([av1(1080), h264, sound()]).url).toBe('https://cdn.example/h264.mp4');
    expect(chooseMedia([h264, av1(2160), sound()]).url).toBe('https://cdn.example/av1-2160.mp4');
  });

  it('never joins HEVC, VP9, a picture outside an mp4, or a sound that is not AAC (the owner, #99)', () => {
    const chosen = chooseMedia([
      picture({ url: 'https://cdn.example/hevc.mp4', height: 2160, vcodec: 'hvc1.2.4.L153' }),
      picture({ url: 'https://cdn.example/hev1.mp4', height: 2160, vcodec: 'hev1.1.6.L150' }),
      picture({ url: 'https://cdn.example/vp9.mp4', height: 2160, vcodec: 'vp09.00.50.08' }),
      picture({
        url: 'https://cdn.example/av1.webm',
        ext: 'webm',
        height: 2160,
        vcodec: 'av01.0.12M.08',
      }),
      picture({ url: 'https://cdn.example/480.mp4', height: 480 }),
      sound({ url: 'https://cdn.example/opus.m4a', acodec: 'opus', bitrate: 160 }),
      sound({ url: 'https://cdn.example/aac.m4a', bitrate: 96 }),
    ]);

    expect([chosen.url, chosen.sound?.url]).toEqual([
      'https://cdn.example/480.mp4',
      'https://cdn.example/aac.m4a',
    ]);
  });

  it("takes the video's own language first, then the sound of the highest bitrate", () => {
    const chosen = chooseMedia([
      picture(),
      sound({ url: 'https://cdn.example/dubbed.m4a', bitrate: 256, languagePreference: -1 }),
      sound({ url: 'https://cdn.example/original.m4a', bitrate: 128, languagePreference: 10 }),
      sound({ url: 'https://cdn.example/original-low.m4a', bitrate: 48, languagePreference: 10 }),
    ]);

    expect(chosen.sound?.url).toBe('https://cdn.example/original.m4a');
  });

  it('joins nothing protected, and nothing outside one file over http(s)', () => {
    const chosen = chooseMedia([
      picture({ url: 'https://cdn.example/protected.mp4', height: 2160, hasDrm: true }),
      picture({
        url: 'https://cdn.example/dash.mp4',
        height: 1440,
        protocol: 'http_dash_segments',
      }),
      picture({ url: 'https://cdn.example/1080.mp4', height: 1080 }),
      sound({ url: 'https://cdn.example/protected.m4a', hasDrm: true, bitrate: 256 }),
      sound({ url: 'https://cdn.example/open.m4a', bitrate: 64 }),
    ]);

    expect([chosen.url, chosen.sound?.url]).toEqual([
      'https://cdn.example/1080.mp4',
      'https://cdn.example/open.m4a',
    ]);
  });

  it('joins nothing for a download whose bytes are of another container than an mp4', () => {
    const chosen = chooseMedia(
      [
        picture({ height: 1080 }),
        sound(),
        file({ url: 'https://cdn.example/a.webm', ext: 'webm', height: 360 }),
      ],
      'webm',
    );

    expect([chosen.url, chosen.kind]).toEqual(['https://cdn.example/a.webm', 'file']);
  });

  it('says a page with no format at all could not be read', () => {
    expect(() => chooseMedia([])).toThrow(
      expect.objectContaining({ failure: PageFailure.Unreadable }),
    );
  });
});
