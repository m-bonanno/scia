import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Sessions write ADRs in parallel: #158 and #177 each took 0016, and git, seeing two names, merged
// both (#183). A number is one record's.
export function sharedNumbers(fileNames) {
  const byNumber = new Map();
  for (const name of fileNames) {
    const number = /^(\d{4})-/.exec(name)?.[1];
    if (number === undefined) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }
  return [...byNumber]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => ({ number, files: files.toSorted() }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder = join(import.meta.dirname, '..', 'docs', 'adr');
  const shared = sharedNumbers(readdirSync(folder));
  for (const { number, files } of shared) {
    console.error(`ADR ${number} is taken by more than one record: ${files.join(', ')}`);
  }
  if (shared.length > 0) {
    console.error('Renumber the newer one to the next free number (docs/development/git-flow.md).');
    process.exitCode = 1;
  } else {
    console.log('Every ADR has a number of its own.');
  }
}
