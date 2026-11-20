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

  it('leaves aside a picture with no sound, a sound with no picture, and a stream', () => {
    const chosen = chooseMedia([
      file({ url: 'https://cdn.example/video-only.mp4', height: 2160, acodec: 'none' }),
      file({ url: 'https://cdn.example/audio-only.m4a', height: null, vcodec: 'none' }),
      file({ url: 'https://cdn.example/index.m3u8', height: 1080, protocol: 'm3u8_native' }),
      file({ url: 'https://cdn.example/dash', height: 1080, protocol: 'http_dash_segments' }),
      file({ url: 'https://cdn.example/480.mp4', height: 480 }),
    ]);

    expect(chosen.url).toBe('https://cdn.example/480.mp4');
  });

  it('takes a format whose codecs the site does not name as one with picture and sound', () => {
    const chosen = chooseMedia([file({ vcodec: undefined, acodec: undefined, height: 240 })]);

    expect(chosen.info).toEqual({ ext: 'mp4', height: 240 });
  });

  it('prefers an mp4 between two of the same height, and the later one the site lists between equals', () => {
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/a.webm', ext: 'webm' }),
        file({ url: 'https://cdn.example/b.mp4', ext: 'mp4' }),
        file({ url: 'https://cdn.example/c.webm', ext: 'webm' }),
      ]).url,
    ).toBe('https://cdn.example/b.mp4');
    expect(
      chooseMedia([
        file({ url: 'https://cdn.example/first.mp4' }),
        file({ url: 'https://cdn.example/second.mp4' }),
      ]).url,
    ).toBe('https://cdn.example/second.mp4');
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

  it('says a video offered only as a stream, or as picture and sound apart, is not one it can fetch yet, and not that the page is unreadable', () => {
    const streams = () =>
      chooseMedia([
        file({ protocol: 'm3u8_native' }),
        file({ protocol: 'm3u8' }),
        file({ protocol: 'https', acodec: 'none' }),
      ]);
    const apart = () =>
      chooseMedia([file({ acodec: 'none', height: 2160 }), file({ vcodec: 'none', height: null })]);

    expect(streams).toThrow(PageError);
    expect(streams).toThrow(expect.objectContaining({ failure: PageFailure.FormatUnsupported }));
    expect(apart).toThrow(expect.objectContaining({ failure: PageFailure.FormatUnsupported }));
  });

  it('says a page with no format at all could not be read', () => {
    expect(() => chooseMedia([])).toThrow(
      expect.objectContaining({ failure: PageFailure.Unreadable }),
    );
  });
});
