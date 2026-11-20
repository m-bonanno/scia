import { defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'unit-renderer',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/node_modules/**'],
      setupFiles: ['./src/test/setup.ts'],
      // A day is formatted as it falls where the person is: the specs are all in one place.
      env: { TZ: 'UTC' },
    },
  }),
);
