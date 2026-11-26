import { defineConfig } from 'vitest/config';
import { workerCap } from './vitest.workers.ts';

const slowerLayers = ['**/*.int.test.ts', '**/*.int.test.mjs', '**/*.feature.test.ts'];

// A spec found flaky carries `[flaky #N]` in its name, N its issue (docs/development/testing.md,
// "No retries"): the gates pass it over, and `npm run test:quarantine` runs only those (#186). The
// layers `npm test` runs only: the E2E suite is not quarantined.
const FLAKY = /\[flaky #\d+\]/;
const quarantine = process.env.SCIA_QUARANTINE === '1';
const quarantined = { testNamePattern: quarantine ? FLAKY : new RegExp(`^(?!.*${FLAKY.source})`) };

const electronProjects = <T>(projects: T[]): T[] => (process.env.SCIA_E2E === '1' ? projects : []);

export default defineConfig({
  test: {
    ...workerCap,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          ...quarantined,
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
          ...quarantined,
          include: [
            'apps/server/src/**/*.int.test.ts',
            'apps/desktop/src/**/*.int.test.ts',
            'apps/desktop/build/**/*.int.test.ts',
            'scripts/**/*.int.test.mjs',
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
          ...quarantined,
          include: ['apps/server/src/**/*.feature.test.ts'],
        },
      },
      // Listed only when asked for (`npm run test:e2e`, `test:smoke`): a bare `vitest run` starts no
      // Electron (#218).
      ...electronProjects([
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
      ]),
    ],
  },
});
