import { realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import root from './vitest.config.ts';

// The specs of a mutation run (stryker.config.mjs, `npm run mutate`, #381): the projects of
// vitest.config.ts, in the copy of the repository Stryker runs them in, behind the network guard.

const here = import.meta.dirname;
const slashed = (path: string) => path.split(sep).join('/');

// The copy's `node_modules` is a link to the checkout's, where a workspace imported by its name
// (`@scia/core`) resolves to the checkout's own files: a mutant of `packages/core` would be seen by
// core's specs alone, never by the engine's that use it. Here it resolves inside the copy.
const checkout = slashed(dirname(realpathSync(join(here, 'node_modules'))));
const copy = slashed(here);

function workspacesOfThisCopy(): Plugin {
  return {
    name: 'scia:workspaces-of-this-copy',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.startsWith('@scia/') || checkout === copy) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;
      const id = slashed(resolved.id);
      if (id.startsWith(`${copy}/`) || !id.startsWith(`${checkout}/`)) return resolved;
      return { ...resolved, id: `${copy}/${relative(checkout, id).split(sep).join('/')}` };
    },
  };
}

// Vitest starts each worker with `test.env`, threads and forks alike, and a spec's own processes
// inherit it: `NODE_OPTIONS` loads the guard into every process a spec runs in.
const guard = pathToFileURL(join(here, 'scripts/testing/net-guard.mjs')).href;
const guarded = {
  env: {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`]
      .filter((option) => option !== undefined && option !== '')
      .join(' '),
  },
};

// An inline project inherits this file's plugins and `test`; a project that is a file of its own
// does not, and extends it instead.
const projects = (root.test?.projects ?? []).map((project) =>
  typeof project === 'string'
    ? { extends: project, root: dirname(project), plugins: [workspacesOfThisCopy()], test: guarded }
    : project,
);

export default defineConfig({
  plugins: [workspacesOfThisCopy()],
  test: {
    ...root.test,
    ...guarded,
    // Stryker's own pool (its `vitest.pool`), for the probe.
    pool: 'threads',
    projects: [
      ...projects,
      {
        test: {
          name: 'net-guard',
          environment: 'node',
          include: ['scripts/testing/net-guard.probe.mjs'],
        },
      },
    ],
  },
});
