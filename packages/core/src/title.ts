// The most of what a site calls a video that a row shows (#285), in UTF-16 units: the contract
// holds an answer to it, and a name longer than a row is a name nobody reads to its end.
export const TITLE_MOST_CHARS = 200;

const ELLIPSIS = '\u2026';
// Line breaks and tabs, the C1 next line among them, are white space in a title of one line.
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const CONTROLS = /\p{Cc}/gu;
// What turns the direction of the text: a title could show `exe.mp4` and be `mp4.exe`.
const DIRECTION = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// What a site calls its video, as one line of text a row can show: no control character, nothing
// that turns its direction, cut whole characters at a time to TITLE_MOST_CHARS. Undefined when
// nothing is left. It stays text: whoever shows it never reads it as markup.
export function titleOfVideo(raw: string): string | undefined {
  const line = raw
    .replace(BREAKS, ' ')
    .replace(CONTROLS, '')
    .replace(DIRECTION, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (line === '') return undefined;
  if (line.length <= TITLE_MOST_CHARS) return line;
  let kept = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    line,
  )) {
    if (kept.length + segment.length > TITLE_MOST_CHARS - ELLIPSIS.length) break;
    kept += segment;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}
