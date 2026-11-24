import { describe, expect, it } from 'vitest';
import { Offered, offeredAs } from './offered-links.ts';

describe('offeredAs', () => {
  it('takes a link whose name ends with the extension of a file to keep', () => {
    for (const url of [
      'https://example.com/files/setup.exe',
      'https://example.com/a/archive.zip?token=1',
      'http://example.org/Film.MKV',
      'https://example.com/song.flac#start',
      'https://example.com/book.pdf',
      'https://example.com/os/disc.iso',
      'https://example.com/My%20Report.docx',
    ]) {
      expect(offeredAs(url), url).toBe(Offered.File);
    }
  });

  it('leaves out an image, a web page and an address with no file name', () => {
    for (const url of [
      'https://example.com/photo.jpg',
      'https://example.com/logo.PNG',
      'https://example.com/anim.gif',
      'https://example.com/',
      'https://example.com',
      'https://example.com/blog/post',
      'https://example.com/index.html',
      'https://example.com/page.php?file=archive.zip',
      // The host's name ends like a program; its path is what names a file.
      'https://example.com/about',
    ]) {
      expect(offeredAs(url), url).toBeUndefined();
    }
  });

  it("takes the page of a video on a site it knows, on the site's domain or any of its names", () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://youtube.com/shorts/abcdefghijk',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/76979871',
      'https://player.vimeo.com/video/76979871',
      'https://www.dailymotion.com/video/x8abcd',
      'https://www.twitch.tv/videos/123456789',
      'https://www.tiktok.com/@someone/video/7234567890123456789',
      'https://archive.org/details/some-film',
      'https://www.pornhub.com/view_video.php?viewkey=ph5f1a2b3c4d5e6',
      'https://it.pornhub.com/view_video.php?pkey=1&viewkey=64a1b2c3d4e5f',
      'https://www.pornhub.com/embed/ph5f1a2b3c4d5e6',
    ]) {
      expect(offeredAs(url), url).toBe(Offered.VideoPage);
    }
  });

  it("leaves out a known site's pages that are not one video: its home, a channel, a list, a search", () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/results?search_query=cats',
      'https://www.youtube.com/watch?list=PL123',
      'https://vimeo.com/channels/staffpicks',
      'https://www.dailymotion.com/someone',
      'https://www.twitch.tv/someone',
      'https://www.tiktok.com/@someone',
      'https://archive.org/search?query=film',
      'https://www.pornhub.com/',
      'https://www.pornhub.com/model/someone',
      'https://www.pornhub.com/video/search?search=cats',
      'https://www.pornhub.com/playlist/123456',
      'https://www.pornhub.com/view_video.php',
      'https://www.pornhub.com/view_video.php?viewkey=',
    ]) {
      expect(offeredAs(url), url).toBeUndefined();
    }
  });

  it("never takes a site by a name that only contains the site's", () => {
    expect(offeredAs('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(offeredAs('https://youtube.com.example.net/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(offeredAs('https://example.com/?u=https://youtu.be/dQw4w9WgXcQ')).toBeUndefined();
  });

  it('takes nothing that is not an http(s) address', () => {
    expect(offeredAs('ftp://example.com/setup.exe')).toBeUndefined();
    expect(offeredAs('not a link')).toBeUndefined();
  });
});
