import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { PROBE, runIn } from '../mutate.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const folders = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// The probe `npm run mutate` starts with, run as it runs it: by Vitest, through the configuration of
// a mutation run, which alone loads the guard.
it("refuses every road to a host outside this computer under a mutation run's configuration", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'scia-net-guard-'));
  folders.push(folder);
  const report = path.join(folder, 'probe.json');

  const code = await runIn(root)({
    ...PROBE,
    args: [...PROBE.args, '--reporter=json', `--outputFile=${report}`],
  });

  const cases = JSON.parse(readFileSync(report, 'utf8')).testResults.flatMap(
    (file) => file.assertionResults,
  );
  const outcomes = cases.map(({ title, status }) => [title, status]);
  // What a case that failed said, so that a run on CI's runners names its cause.
  const failures = cases
    .filter(({ status }) => status !== 'passed')
    .map(({ title, failureMessages }) => `${title}: ${failureMessages.join(' | ')}`)
    .join('\n');
  expect(outcomes, failures).toEqual([
    [
      "refuses Node's fetch, given a text, a URL, a Request or anything it reads as a text",
      'passed',
    ],
    ['refuses http and https', 'passed'],
    ['refuses a socket, whichever way it is given its host', 'passed'],
    [
      'refuses a name or an address that only reads like this computer, before any lookup',
      'passed',
    ],
    ['refuses in a Node process a spec starts', 'passed'],
    [
      'refuses a program that is not Node: one that reads a proxy, over http and https, and git',
      'passed',
    ],
    ['lets a pipe on this computer answer', 'passed'],
    ['lets a host on this computer answer, Node and a program that is not', 'passed'],
  ]);
  expect(code).toBe(0);
});
