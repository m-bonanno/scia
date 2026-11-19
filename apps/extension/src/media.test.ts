import { describe, expect, it } from 'vitest';
import { MEDIA_PER_TAB, type MediaItem, mediaOf, withMedia } from './media.ts';

const MIB = 1024 * 1024;

function response(headers: Record<string, string>, overrides: object = {}) {
  return {
    url: 'https://cdn.example.com/video/film.mp4?token=abc',
    method: 'GET',
    statusCode: 200,
    responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
    ...overrides,
  };
}

describe('mediaOf', () => {
  it('offers a video the page loaded, with its name and size', () => {
    expect(
      mediaOf(response({ 'Content-Type': 'video/mp4', 'Content-Length': String(80 * MIB) })),
    ).toEqual({
      url: 'https://cdn.example.com/video/film.mp4?token=abc',
      kind: 'video',
      fileName: 'film.mp4',
      size: 80 * MIB,
    });
  });

  it('reads the size of the whole file from a ranged answer', () => {
    const media = mediaOf(
      response(
        {
          'content-type': 'video/webm',
          'content-length': '1024',
          'content-range': `bytes 0-1023/${String(200 * MIB)}`,
        },
        { statusCode: 206 },
      ),
    );
    expect(media?.size).toBe(200 * MIB);
  });

  it('prefers the name the host gives the file', () => {
    const media = mediaOf(
      response({
        'content-type': 'audio/mpeg',
        'content-disposition': 'attachment; filename="Intervista.mp3"',
      }),
    );
    expect(media).toMatchObject({ kind: 'audio', fileName: 'Intervista.mp3', size: null });
  });

  it('ignores what is not a whole media file', () => {
    expect(mediaOf(response({ 'content-type': 'text/html' }))).toBeUndefined();
    expect(
      mediaOf(response({ 'content-type': 'video/mp4', 'content-length': '2048' })),
    ).toBeUndefined();
    expect(mediaOf(response({ 'content-type': 'application/vnd.apple.mpegurl' }))).toBeUndefined();
  });

  it('ignores an upload, a redirect and an error', () => {
    const video = { 'content-type': 'video/mp4' };
    expect(mediaOf(response(video, { method: 'POST' }))).toBeUndefined();
    expect(mediaOf(response(video, { statusCode: 302 }))).toBeUndefined();
    expect(mediaOf(response(video, { statusCode: 404 }))).toBeUndefined();
  });
});

describe('withMedia', () => {
  const item = (index: number): MediaItem => ({
    url: `https://cdn.example.com/${String(index)}.mp4`,
    kind: 'video',
    fileName: `${String(index)}.mp4`,
    size: null,
  });

  it('keeps one entry for a file asked twice, as the latest', () => {
    const list = withMedia(withMedia(withMedia([], item(1)), item(2)), { ...item(1), size: 5 });
    expect(list.map((media) => media.fileName)).toEqual(['2.mp4', '1.mp4']);
    expect(list[1]?.size).toBe(5);
  });

  it('drops the oldest when the list is full', () => {
    let list: MediaItem[] = [];
    for (let index = 0; index < MEDIA_PER_TAB + 5; index += 1) list = withMedia(list, item(index));
    expect(list).toHaveLength(MEDIA_PER_TAB);
    expect(list[0]?.fileName).toBe('5.mp4');
  });
});
