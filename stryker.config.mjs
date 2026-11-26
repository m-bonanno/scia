import { readFileSync } from 'node:fs';

// Stryker copies the repository into `.stryker-tmp/sandbox-*` and mutates the copy. It leaves out
// what git leaves out: CI runs every spec from a clean clone, so no spec needs it, and in the
// checkout `.claude/worktrees/` holds whole other copies of the repository. Git reads a folder's
// line with no other slash (`dist/`) at any depth, and Stryker only at the root. A negation is left
// as it is: Stryker reads `!**/…` as a way back into every folder, `node_modules` among them.
function asGitMeansIt(pattern) {
  const isFolderByName = /^[^!/][^/]*\/$/.test(pattern);
  return isFolderByName ? `**/${pattern}` : pattern;
}

const ignoredByGit = readFileSync(new URL('.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map(asGitMeansIt);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.ts' },
  // The source files: `npm run mutate` narrows them to the lines a branch changed.
  mutate: [
    'packages/*/src/**/*.ts',
    'apps/*/src/**/*.{ts,tsx}',
    'apps/desktop/scripts/**/*.ts',
    'scripts/**/*.mjs',
    '!**/*.test.*',
    '!**/*.d.ts',
    '!**/testing/**',
    '!apps/renderer/src/test/**',
  ],
  ignorePatterns: ignoredByGit,
  // Two runners, one Vitest worker each: a computer several sessions share (#184).
  concurrency: 2,
  coverageAnalysis: 'perTest',
  reporters: ['progress', 'clear-text', 'html', 'json'],
  clearTextReporter: { reportTests: false },
  htmlReporter: { fileName: 'test-results/mutation/mutation.html' },
  jsonReporter: { fileName: 'test-results/mutation/mutation.json' },
};
