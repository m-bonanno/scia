import { describe, expect, it } from 'vitest';
import { type Ended, Ending } from './ended-downloads.ts';
import { endedNotice } from './ended-notice.ts';

const completed = (fileName: string): Ended => ({
  id: fileName,
  fileName,
  ending: Ending.Completed,
});
const failed = (fileName: string): Ended => ({ id: fileName, fileName, ending: Ending.Failed });
const going = { lastOfHiddenScia: false };
const idle = { lastOfHiddenScia: true };
// What the system shows under a title before it cuts: the body is never longer.
const linesOf = (body: string) => body.split('\n');

describe('endedNotice', () => {
  it('names the one download that completed, in the word its row uses', () => {
    expect(endedNotice([completed('Film.mkv')], going)).toEqual({
      title: 'Download completed',
      body: 'Film.mkv',
    });
  });

  it('says a failure as a failure, and leaves the reason to the row', () => {
    expect(endedNotice([failed('setup.exe')], going)).toEqual({
      title: 'Download failed',
      body: 'setup.exe',
    });
  });

  it('counts the downloads that ended together, each on a line of its own, up to four', () => {
    expect(
      endedNotice([completed('a.mkv'), completed('b.mkv'), completed('c.mkv')], going),
    ).toEqual({ title: '3 downloads completed', body: 'a.mkv\nb.mkv\nc.mkv' });
    expect(endedNotice([failed('a.mkv'), failed('b.mkv')], going)).toEqual({
      title: '2 downloads failed',
      body: 'a.mkv\nb.mkv',
    });
    expect(
      endedNotice(
        ['a', 'b', 'c', 'd'].map((name) => completed(`${name}.mkv`)),
        going,
      ).body,
    ).toBe('a.mkv\nb.mkv\nc.mkv\nd.mkv');
  });

  it('names three and counts the rest, so that a playlist is four lines and not a wall', () => {
    const many = ['1', '2', '3', '4', '5', '6'].map((name) => completed(`${name}.mp4`));

    expect(endedNotice(many, going)).toEqual({
      title: '6 downloads completed',
      body: '1.mp4\n2.mp4\n3.mp4\nand 3 more',
    });
  });

  it('puts first, and marks, what failed among downloads that completed', () => {
    expect(endedNotice([completed('a.mkv'), failed('b.mkv'), completed('c.mkv')], going)).toEqual({
      title: '2 downloads completed, 1 failed',
      body: 'Failed: b.mkv\na.mkv\nc.mkv',
    });
    // Past the names there is room for, the one that failed is still among those named.
    const mixed = [
      ...['1', '2', '3', '4', '5'].map((name) => completed(`${name}.mp4`)),
      failed('6.mp4'),
    ];
    expect(endedNotice(mixed, going).body).toBe('Failed: 6.mp4\n1.mp4\n2.mp4\nand 3 more');
  });

  it('says for the last download of a hidden Scia that nothing else is downloading, and where Scia is', () => {
    expect(endedNotice([completed('Film.mkv')], idle)).toEqual({
      title: 'Download completed',
      body: 'Film.mkv\nNothing else is downloading.\nScia is still in the system tray.',
    });
    // True after a failure too, and with a paused download still in the list.
    expect(endedNotice([failed('setup.exe')], idle).body).toBe(
      'setup.exe\nNothing else is downloading.\nScia is still in the system tray.',
    );
  });

  it('never lets those two sentences fall past the fourth line, which the system cuts', () => {
    const two = endedNotice([completed('a.mkv'), completed('b.mkv')], idle).body;
    expect(two).toBe(
      'a.mkv\nb.mkv\nNothing else is downloading.\nScia is still in the system tray.',
    );

    const many = endedNotice(
      ['1', '2', '3', '4', '5', '6'].map((name) => completed(`${name}.mp4`)),
      idle,
    );
    expect(many.body).toBe(
      '1.mp4\nand 5 more\nNothing else is downloading.\nScia is still in the system tray.',
    );
    expect(linesOf(many.body)).toHaveLength(4);
  });

  it('keeps a long name on one line: cut in the middle, its end and its extension kept', () => {
    const long = 'Big Buck Bunny (2008) 1080p 60fps surround - the director’s cut - remastered.mkv';

    const { body } = endedNotice([completed(long)], going);

    expect(body.length).toBeLessThanOrEqual(40);
    expect(body.startsWith('Big Buck Bunny (2008)')).toBe(true);
    expect(body.endsWith('remastered.mkv')).toBe(true);
    expect(body).toContain('…');
    // The mark of a failure is part of the line.
    const marked = linesOf(endedNotice([failed(long), completed('a.mkv')], going).body)[0]!;
    expect(marked.startsWith('Failed: Big Buck Bunny')).toBe(true);
    expect(marked.length).toBeLessThanOrEqual(40);
  });

  it('cuts a name between characters, never through one: an emoji and a flag stay whole', () => {
    const characters = (text: string) =>
      Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
    // Half of a character that takes two units of the text: what a cut by units leaves behind.
    const halved = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    // Emoji where the beginning is cut, and where the end that is kept begins.
    const smiling = endedNotice(
      [completed(`${'1234567890'.repeat(2)}1234${'😀'.repeat(13)}-holiday.mp4`)],
      going,
    ).body;
    const laughing = endedNotice([completed(`Trip to the sea ${'😂'.repeat(40)}.mp4`)], going).body;
    // A flag is two characters of two units each, shown as one.
    const flags = endedNotice(
      [completed(`Trip ${'🇮🇹'.repeat(30)} and back again.mp4`)],
      going,
    ).body;

    for (const line of [smiling, laughing, flags]) {
      expect(halved.test(line), line).toBe(false);
      expect(characters(line), line).toBeLessThanOrEqual(40);
      expect(line).toContain('…');
      expect(line.endsWith('.mp4')).toBe(true);
    }
    expect(flags.replaceAll('🇮🇹', '')).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  it('counts the end it keeps in characters too: ten of them, not ten units of the text', () => {
    // Ten units back from the extension fall in the middle of an emoji in both names.
    const holidays = endedNotice(
      [completed(`${'1234567890'.repeat(3)}${'😀'.repeat(6)}-holidays.mp4`)],
      going,
    ).body;
    const laughing = endedNotice(
      [completed(`${'a'.repeat(40)}${'😂'.repeat(4)}abc.mp4`)],
      going,
    ).body;
    const halved = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    expect(halved.test(holidays), holidays).toBe(false);
    expect(holidays.endsWith('…😀-holidays.mp4')).toBe(true);
    expect(halved.test(laughing), laughing).toBe(false);
    expect(laughing.endsWith('…aaa😂😂😂😂abc.mp4')).toBe(true);
  });

  it('counts the room in characters too: a name of emoji that fits the line is left whole', () => {
    // Thirty-four characters as a person sees them, sixty-four units of the text.
    const fits = `${'😀'.repeat(30)}.mkv`;

    expect(endedNotice([completed(fits)], going).body).toBe(fits);
    // Marked, the room is thirty-two: seventeen, the mark of the cut, the ten kept and ".mkv".
    expect(endedNotice([failed(fits), completed('a.mkv')], going).body).toBe(
      `Failed: ${'😀'.repeat(17)}…${'😀'.repeat(10)}.mkv\na.mkv`,
    );
  });
});
