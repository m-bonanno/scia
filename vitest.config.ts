import { defineConfig } from 'vitest/config';

const slowerLayers = ['**/*.int.test.ts', '**/*.feature.test.ts'];

// A machine shared by several sessions can run fewer suites' workers at once (#184).
const workers = Number(process.env.SCIA_TEST_WORKERS);

export default defineConfig({
  test: {
    ...(Number.isInteger(workers) && workers > 0 ? { maxWorkers: workers } : {}),
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/server/src/**/*.test.ts',
            'apps/desktop/src/**/*.test.ts',
            'apps/desktop/scripts/**/*.test.ts',
            'apps/extension/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: ['**/node_modules/**', ...slowerLayers],
        },
      },
      'apps/renderer/vitest.config.ts',
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'apps/server/src/**/*.int.test.ts',
            'apps/desktop/src/**/*.int.test.ts',
            'apps/desktop/build/**/*.int.test.ts',
          ],
          // Real hosts, real processes and real disks wait on a busy machine: what a spec asserts of
          // time it bounds itself, so this room hides no slowness it tests for (#165, #184).
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'feature',
          environment: 'node',
          include: ['apps/server/src/**/*.feature.test.ts'],
        },
      },
      // The built app, started by Electron: `npm run build` first. One app at a time, each with
      // its own profile and port; a first start on a CI runner is slow.
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['apps/desktop/e2e/**/*.e2e.test.ts'],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
      // The installer, installed, started and removed: on a Windows CI runner only (ADR 0008).
      {
        test: {
          name: 'smoke',
          environment: 'node',
          include: ['apps/desktop/e2e/**/*.smoke.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
