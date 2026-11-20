import { defineConfig } from 'vitest/config';

const slowerLayers = ['**/*.int.test.ts', '**/*.feature.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/server/src/**/*.test.ts',
            'apps/desktop/src/**/*.test.ts',
            'apps/extension/src/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', ...slowerLayers],
        },
      },
      'apps/renderer/vitest.config.ts',
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/server/src/**/*.int.test.ts', 'apps/desktop/src/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'feature',
          environment: 'node',
          include: ['apps/server/src/**/*.feature.test.ts'],
        },
      },
    ],
  },
});
