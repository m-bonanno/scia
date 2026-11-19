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
    },
  }),
);
