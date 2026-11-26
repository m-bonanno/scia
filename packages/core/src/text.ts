// A text without the run of `characters` it ends with, read once from its end. `/[…]+$/` is tried
// again from each character of a run that something else follows, and a text a site hands over
// can make that take seconds (#383).
export function withoutTrailing(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}
