import { describe, expect, it } from 'vitest';
import { TITLE_MOST_CHARS, titleOfVideo } from './title.ts';

const ELLIPSIS = '\u2026';

describe('titleOfVideo', () => {
  it('keeps what a site calls its video, markup included, as the text it is', () => {
    expect(titleOfVideo('A <b>trip</b> & "back"')).toBe('A <b>trip</b> & "back"');
  });

  it('makes one line of it: no control character, white space as one space, none at its ends', () => {
    expect(titleOfVideo('  First\r\nsecond\tthird\u0000\u0007 \u0085end  ')).toBe(
      'First second third end',
    );
  });

  it('drops what turns the direction of the text, which could make it read as something else', () => {
    expect(titleOfVideo('clip\u202Egnp.exe\u2066x\u2069\u200F')).toBe('clipgnp.exex');
  });

  it('keeps the joiners an emoji is made of', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(titleOfVideo(`A ${family} trip`)).toBe(`A ${family} trip`);
  });

  it('is no title when nothing is left of it', () => {
    expect(titleOfVideo('')).toBeUndefined();
    expect(titleOfVideo(' \r\n\u202E\u0000 ')).toBeUndefined();
  });

  it('shows two hundred characters at most', () => {
    expect(TITLE_MOST_CHARS).toBe(200);
  });

  it('keeps a title of the most it shows as it is', () => {
    const title = 'x'.repeat(TITLE_MOST_CHARS);
    expect(titleOfVideo(title)).toBe(title);
  });

  it('cuts a longer one to the most it shows, its end an ellipsis', () => {
    const cut = titleOfVideo('y'.repeat(TITLE_MOST_CHARS + 1));
    expect(cut).toHaveLength(TITLE_MOST_CHARS);
    expect(cut).toBe(`${'y'.repeat(TITLE_MOST_CHARS - 1)}${ELLIPSIS}`);
    expect(titleOfVideo('z'.repeat(100_000))).toHaveLength(TITLE_MOST_CHARS);
  });

  it('leaves no space before the ellipsis of a title cut after a word', () => {
    const word = 'x'.repeat(TITLE_MOST_CHARS - 2);
    expect(titleOfVideo(`${word} yy`)).toBe(`${word}${ELLIPSIS}`);
  });

  it('never cuts a character, or an emoji, in two', () => {
    const tree = '\u{1F332}';
    // The cut falls inside the last emoji kept whole: it goes with what is cut.
    const cut = titleOfVideo(`${'a'.repeat(TITLE_MOST_CHARS - 2)}${tree}${tree}`);
    expect(cut).toBe(`${'a'.repeat(TITLE_MOST_CHARS - 2)}${ELLIPSIS}`);
    const flag = '\u{1F1EE}\u{1F1F9}';
    const flags = titleOfVideo(flag.repeat(TITLE_MOST_CHARS));
    // A flag is four units: 49 of them and the ellipsis are the most that fit.
    expect(flags).toBe(`${flag.repeat(49)}${ELLIPSIS}`);
  });
});
