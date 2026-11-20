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

  it('counts the downloads that ended together, each on a line of its own', () => {
    expect(
      endedNotice([completed('a.mkv'), completed('b.mkv'), completed('c.mkv')], going),
    ).toEqual({ title: '3 downloads completed', body: 'a.mkv\nb.mkv\nc.mkv' });
    expect(endedNotice([failed('a.mkv'), failed('b.mkv')], going)).toEqual({
      title: '2 downloads failed',
      body: 'a.mkv\nb.mkv',
    });
  });

  it('tells apart what completed and what failed when both ended together', () => {
    expect(endedNotice([completed('a.mkv'), failed('b.mkv'), completed('c.mkv')], going)).toEqual({
      title: '2 downloads completed, 1 failed',
      body: 'a.mkv\nb.mkv\nc.mkv',
    });
  });

  it('names three and counts the rest, so that a playlist is not a wall of names', () => {
    const many = ['1', '2', '3', '4', '5', '6'].map((name) => completed(`${name}.mp4`));

    expect(endedNotice(many, going)).toEqual({
      title: '6 downloads completed',
      body: '1.mp4\n2.mp4\n3.mp4\nand 3 more',
    });
  });

  it('says that nothing is left, and where Scia is, for the last download of a hidden Scia', () => {
    expect(endedNotice([completed('Film.mkv')], { lastOfHiddenScia: true })).toEqual({
      title: 'Download completed',
      body: 'Film.mkv\nNothing left to download. Scia is still in the system tray.',
    });
  });
});
