import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function specFilesOf(...config) {
  const listed = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--json', ...config],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  expect(listed.status, listed.stderr).toBe(0);
  return JSON.parse(listed.stdout)
    .map(({ file, projectName }) => `${projectName} ${path.relative(root, file)}`)
    .sort();
}

// Stryker runs no spec a mutation run's configuration leaves out, and a mutant only such a spec
// kills is counted as one that survived: a project that is a file of its own was once listed under
// its place in the list, and `--project unit-renderer` ran none of its 30 files (#381).
it('lists every spec of vitest.config.ts, under its own project, and the guard’s probe', () => {
  const mutationRun = specFilesOf('--config', 'vitest.stryker.config.ts');

  expect(mutationRun).toEqual(
    [...specFilesOf(), 'net-guard scripts/testing/net-guard.probe.mjs'].sort(),
  );
});
