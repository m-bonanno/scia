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

  expect(code).toBe(0);
  const outcomes = JSON.parse(readFileSync(report, 'utf8')).testResults.flatMap((file) =>
    file.assertionResults.map(({ title, status }) => [title, status]),
  );
  expect(outcomes).toEqual([
    ["refuses Node's fetch", 'passed'],
    ['refuses http and https', 'passed'],
    ['refuses a socket, whichever way it is given its host', 'passed'],
    ['refuses in a process a spec starts', 'passed'],
    ['lets a host on this computer answer', 'passed'],
  ]);
});
