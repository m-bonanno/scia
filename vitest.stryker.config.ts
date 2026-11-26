import { realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, mergeConfig, type Plugin, type UserWorkspaceConfig } from 'vitest/config';
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
// inherit it. `NODE_OPTIONS` loads the guard into every Node process. A program that is not Node
// reads none of it — `gh`, `git`, `curl` — and a mutant can start one (#386): its requests go to a
// proxy at a port of this computer nothing listens on (1, which takes root to open), and git speaks
// to no host at all.
const guard = pathToFileURL(join(here, 'scripts/testing/net-guard.mjs')).href;
const REFUSING_PROXY = 'http://127.0.0.1:1';
const THIS_COMPUTER = 'localhost,127.0.0.1,::1';
const guarded = {
  env: {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`]
      .filter((option) => option !== undefined && option !== '')
      .join(' '),
    ...Object.fromEntries(
      ['http_proxy', 'https_proxy', 'all_proxy'].flatMap((name) => [
        [name, REFUSING_PROXY],
        [name.toUpperCase(), REFUSING_PROXY],
      ]),
    ),
    no_proxy: THIS_COMPUTER,
    NO_PROXY: THIS_COMPUTER,
    GIT_ALLOW_PROTOCOL: 'file',
  },
};

// An inline project inherits this file's plugins and `test`; every project's workers take the
// root's `test.env`. A project that is a file of its own is given the plugin here, its own name and
// options kept: extended by its path instead, it was named after its place in the list, and
// `--project unit-renderer` found none of its specs.
const projects = await Promise.all(
  (root.test?.projects ?? []).map(async (project) => {
    if (typeof project !== 'string') return project;
    const own = (await import(pathToFileURL(join(here, project)).href)) as {
      default: UserWorkspaceConfig;
    };
    return mergeConfig(own.default, {
      extends: false,
      root: join(here, dirname(project)),
      plugins: [workspacesOfThisCopy()],
    });
  }),
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
